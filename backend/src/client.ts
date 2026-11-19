import { randomBytes } from "node:crypto";
import { ENV } from "./env.ts";

/**
 * Database access, on Supabase Postgres through its Data API (PostgREST).
 *
 * The repositories were written against Appwrite's document API, and the
 * Postgres tables keep Appwrite's shape exactly: the same table and column
 * names, `id` holding the old `$id`, and `$createdAt` / `$updatedAt` kept as
 * columns (see pg-schema.ts). So rather than rewrite every repository, this
 * module answers the handful of Appwrite calls they make — listDocuments,
 * getDocument, createDocument, updateDocument, deleteDocument,
 * upsertDocuments, deleteDocuments — and the subset of `Query` they use, and
 * translates each into one HTTP request.
 *
 * Every request carries the secret key, which bypasses row-level security.
 * The `tokn` tables have RLS on and no policies, so nothing but this server
 * can read them. The key must never reach the browser.
 */

export const DB_ID = ENV.schema;

type Row = Record<string, unknown>;
export type Document = Row & { $id: string; $createdAt: string; $updatedAt: string };
export type DocumentList = { total: number; documents: Document[] };

/* ----------------------------------------------------------------- Query */

type Q = { method: string; attribute?: string; values?: unknown[] };

const wrap = (v: unknown): unknown[] => (Array.isArray(v) ? v : [v]);
const q = (query: Q) => JSON.stringify(query);

/** The same strings node-appwrite's `Query` builds, so existing calls are unchanged. */
export const Query = {
  equal: (attribute: string, value: unknown) => q({ method: "equal", attribute, values: wrap(value) }),
  notEqual: (attribute: string, value: unknown) => q({ method: "notEqual", attribute, values: wrap(value) }),
  lessThan: (attribute: string, value: unknown) => q({ method: "lessThan", attribute, values: wrap(value) }),
  lessThanEqual: (attribute: string, value: unknown) => q({ method: "lessThanEqual", attribute, values: wrap(value) }),
  greaterThan: (attribute: string, value: unknown) => q({ method: "greaterThan", attribute, values: wrap(value) }),
  greaterThanEqual: (attribute: string, value: unknown) =>
    q({ method: "greaterThanEqual", attribute, values: wrap(value) }),
  isNull: (attribute: string) => q({ method: "isNull", attribute }),
  isNotNull: (attribute: string) => q({ method: "isNotNull", attribute }),
  startsWith: (attribute: string, prefix: string) => q({ method: "startsWith", attribute, values: [prefix] }),
  orderAsc: (attribute: string) => q({ method: "orderAsc", attribute }),
  orderDesc: (attribute: string) => q({ method: "orderDesc", attribute }),
  limit: (limit: number) => q({ method: "limit", values: [limit] }),
  offset: (offset: number) => q({ method: "offset", values: [offset] }),
  cursorAfter: (id: string) => q({ method: "cursorAfter", values: [id] }),
  or: (queries: string[]) => q({ method: "or", values: queries.map((x) => JSON.parse(x)) }),
  and: (queries: string[]) => q({ method: "and", values: queries.map((x) => JSON.parse(x)) }),
};

/** Appwrite-style ids: 20 lowercase hex characters. */
export const ID = {
  unique: () => randomBytes(10).toString("hex"),
  custom: (id: string) => id,
};

/* ------------------------------------------------------------ Translation */

const column = (attribute: string) => (attribute === "$id" ? "id" : attribute);

/** A column name as PostgREST wants it: `$createdAt` has to be quoted. */
const ident = (attribute: string) => {
  const c = column(attribute);
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(c) ? c : `"${c}"`;
};

/** A value inside a PostgREST filter. Quoted, so commas and brackets are literal. */
const lit = (v: unknown) => {
  if (v === null) return "null";
  if (typeof v === "boolean" || typeof v === "number") return String(v);
  return `"${String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
};

const OPS: Record<string, string> = {
  equal: "eq",
  notEqual: "neq",
  lessThan: "lt",
  lessThanEqual: "lte",
  greaterThan: "gt",
  greaterThanEqual: "gte",
};

/** One condition as `col.op.value`, the form used inside `or=(...)` and `and=(...)`. */
function condition(query: Q): string {
  const { method, attribute = "", values = [] } = query;
  if (method === "isNull") return `${ident(attribute)}.is.null`;
  if (method === "isNotNull") return `${ident(attribute)}.not.is.null`;
  // LIKE, with the prefix's own wildcards taken literally; PostgREST reads `*` as `%`.
  if (method === "startsWith") return `${ident(attribute)}.like.${lit(`${String(values[0]).replace(/[\\%_]/g, "\\$&")}*`)}`;
  if (method === "or" || method === "and") return `${method}(${(values as Q[]).map(condition).join(",")})`;
  const op = OPS[method];
  if (!op) throw new Error(`Query.${method} is not supported on Postgres`);
  if (method === "equal" && values.length !== 1) return `${ident(attribute)}.in.(${values.map(lit).join(",")})`;
  if (method === "notEqual" && values.length !== 1)
    return `${ident(attribute)}.not.in.(${values.map(lit).join(",")})`;
  return `${ident(attribute)}.${op}.${lit(values[0])}`;
}

type Plan = { params: URLSearchParams; limit: number; offset: number };

/**
 * Appwrite queries to PostgREST parameters.
 *
 * Paging is by `cursorAfter` over `orderAsc("$id")`, which is how every
 * repository pages, so the cursor becomes `id > cursor`. A cursor under any
 * other ordering would need the cursor row's sort values; nothing uses that,
 * so it is refused rather than answered wrongly.
 */
function plan(queries: string[] = []): Plan {
  const parsed = queries.map((x) => JSON.parse(x) as Q);
  const params = new URLSearchParams();
  const filters: string[] = [];
  const order: string[] = [];
  let limit = 25; // Appwrite's default page size
  let offset = 0;
  let cursor: string | undefined;

  for (const query of parsed) {
    switch (query.method) {
      case "limit":
        limit = Number(query.values?.[0]);
        break;
      case "offset":
        offset = Number(query.values?.[0]);
        break;
      case "cursorAfter":
        cursor = String(query.values?.[0]);
        break;
      case "orderAsc":
      case "orderDesc":
        order.push(`${ident(query.attribute ?? "$id")}.${query.method === "orderAsc" ? "asc" : "desc"}`);
        break;
      default:
        filters.push(condition(query));
    }
  }

  if (cursor !== undefined) {
    if (order.length && !(order.length === 1 && order[0] === "id.asc")) {
      throw new Error("cursorAfter is only supported when ordering by $id ascending");
    }
    filters.push(`id.gt.${lit(cursor)}`);
  }
  // Appwrite's default order is insertion order; created-at then id is the
  // closest stable equivalent.
  if (!order.length) order.push(`"$createdAt".asc`, "id.asc");

  if (filters.length) params.set("and", `(${filters.join(",")})`);
  params.set("order", order.join(","));
  return { params, limit, offset };
}

/* ------------------------------------------------------------------ HTTP */

class DatabaseError extends Error {
  code: number;
  type: string;
  constructor(message: string, code: number, type: string) {
    super(message);
    this.code = code;
    this.type = type;
  }
}

/** PostgREST and Postgres errors, as the Appwrite codes the repositories check. */
function toError(status: number, body: { code?: string; message?: string; details?: string }): DatabaseError {
  const message = body.message ?? `Database request failed (${status})`;
  if (body.code === "23505") return new DatabaseError(message, 409, "document_already_exists");
  if (status === 404) return new DatabaseError(message, 404, "document_not_found");
  return new DatabaseError(`${message}${body.details ? `: ${body.details}` : ""}`, status, body.code ?? "general");
}

async function request(
  method: string,
  table: string,
  params: URLSearchParams,
  { body, prefer }: { body?: unknown; prefer?: string[] } = {},
): Promise<Response> {
  const headers: Record<string, string> = {
    apikey: ENV.supabaseKey,
    authorization: `Bearer ${ENV.supabaseKey}`,
    "accept-profile": ENV.schema,
    "content-profile": ENV.schema,
    accept: "application/json",
  };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (prefer?.length) headers.prefer = prefer.join(",");

  const url = `${ENV.supabaseUrl}/rest/v1/${encodeURIComponent(table)}?${params}`;
  // no-store: Next.js must never serve a database read from its fetch cache.
  const init = { method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store" };
  const response = await fetch(url, init as RequestInit);
  if (!response.ok) {
    const detail = (await response.json().catch(() => ({}))) as { code?: string; message?: string; details?: string };
    throw toError(response.status, detail);
  }
  return response;
}

/** A Postgres row as the Appwrite document the repositories expect. */
function toDocument(row: Row, table: string): Document {
  const { id, ...rest } = row;
  return {
    $id: String(id),
    $collectionId: table,
    $databaseId: ENV.schema,
    $permissions: [],
    ...rest,
  } as unknown as Document;
}

/** Document data as a Postgres row: `$id` becomes `id`, and Appwrite's other system fields go. */
function toRow(data: Row, id?: string): Row {
  const row: Row = {};
  for (const [key, value] of Object.entries(data)) {
    if (key === "$id") row.id = value;
    else if (!key.startsWith("$")) row[key] = value;
  }
  if (id !== undefined) row.id = id;
  return row;
}

const one = (table: string, id: string) => new URLSearchParams({ id: `eq.${id}` });

/* ------------------------------------------------------------ Operations */

const operations = {
  async listDocuments(_db: string, table: string, queries: string[] = []): Promise<DocumentList> {
    const { params, limit, offset } = plan(queries);
    params.set("limit", String(limit));
    if (offset) params.set("offset", String(offset));
    const response = await request("GET", table, params, { prefer: ["count=exact"] });
    const rows = (await response.json()) as Row[];
    // Content-Range is "0-24/1234", or "*/0" for an empty page.
    const total = Number(response.headers.get("content-range")?.split("/")[1] ?? rows.length);
    return { total: Number.isFinite(total) ? total : rows.length, documents: rows.map((r) => toDocument(r, table)) };
  },

  async getDocument(_db: string, table: string, id: string): Promise<Document> {
    const response = await request("GET", table, one(table, id));
    const rows = (await response.json()) as Row[];
    if (!rows.length) throw new DatabaseError(`No row ${id} in ${table}`, 404, "document_not_found");
    return toDocument(rows[0], table);
  },

  async createDocument(_db: string, table: string, id: string, data: Row): Promise<Document> {
    const row = toRow(data, id);
    const response = await request("POST", table, new URLSearchParams(), {
      body: row,
      prefer: ["return=representation"],
    });
    return toDocument(((await response.json()) as Row[])[0], table);
  },

  async updateDocument(_db: string, table: string, id: string, data: Row = {}): Promise<Document> {
    const row: Row = { ...toRow(data), $updatedAt: new Date().toISOString() };
    delete row.id;
    const response = await request("PATCH", table, one(table, id), {
      body: row,
      prefer: ["return=representation"],
    });
    const rows = (await response.json()) as Row[];
    if (!rows.length) throw new DatabaseError(`No row ${id} in ${table}`, 404, "document_not_found");
    return toDocument(rows[0], table);
  },

  async deleteDocument(_db: string, table: string, id: string): Promise<Record<string, never>> {
    const response = await request("DELETE", table, one(table, id), { prefer: ["return=representation"] });
    const rows = (await response.json()) as Row[];
    if (!rows.length) throw new DatabaseError(`No row ${id} in ${table}`, 404, "document_not_found");
    return {};
  },

  /**
   * Insert or replace each document by id. Documents arrive with their own
   * `$id` (repositories derive them deterministically), so a re-sync lands on
   * the same rows instead of adding new ones.
   */
  async upsertDocuments(_db: string, table: string, documents: Row[]): Promise<DocumentList> {
    if (!documents.length) return { total: 0, documents: [] };
    const now = new Date().toISOString();
    const rows = documents.map((d) => ({ ...toRow(d), $updatedAt: now }));
    const columns = [...new Set(rows.flatMap((r) => Object.keys(r)))];
    const params = new URLSearchParams({ on_conflict: "id", columns: columns.map(ident).join(",") });
    const response = await request("POST", table, params, {
      body: rows,
      prefer: ["resolution=merge-duplicates", "missing=default", "return=representation"],
    });
    const written = (await response.json()) as Row[];
    return { total: written.length, documents: written.map((r) => toDocument(r, table)) };
  },

  async deleteDocuments(_db: string, table: string, queries: string[] = []): Promise<DocumentList> {
    const { params } = plan(queries);
    params.delete("order");
    if (!params.has("and")) throw new Error("deleteDocuments without a filter would empty the table");
    const response = await request("DELETE", table, params, { prefer: ["return=representation"] });
    const rows = (await response.json()) as Row[];
    return { total: rows.length, documents: rows.map((r) => toDocument(r, table)) };
  },
};

export type Database = typeof operations;

export function db(): Database {
  return operations;
}

/** "No such row" — the 404 the repositories already test for. */
export function isNotFound(error: unknown): boolean {
  return (error as { code?: number })?.code === 404;
}

/** A unique-index violation (Postgres 23505), used to detect races rather than fail. */
export function isConflict(error: unknown): boolean {
  return (error as { code?: number })?.code === 409;
}
