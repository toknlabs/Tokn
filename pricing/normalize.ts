/**
 * Reduce a model identifier to the form stored in the catalog.
 *
 * Real logs carry provider prefixes, Bedrock region prefixes, Vertex
 * `@`-versions and dated snapshots. `openai/gpt-6-luna` and
 * `gpt-6-luna-20260922` price as `gpt-6-luna`. A leading `~` is kept, so an
 * alias such as `~openai/gpt-luna-latest` stays its own row instead of being
 * mistaken for the vendor prefix `openai/`.
 */
export function normalizeModelId(raw: string): string {
  let id = raw.trim().toLowerCase();

  id = id.replace(/^(us|eu|apac|global|ca|sa|apne|usgov)\./, "");
  id = id.replace(/^anthropic\./, "");
  id = id.replace(/^[a-z0-9-]+\//, "");
  id = id.replace(/-v\d+(?::\d+)?$/, "");

  const at = id.indexOf("@");
  if (at !== -1) id = id.slice(0, at);

  id = id.replace(/-\d{8}$/, "");
  return id;
}
