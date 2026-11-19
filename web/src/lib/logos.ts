/**
 * Shared client+server brand logo lookup helpers for AI tools and models.
 *
 * Bundled SVGs are monochrome `currentColor` icons from `logo-catalog.generated.ts`.
 * Server pages enrich maps via `@/lib/logos-server` so newly released models from
 * models.dev also receive dynamically resolved lab logos.
 */

import {
  normalizeLabId,
  resolveModelLogoId,
  type LogoCatalogMap,
  type LogoSvg,
} from "../../../pricing/logos-core.ts";
import {
  BUNDLED_FAMILY_LABS,
  BUNDLED_MODEL_LABS,
  BUNDLED_MODEL_LOGOS,
  BUNDLED_TOOL_LOGOS,
} from "./logo-catalog.generated.ts";

export type { LogoSvg };

export interface SerializedLogo {
  id: string;
  /** Present when resolved dynamically at runtime rather than bundled in client JS. */
  svg?: LogoSvg;
}

export type LogoMap = Record<string, SerializedLogo>;

export const STATIC_LOGO_IDS: ReadonlySet<string> = new Set(Object.keys(BUNDLED_MODEL_LOGOS));

export const STATIC_LOGO_MAP: LogoCatalogMap = {
  modelLabs: BUNDLED_MODEL_LABS,
  familyLabs: BUNDLED_FAMILY_LABS,
};

const TOOL_ALIASES: Record<string, string> = {
  "claude-code": "claude-code",
  claude_code: "claude-code",
  claudecode: "claude-code",
  claude: "claude-code",
  "claude-desktop": "claude-desktop",
  claude_desktop: "claude-desktop",
  codex: "codex",
  "openai-codex": "codex",
  "copilot-cli": "copilot-cli",
  copilot_cli: "copilot-cli",
  copilot: "copilot-cli",
  "github-copilot": "copilot-cli",
  opencode: "opencode",
  "open-code": "opencode",
  eaon: "eaon",
  orca: "orca",
  cursor: "cursor",
  "gemini-cli": "gemini-cli",
  gemini_cli: "gemini-cli",
  gemini: "gemini-cli",
  aider: "aider",
  windsurf: "windsurf",
};

/** Normalize a tool identifier into its canonical bundled tool logo key, if known. */
export function toolLogoId(rawTool: string): string | null {
  const clean = rawTool.trim().toLowerCase().replace(/\s+/g, "-");
  if (!clean) return null;
  if (TOOL_ALIASES[clean]) return TOOL_ALIASES[clean];
  if (clean in BUNDLED_TOOL_LOGOS) return clean;
  return normalizeLabId(clean);
}

/** Retrieve a bundled monochrome tool SVG by tool ID or alias. */
export function getBundledToolLogo(rawTool: string): { id: string; svg: LogoSvg } | null {
  const id = toolLogoId(rawTool);
  if (!id) return null;
  const svg = BUNDLED_TOOL_LOGOS[id];
  return svg ? { id, svg } : null;
}

/** Retrieve a bundled monochrome model/lab SVG by logo ID. */
export function getBundledModelLogo(id: string | null | undefined): LogoSvg | null {
  if (!id) return null;
  return BUNDLED_MODEL_LOGOS[id] ?? null;
}

/** Pure static model logo resolution without DB or remote catalog lookups. */
export function resolveStaticModelLogo(model: string): SerializedLogo | null {
  const id = resolveModelLogoId({
    model,
    modelLabs: BUNDLED_MODEL_LABS,
    familyLabs: BUNDLED_FAMILY_LABS,
    knownLogos: STATIC_LOGO_IDS,
  });
  return id ? { id } : null;
}

/** Look up a model logo from an optional server-resolved map, falling back to static inference. */
export function lookupModelLogo(model: string | null | undefined, map?: LogoMap | null): SerializedLogo | null {
  if (!model) return null;
  const trimmed = model.trim();
  if (!trimmed) return null;
  if (map) {
    const hit = map[trimmed] ?? map[model];
    if (hit) return hit;
  }
  return resolveStaticModelLogo(trimmed);
}
