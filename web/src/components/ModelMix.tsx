import type { ModelSlice } from "@/lib/site-stats";
import type { LogoMap } from "@/lib/logos";
import { ModelLogo, ModelName } from "./BrandLogo";
import { ModelRing, type RingSlice } from "./ModelRing";
import { compact, count, money, percent } from "@/lib/format";
import { modelLabel } from "@/lib/pricing";

/**
 * Which models the work actually ran on.
 *
 * Two questions, so two views of the same rows. The ring answers "what is
 * everyone using", which is a share and only needs to be read at a glance. The
 * table answers "what does each one cost to run", which is a comparison and
 * needs real numbers lined up in columns.
 *
 * The palette is the site's five colours, so the ring cannot give eight models
 * eight hues. It does what the numbers do anyway: the top few are named and
 * the tail is one slice, on a ramp from `--main` down toward the background.
 * Every segment is labelled in the legend, so the shade never has to carry the
 * meaning on its own.
 */

/** Named slices before the tail is folded into one. */
const NAMED = 5;

/**
 * `--main` stepping down toward the page, one stop per slice.
 *
 * Written out rather than interpolated. A linear ramp puts the first two stops
 * within a few percent of each other, which on a ring means the largest two
 * segments read as one — the exact comparison the chart exists to make. These
 * follow the same steep falloff the cost bar already uses, and stop well short
 * of the background so the smallest slice is still visible.
 */
const RAMP = [100, 58, 38, 28, 22, 18] as const;

function shadeAt(index: number): string {
  if (index === 0) return "var(--main)";
  const strength = RAMP[Math.min(index, RAMP.length - 1)]!;
  return `color-mix(in srgb, var(--main) ${strength}%, var(--sub-alt))`;
}

export function ModelMix({
  models,
  windowDays,
  logoMap,
}: {
  models: ModelSlice[];
  windowDays: number;
  logoMap?: LogoMap;
}) {
  const totalTokens = models.reduce((sum, model) => sum + model.tokens, 0);
  const totalCost = models.reduce((sum, model) => sum + model.cost, 0);

  if (models.length === 0 || totalTokens === 0) {
    return (
      <section>
        <p className="block-label">models</p>
        <p className="empty">nothing reported in this window</p>
      </section>
    );
  }

  // Ranked by tokens for the ring, because the ring is a share of work done.
  // The table below stays ranked by spend, which is the other question.
  const byTokens = [...models].sort((a, b) => b.tokens - a.tokens);
  const head = byTokens.slice(0, NAMED);
  const tail = byTokens.slice(NAMED);

  const slices: RingSlice[] = head.map((model, index) => ({
    key: model.model,
    label: modelLabel(model.model),
    share: model.tokens / totalTokens,
    tokens: model.tokens,
    cost: model.cost,
    costShare: totalCost > 0 ? model.cost / totalCost : 0,
    requests: model.requests,
    users: model.users,
    models: 1,
    shade: shadeAt(index),
    icon: <ModelLogo model={model.model} logoMap={logoMap} />,
  }));

  if (tail.length > 0) {
    const sum = (read: (model: ModelSlice) => number) =>
      tail.reduce((total, model) => total + read(model), 0);
    const tokens = sum((model) => model.tokens);

    if (tokens > 0) {
      slices.push({
        key: "other",
        label: `other · ${tail.length}`,
        share: tokens / totalTokens,
        tokens,
        cost: sum((model) => model.cost),
        costShare: totalCost > 0 ? sum((model) => model.cost) / totalCost : 0,
        requests: sum((model) => model.requests),
        // Per-model counts are set sizes; the same person shows up in several
        // of them, so adding them up would invent developers.
        users: null,
        models: tail.length,
        shade: shadeAt(NAMED),
      });
    }
  }

  return (
    <section>
      <div className="row spread">
        <p className="block-label">models</p>
        <span className="micro">last {windowDays} days</span>
      </div>

      <ModelRing slices={slices} />

      <p className="micro mix-foot">
        Share of tokens processed, not share of developers: a cheap model can
        carry most of the work and almost none of the bill. The ring is ordered
        by tokens for that reason, and the table below by spend.
      </p>

      <div className="table-wrap">
        <table className="t">
          <thead>
            <tr>
              <th>model</th>
              <th className="r">spend</th>
              <th className="r">of spend</th>
              <th className="r">tokens</th>
              <th className="r">of tokens</th>
              <th className="r">requests</th>
              <th className="r">per request</th>
              <th className="r">effective</th>
              <th className="r">devs</th>
            </tr>
          </thead>
          <tbody>
            {models.map((model, index) => {
              const rate =
                model.tokens > 0 ? (model.cost / model.tokens) * 1_000_000 : 0;
              return (
                <tr
                  key={model.model}
                  className="rise"
                  style={{ "--i": index } as React.CSSProperties}
                >
                  <td>
                    <ModelName model={model.model} label={modelLabel(model.model)} logoMap={logoMap} />
                  </td>
                  <td className="r">{money(model.cost, 2)}</td>
                  <td className="r sub">{percent(model.cost, totalCost)}</td>
                  <td className="r sub">{compact(model.tokens)}</td>
                  <td className="r sub">
                    {percent(model.tokens, totalTokens)}
                  </td>
                  <td className="r sub">{count(model.requests)}</td>
                  <td className="r sub">
                    {model.requests > 0
                      ? `$${(model.cost / model.requests).toFixed(3)}`
                      : "—"}
                  </td>
                  <td className="r sub">
                    {rate >= 1 ? `$${rate.toFixed(2)}` : `$${rate.toFixed(3)}`}
                  </td>
                  <td className="r sub">{count(model.users)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="micro" style={{ marginTop: "0.9rem" }}>
        <strong>Effective</strong> is USD per million tokens actually billed,
        cache included. It is what the mix cost, not what the rate card says.
      </p>
    </section>
  );
}
