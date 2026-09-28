import http from "node:http";
import { ENV } from "./env.ts";
import { cliLink, cliMe, cliSync } from "./service.ts";
import { pricingTableForCli, refreshPricingFromCatalog } from "./refresh-pricing.ts";
import { leaderboard, globalStats } from "./repo/leaderboard.ts";
import { findProfileByHandle } from "./repo/profiles.ts";
import { profilePayload } from "./service.ts";

/**
 * A standalone HTTP server for the API.
 *
 * Two uses: running the backend without the Next.js app (handy while the front
 * end is still being built), and serving as the reference implementation that
 * the Next route handlers mirror — they call the exact same service functions.
 *
 *   node --experimental-strip-types src/server.ts
 */

const PORT = Number(process.env.PORT ?? 8787);
const MAX_BODY = 8 * 1024 * 1024;

type Handler = (
  req: http.IncomingMessage,
  url: URL,
  body: unknown,
) => Promise<{ status: number; body: unknown; headers?: Record<string, string> }>;

const routes: { method: string; path: string | RegExp; handler: Handler }[] = [
  {
    method: "POST",
    path: "/api/cli/link",
    handler: async (_req, _url, body) => {
      const result = await cliLink((body ?? {}) as never);
      return "error" in result
        ? { status: result.status, body: { error: result.error } }
        : { status: 200, body: result };
    },
  },
  {
    method: "GET",
    path: "/api/cli/me",
    handler: async (req) => {
      const result = await cliMe(req.headers.authorization ?? null);
      return "error" in result
        ? { status: result.status, body: { error: result.error } }
        : { status: 200, body: result };
    },
  },
  {
    method: "POST",
    path: "/api/cli/sync",
    handler: async (req, _url, body) => {
      const result = await cliSync(req.headers.authorization ?? null, (body ?? {}) as never);
      return "error" in result
        ? { status: result.status, body: { error: result.error } }
        : { status: 200, body: result };
    },
  },
  {
    method: "GET",
    path: "/api/cli/pricing",
    handler: async () => {
      const { models, plan } = await pricingTableForCli();
      if (plan === "stale") {
        void refreshPricingFromCatalog().catch((error: unknown) => {
          console.error(error instanceof Error ? error.message : String(error));
        });
      }
      return {
        status: 200,
        body: { models, updatedAt: new Date().toISOString() },
        headers: { "cache-control": "public, max-age=3600" },
      };
    },
  },
  {
    method: "GET",
    path: "/api/leaderboard",
    handler: async (_req, url) => ({
      status: 200,
      body: {
        entries: await leaderboard({
          window: (url.searchParams.get("window") as never) ?? "all",
          metric: (url.searchParams.get("metric") as never) ?? "cost",
          limit: Number(url.searchParams.get("limit") ?? 100),
        }),
        stats: await globalStats(),
      },
    }),
  },
  {
    method: "GET",
    path: /^\/api\/u\/([A-Za-z0-9_.-]{2,24})$/,
    handler: async (_req, url) => {
      const handle = url.pathname.split("/").pop() ?? "";
      const profile = await findProfileByHandle(handle);
      if (!profile) return { status: 404, body: { error: "no such profile" } };
      if (profile.isPublic === false) return { status: 404, body: { error: "this profile is private" } };
      return { status: 200, body: await profilePayload(profile) };
    },
  },
];

function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (chunks.length === 0) return resolve(undefined);
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new Error("expected a JSON body"));
      }
    });
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);

  const route = routes.find(
    (r) =>
      r.method === req.method &&
      (typeof r.path === "string" ? r.path === url.pathname : r.path.test(url.pathname)),
  );

  if (!route) {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
    return;
  }

  try {
    const body = req.method === "POST" ? await readBody(req) : undefined;
    const result = await route.handler(req, url, body);
    res.writeHead(result.status, { "content-type": "application/json", ...result.headers });
    res.end(JSON.stringify(result.body));
  } catch (error) {
    const message = error instanceof Error ? error.message : "internal error";
    // 400 for a body we could not parse; anything else is genuinely ours.
    const status = /body|JSON/i.test(message) ? 400 : 500;
    if (status === 500) console.error(error);
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: message }));
  }
});

server.listen(PORT, () => {
  console.log(`\n  tokn backend on http://localhost:${PORT}`);
  console.log(`  appwrite ${ENV.endpoint} project ${ENV.projectId} db ${ENV.databaseId}\n`);
  console.log(`  point the CLI at it:  TOKN_HOST=http://localhost:${PORT} tokn link\n`);
});
