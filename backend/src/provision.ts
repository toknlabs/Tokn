import { emitPostgresSchema } from "./pg-schema.ts";
import { ENV } from "./env.ts";

/**
 * Print the SQL that creates the tokn tables in Supabase.
 *
 * The tables live in Postgres now, in the schema named by TOKN_SCHEMA
 * (default "tokn"). Paste the output into the Supabase SQL editor. Every
 * statement is `if not exists` / `or replace`, so it is safe on a live project
 * and only adds what is missing. It never drops or alters a column: changes
 * like that are a deliberate migration, not a side effect of a deploy.
 *
 *   npm run provision > schema.sql
 *
 * After creating a table, keep the two rules every tokn table follows:
 * row-level security on with no policies, and access for service_role only.
 */

const schema = `"${ENV.schema.replace(/"/g, '""')}"`;

process.stdout.write(
  [
    `create schema if not exists ${schema};`,
    `set search_path to ${schema};`,
    "",
    emitPostgresSchema(),
    `grant usage on schema ${schema} to service_role;`,
    `grant all on all tables in schema ${schema} to service_role;`,
    `do $$ declare t record; begin`,
    `  for t in select tablename from pg_tables where schemaname = ${schema.replace(/"/g, "'")} loop`,
    `    execute format('alter table %I.%I enable row level security', ${schema.replace(/"/g, "'")}, t.tablename);`,
    `  end loop;`,
    `end $$;`,
    "",
  ].join("\n"),
);
