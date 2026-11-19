import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildLogoCatalogMap,
  extractModelVendor,
  inferLabFromModelName,
  normalizeLabId,
  renderSvgDocument,
  resolveModelLogoId,
  sanitizeLogoSvg,
  type ModelsDevModelsIndex,
} from "./logos.ts";
import type { ModelsDevCatalog } from "./catalog.ts";

describe("normalizeLabId", () => {
  it("maps vendor and provider aliases to canonical logo IDs", () => {
    assert.equal(normalizeLabId("x-ai"), "xai");
    assert.equal(normalizeLabId("z-ai"), "zhipuai");
    assert.equal(normalizeLabId("zai-coding-plan"), "zhipuai");
    assert.equal(normalizeLabId("meta-llama"), "meta");
    assert.equal(normalizeLabId("qwen"), "alibaba");
    assert.equal(normalizeLabId("moonshot"), "moonshotai");
    assert.equal(normalizeLabId("mistralai"), "mistral");
    assert.equal(normalizeLabId("kimi-for-coding"), "moonshotai");
    assert.equal(normalizeLabId("bad/id!"), null);
  });
});

describe("extractModelVendor & resolveModelLogoId", () => {
  it("prefers creator lab over resellers across all naming conventions", () => {
    const cases: [string, string][] = [
      ["claude-opus-4-6", "anthropic"],
      ["us.anthropic.claude-3-5-sonnet-20241022-v2:0", "anthropic"],
      ["openrouter/anthropic/claude-sonnet-4", "anthropic"],
      ["anthropic--claude-4-opus", "anthropic"],
      ["gpt-5.4", "openai"],
      ["o4-mini", "openai"],
      ["azure/gpt-4o", "openai"],
      ["gemini-3.1-pro-preview", "google"],
      ["openrouter/x-ai/grok-code-fast-1", "xai"],
      ["grok-code-fast-1", "xai"],
      ["accounts/fireworks/models/deepseek-v3", "deepseek"],
      ["qwen3-coder-next:free", "alibaba"],
      ["zai-coding-plan/glm-5", "zhipuai"],
      ["glm-4.7-free", "zhipuai"],
      ["kimi-k2.5-free", "moonshotai"],
      ["@cf/meta/llama-3.2-3b-instruct", "meta"],
      ["meta-llama/Llama-3.3-70B-Instruct", "meta"],
      ["muse-spark-1.2", "meta"],
      ["nvidia/llama-3.1-nemotron-70b-instruct", "nvidia"],
      ["minimax-m2.5", "minimax"],
      ["mercury-coder-small", "inception"],
      ["codestral-latest", "mistral"],
      ["opencode/big-pickle", "opencode"],
      ["big-pickle", "opencode"],
      ["phi-4", "microsoft"],
      ["amazon.nova-pro-v1:0", "amazon-bedrock"],
    ];

    for (const [model, expected] of cases) {
      assert.equal(
        resolveModelLogoId({ model }),
        expected,
        `expected ${model} -> ${expected}`,
      );
    }
  });

  it("uses dynamic modelLabs / familyLabs and falls back to pricing provider only when creator is unknown", () => {
    const modelLabs = { "aurora-2": "starlight" };
    const familyLabs = { comet: "celestial" };

    assert.equal(resolveModelLogoId({ model: "aurora-2", modelLabs }), "starlight");
    assert.equal(
      resolveModelLogoId({ model: "comet-pro", family: "comet", familyLabs }),
      "celestial",
    );
    // Reseller provider does not override known creator lab:
    assert.equal(
      resolveModelLogoId({ model: "claude-sonnet-4-5", provider: "openrouter" }),
      "anthropic",
    );
    // Completely custom model with pricing provider falls back cleanly:
    assert.equal(
      resolveModelLogoId({ model: "custom-router-model", provider: "together" }),
      "togetherai",
    );
  });

  it("extracts reseller and bare model name cleanly", () => {
    const extracted = extractModelVendor("openrouter/qwen/qwen3-coder:free");
    assert.equal(extracted.creator, "alibaba");
    assert.equal(extracted.reseller, "openrouter");
    assert.equal(extracted.bareModel, "qwen3-coder");
    assert.equal(inferLabFromModelName("claude-opus-5"), "anthropic");
  });
});

describe("buildLogoCatalogMap", () => {
  it("never lets multi-lab resellers or Vertex-Anthropic hijack creator labs or claude family", () => {
    const apiCatalog: ModelsDevCatalog = {
      "google-vertex-anthropic": {
        models: {
          "claude-3-5-sonnet@20241022": { family: "claude" },
        },
      },
      "sap-ai-core": {
        models: {
          "anthropic--claude-4-opus": { family: "claude" },
          "openai--gpt-5": { family: "gpt" },
        },
      },
      upstage: {
        models: {
          "solar-pro-3": { family: "solar-next" },
        },
      },
    };
    const modelsIndex: ModelsDevModelsIndex = {
      "anthropic/claude-opus-4-6": { family: "claude" },
      "upstage/solar-pro-3": { family: "solar-next" },
      "aistupidlevel/auto": { family: "router" },
      "starlight/supernova-1": { family: "supernova" },
    };

    const map = buildLogoCatalogMap(apiCatalog, modelsIndex);
    assert.equal(map.familyLabs.claude, undefined);
    assert.equal(map.modelLabs["anthropic--claude-4-opus"], undefined);
    assert.equal(map.modelLabs.auto, undefined);
    assert.equal(map.modelLabs["supernova-1"], "starlight");
    assert.equal(map.familyLabs.supernova, "starlight");
  });
});

describe("sanitizeLogoSvg", () => {
  it("normalizes hardcoded fills to currentColor and preserves geometry", () => {
    const svg = sanitizeLogoSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M2 2h20v20H2z" fill="#111827"/></svg>',
    );
    assert.ok(svg);
    assert.equal(svg.viewBox, "0 0 24 24");
    assert.ok(svg.body.includes('fill="currentColor"'));
    assert.ok(!svg.body.includes("#111827"));
    const doc = renderSvgDocument(svg);
    assert.ok(doc.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"'));
  });

  it("preserves stroke-based icons and root stroke attributes", () => {
    const svg = sanitizeLogoSvg(
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 12h16"/></svg>',
    );
    assert.ok(svg);
    assert.ok(svg.body.includes('stroke="currentColor"'));
    assert.ok(svg.body.includes('stroke-width="2"'));
    assert.ok(svg.body.includes('fill="none"'));
  });

  it("rejects scripts, event handlers, image tags, and default sparkle fallback", () => {
    assert.equal(
      sanitizeLogoSvg('<svg viewBox="0 0 24 24"><script>alert(1)</script><path d="M0 0"/></svg>'),
      null,
    );
    assert.equal(
      sanitizeLogoSvg('<svg viewBox="0 0 24 24"><image href="https://evil.com/x.png"/></svg>'),
      null,
    );
    const cleanedAttr = sanitizeLogoSvg(
      '<svg viewBox="0 0 24 24"><path d="M0 0h10v10H0z" onclick="alert(1)" fill="red"/></svg>',
    );
    assert.ok(cleanedAttr);
    assert.ok(!cleanedAttr.body.includes("onclick"));
    assert.ok(cleanedAttr.body.includes('fill="currentColor"'));

    const sparkle =
      '<svg viewBox="0 0 24 24" fill="none"><path d="M9.8132 15.9038L9 18.75L8.18677 15.9038" fill="currentColor"/></svg>';
    assert.equal(sanitizeLogoSvg(sparkle), null);
    assert.equal(sanitizeLogoSvg('<svg viewBox="0 0 24 24"><path d="M1 1"/></svg>', '<svg viewBox="0 0 24 24"><path d="M1 1"/></svg>'), null);
  });
});
