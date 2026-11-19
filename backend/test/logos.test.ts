import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createLogoResolver } from "../src/refresh-logos.ts";

describe("createLogoResolver", () => {
  it("resolves known static logos with zero catalog or SVG network calls", async () => {
    let catalogCalls = 0;
    let svgCalls = 0;
    let dbCalls = 0;

    const resolver = createLogoResolver({
      fetchCatalogs: async () => {
        catalogCalls += 1;
        return { changed: false, api: null, models: null, etags: { api: null, models: null } };
      },
      fetchSvg: async () => {
        svgCalls += 1;
        return null;
      },
      pricingProviders: async () => {
        dbCalls += 1;
        return {};
      },
    });

    const resolved = await resolver.resolveModels(["claude-opus-4-6", "gpt-5.4", "glm-5"], {
      knownStaticLogos: new Set(["anthropic", "openai", "zhipuai"]),
    });

    assert.deepEqual(resolved, {
      "claude-opus-4-6": { id: "anthropic" },
      "gpt-5.4": { id: "openai" },
      "glm-5": { id: "zhipuai" },
    });
    assert.equal(catalogCalls, 0);
    assert.equal(svgCalls, 0);
    assert.equal(dbCalls, 0);
  });

  it("discovers new lab models from live models.dev, prefers creator lab over DB reseller, and caches dynamically fetched SVGs", async () => {
    let now = 1_000_000;
    let catalogCalls = 0;
    const svgFetchedFor: string[] = [];

    const starlightSvg = { viewBox: "0 0 24 24", body: '<path d="M12 2L14 10L22 12L14 14L12 22Z" fill="currentColor"/>' };

    const resolver = createLogoResolver({
      now: () => now,
      fetchCatalogs: async (etags) => {
        catalogCalls += 1;
        return {
          changed: true,
          api: {
            openrouter: { models: { "starlight/aurora-1": { family: "aurora" } } },
          },
          models: {
            "starlight/aurora-1": { family: "aurora" },
          },
          etags: { api: '"api-v1"', models: '"models-v1"' },
        };
      },
      fetchSvg: async (id) => {
        svgFetchedFor.push(id);
        return id === "starlight" ? starlightSvg : null;
      },
      pricingProviders: async () => ({
        "aurora-1": "openrouter",
        "private-custom-model": "together",
      }),
    });

    const knownStaticLogos = new Set(["anthropic", "togetherai"]);
    const first = await resolver.resolveModels(["aurora-1", "unknown-local-x"], {
      knownStaticLogos,
    });

    assert.deepEqual(first["aurora-1"], { id: "starlight", svg: starlightSvg });
    assert.equal(first["unknown-local-x"], undefined);
    assert.equal(catalogCalls, 1);
    assert.deepEqual(svgFetchedFor, ["starlight"]);

    // Subsequent request within 10-minute throttle uses cached SVG for aurora-1 and does not hammer models.dev for unknown-local-x.
    now += 60_000;
    const second = await resolver.resolveModels(["aurora-1", "unknown-local-x"], {
      knownStaticLogos,
    });
    assert.deepEqual(second["aurora-1"], { id: "starlight", svg: starlightSvg });
    assert.equal(catalogCalls, 1);
    assert.deepEqual(svgFetchedFor, ["starlight"]);

    // Model unknown to models.dev still falls back to pricing table provider when in static bundle.
    const dbFallback = await resolver.resolveModels(["private-custom-model"], {
      knownStaticLogos,
    });
    assert.deepEqual(dbFallback["private-custom-model"], { id: "togetherai" });
  });
});
