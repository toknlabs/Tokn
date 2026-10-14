import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Configuration, read from the environment.
 *
 * In production (Vercel, Appwrite Functions) these arrive as real environment
 * variables. For local work we also read the repo-root `.env`, which is
 * gitignored — the API key is a full-access project credential and must never
 * reach a commit.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");

function loadDotEnv(): void {
  const file = path.join(repoRoot, ".env");
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return; // No local .env; rely on the real environment.
  }

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    // An explicitly set environment variable always wins over the file.
    if (process.env[key] !== undefined) continue;
    process.env[key] = trimmed.slice(eq + 1).trim();
  }
}

loadDotEnv();

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. Copy .env.example to .env and fill it in, or set it in your deployment environment.`,
    );
  }
  return value;
}

export const ENV = {
  endpoint: process.env.APPWRITE_ENDPOINT ?? "https://sfo.cloud.appwrite.io/v1",
  projectId: process.env.APPWRITE_PROJECT_ID ?? "eaon",
  get apiKey(): string {
    return required("APPWRITE_API_KEY");
  },
  databaseId: process.env.TOKN_DATABASE_ID ?? "tokn",
  publicUrl: process.env.TOKN_PUBLIC_URL ?? "http://localhost:3000",
  /**
   * Where the Eaon Desktop board lives. Same deployment, second hostname: the
   * web app's middleware serves the Eaon pages when a request arrives on it.
   */
  eaonUrl: process.env.TOKN_EAON_URL ?? "https://tokns.eaon.dev",
};
