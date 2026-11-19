import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getBundledModelLogo,
  getBundledToolLogo,
  lookupModelLogo,
  resolveStaticModelLogo,
  toolLogoId,
} from "./logos.ts";

describe("web tool logos", () => {
  it("bundles monochrome currentColor SVGs for every supported tool", () => {
    const tools = [
      "claude-code",
      "claude-desktop",
      "codex",
      "copilot-cli",
      "opencode",
      "eaon",
      "orca",
      "cursor",
      "gemini-cli",
      "aider",
      "windsurf",
    ];
    for (const tool of tools) {
      const hit = getBundledToolLogo(tool);
      assert.ok(hit, `missing bundled SVG for tool '${tool}'`);
      assert.ok(hit.svg.body.includes("currentColor"), `tool '${tool}' must inherit currentColor`);
      assert.ok(!/<script/i.test(hit.svg.body));
    }
  });

  it("normalizes aliases and returns null for unknown custom tools", () => {
    assert.equal(toolLogoId("claude_code"), "claude-code");
    assert.equal(toolLogoId("openai-codex"), "codex");
    assert.equal(toolLogoId("github-copilot"), "copilot-cli");
    assert.equal(getBundledToolLogo("nonexistent-custom-agent"), null);
  });
});

describe("web model logos", () => {
  it("resolves bundled creator lab logos across major model families and reseller IDs", () => {
    const expected: [string, string][] = [
      ["claude-opus-4-6", "anthropic"],
      ["openrouter/anthropic/claude-sonnet-4-5", "anthropic"],
      ["gpt-5.4", "openai"],
      ["o4-mini", "openai"],
      ["gemini-3.1-pro-preview", "google"],
      ["grok-code-fast-1", "xai"],
      ["deepseek-r1", "deepseek"],
      ["qwen3-coder-next:free", "alibaba"],
      ["glm-4.7-free", "zhipuai"],
      ["kimi-k2.5-free", "moonshotai"],
      ["meta-llama/Llama-3.3-70B-Instruct", "meta"],
      ["muse-spark-1.2", "meta"],
      ["minimax-m2.5", "minimax"],
      ["mercury-coder-small", "inception"],
      ["codestral-latest", "mistral"],
      ["opencode/big-pickle", "opencode"],
      ["big-pickle", "opencode"],
    ];
    for (const [model, expectedId] of expected) {
      const hit = resolveStaticModelLogo(model);
      assert.ok(hit, `expected logo ID for ${model}`);
      assert.equal(hit.id, expectedId, `${model} -> ${hit.id}`);
      const svg = getBundledModelLogo(hit.id);
      assert.ok(svg, `missing SVG body for bundled lab '${hit.id}'`);
      assert.ok(svg.body.includes("currentColor"));
    }
  });

  it("prefers server-resolved dynamic logos in lookupModelLogo", () => {
    const dynamicSvg = { viewBox: "0 0 24 24", body: '<circle cx="12" cy="12" r="8" fill="currentColor"/>' };
    const hit = lookupModelLogo("aurora-1", {
      "aurora-1": { id: "starlight", svg: dynamicSvg },
    });
    assert.deepEqual(hit, { id: "starlight", svg: dynamicSvg });
    assert.equal(lookupModelLogo("completely-unknown-local-model"), null);
  });
});
