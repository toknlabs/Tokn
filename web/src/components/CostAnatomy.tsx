import type { Anatomy, ReuseBenchmark, WhatIf } from "@/lib/backend";
import { ModelLogo } from "@/components/BrandLogo";
import { Cells, type Cell } from "@/components/Cells";
import type { LogoMap } from "@/lib/logos";

/**
 * Where the money went, and whether it had to.
 *
 * The point of this panel is one counterintuitive fact: on an agent workload
 * almost all of the bill is cache, and the completion everyone thinks about is
 * under a tenth of it. Showing that changes what someone does next, which is
 * the only reason to put a number on a page.
 *
 * Figures, not paragraphs. This section used to explain each number in a
 * sentence or three under it, and the explanations outweighed the numbers.
 * What stays is one short line where a figure cannot speak for itself.
 *
 * Everything here is measured. Nothing is shown unless there is enough data to
 * mean something: the reuse comparison needs a cohort, and a saving is only
 * named when there is one.
 */

const usd = (n: number): string =>
  n >= 100
    ? `$${Math.round(n).toLocaleString("en-US")}`
    : n >= 1
      ? `$${n.toFixed(2)}`
      : `$${n.toFixed(3)}`;

const pct = (n: number): string => `${(n * 100).toFixed(1)}%`;

/** A per-million rate. Cache reads run to fractions of a cent, so two decimals
 *  would collapse half the column to $0.00. */
const rate = (n: number): string =>
  n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(3)}`;

const compact = (n: number): string => {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(Math.round(n));
};

/** The four buckets as one bar, widest first. */
function Bar({ anatomy }: { anatomy: Anatomy }) {
  const { cost } = anatomy;
  if (cost.total <= 0) return null;

  const parts = [
    { key: "cache read", value: cost.cacheRead, shade: "var(--main)" },
    {
      key: "cache write",
      value: cost.cacheWrite,
      shade: "color-mix(in srgb, var(--main) 55%, var(--sub-alt))",
    },
    {
      key: "output",
      value: cost.output,
      shade: "color-mix(in srgb, var(--main) 25%, var(--sub-alt))",
    },
    { key: "input", value: cost.input, shade: "var(--sub-alt)" },
  ].filter((p) => p.value / cost.total > 0.001);

  return (
    <div
      style={{
        display: "flex",
        height: 6,
        borderRadius: 3,
        overflow: "hidden",
        margin: "1rem 0 1.1rem",
      }}
    >
      {parts.map((p) => (
        <div
          key={p.key}
          title={`${p.key} ${usd(p.value)}`}
          style={{
            width: `${(p.value / cost.total) * 100}%`,
            background: p.shade,
          }}
        />
      ))}
    </div>
  );
}

function Row({
  label,
  cost,
  tokens,
  share,
}: {
  label: string;
  cost: number;
  tokens: number;
  share: number;
}) {
  return (
    <tr>
      <td style={{ padding: "0.3rem 0", color: "var(--text)" }}>{label}</td>
      <td
        style={{
          textAlign: "right",
          color: "var(--sub)",
          paddingRight: "1.1rem",
        }}
      >
        {compact(tokens)}
      </td>
      <td
        style={{
          textAlign: "right",
          color: "var(--text)",
          paddingRight: "1.1rem",
        }}
      >
        {usd(cost)}
      </td>
      <td style={{ textAlign: "right", color: "var(--sub)", width: "3.4rem" }}>
        {pct(share)}
      </td>
    </tr>
  );
}

export function CostAnatomy({
  anatomy,
  benchmark,
  whatIf,
  own = false,
  compact: compactLook = false,
  logoMap,
}: {
  anatomy: Anatomy;
  benchmark: ReuseBenchmark;
  whatIf: WhatIf | null;
  own?: boolean;
  /** The "compact" look: the split and its table, nothing after them. */
  compact?: boolean;
  logoMap?: LogoMap;
}) {
  const { cost, tokens, reuse } = anatomy;
  if (cost.total <= 0) return null;

  const share = (n: number) => n / cost.total;

  return (
    <section>
      <p className="block-label">where the money went</p>
      <p className="block-value">
        {reuse.cacheShareOfCost > 0.5
          ? `${pct(reuse.cacheShareOfCost)} cache`
          : usd(cost.total)}
      </p>

      <Bar anatomy={anatomy} />

      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontSize: "0.8125rem",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        <thead>
          <tr className="micro">
            <th
              style={{
                textAlign: "left",
                fontWeight: 400,
                paddingBottom: "0.4rem",
              }}
            >
              bucket
            </th>
            <th
              style={{
                textAlign: "right",
                fontWeight: 400,
                paddingRight: "1.1rem",
              }}
            >
              tokens
            </th>
            <th
              style={{
                textAlign: "right",
                fontWeight: 400,
                paddingRight: "1.1rem",
              }}
            >
              cost
            </th>
            <th style={{ textAlign: "right", fontWeight: 400 }}>share</th>
          </tr>
        </thead>
        <tbody>
          <Row
            label="cache read"
            cost={cost.cacheRead}
            tokens={tokens.cacheRead}
            share={share(cost.cacheRead)}
          />
          <Row
            label="cache write"
            cost={cost.cacheWrite}
            tokens={tokens.cacheWrite5m + tokens.cacheWrite1h}
            share={share(cost.cacheWrite)}
          />
          <Row
            label="output"
            cost={cost.output}
            tokens={tokens.output}
            share={share(cost.output)}
          />
          <Row
            label="input"
            cost={cost.input}
            tokens={tokens.input}
            share={share(cost.input)}
          />
        </tbody>
      </table>

      {/* ------------------------------------------------------------ reuse */}

      {!compactLook && reuse.ratio !== null && (
        <div style={{ marginTop: "2.25rem" }}>
          <p className="block-label">cache reuse</p>
          <Cells items={reuseCells(reuse, benchmark, own)} />
          <p className="micro" style={{ marginTop: "0.8rem" }}>
            Tokens read from cache per token written. Higher is cheaper.
          </p>
        </div>
      )}

      {/* ---------------------------------------------------------- what if */}

      {!compactLook && whatIf && whatIf.rows.length > 0 && (
        <div style={{ marginTop: "2.25rem" }}>
          <p className="block-label" style={{ marginBottom: "0.75rem" }}>
            the same tokens, priced elsewhere
          </p>

          <div className="table-wrap">
            <table className="whatif">
              <thead>
                <tr>
                  <th>model</th>
                  <th className="r">total</th>
                  <th className="r">vs {own ? "yours" : "theirs"}</th>
                  <th className="r">per 1M</th>
                </tr>
              </thead>
              <tbody>
                {/* The anchor. Without it the percentages float free of the
                    figure they are measured against. */}
                <tr className="anchor">
                  <td>
                    {own ? "your" : "their"} mix
                    <span className="micro">
                      {" "}
                      &middot; {whatIf.actualModels.length} models
                    </span>
                  </td>
                  <td className="r">{usd(whatIf.actualUsd)}</td>
                  <td className="r sub">&mdash;</td>
                  <td className="r">{rate(whatIf.actualBlendedRate)}</td>
                </tr>

                {whatIf.rows.map((row) => {
                  const used = whatIf.actualModels.includes(row.model);
                  const cheaper = row.deltaUsd < 0;
                  return (
                    <tr
                      key={row.model}
                      title={`list price per 1M: ${rate(row.inputRate)} in, ${rate(row.outputRate)} out, ${rate(row.cacheReadRate)} cache read`}
                    >
                      <td
                        style={{ color: used ? "var(--main)" : "var(--text)" }}
                      >
                        <span className="brand-item">
                          <ModelLogo model={row.model} logoMap={logoMap} size={14} />
                          <span>{row.model.replace(/^claude-/, "")}</span>
                          {used && <span className="micro">&middot; used</span>}
                        </span>
                      </td>
                      <td className="r">{usd(row.costUsd)}</td>
                      <td
                        className="r"
                        style={{
                          color: cheaper ? "var(--main)" : "var(--sub)",
                        }}
                      >
                        {row.deltaUsd === 0 ? (
                          "—"
                        ) : (
                          <>
                            {cheaper ? "−" : "+"}
                            {Math.abs(row.deltaPct).toFixed(0)}%
                          </>
                        )}
                      </td>
                      <td className="r sub">{rate(row.blendedRate)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Kept, in one line: without it a cheaper model reads as a
              recommendation, and it is only a price. */}
          <p className="micro" style={{ marginTop: "0.8rem" }}>
            {compact(whatIf.tokens)} tokens at each model&rsquo;s list price.
            A weaker model may need more turns, which this does not count.
          </p>
        </div>
      )}
    </section>
  );
}

function reuseCells(
  reuse: Anatomy["reuse"],
  benchmark: ReuseBenchmark,
  own: boolean,
): Cell[] {
  const cells: Cell[] = [
    {
      k: "ratio",
      v: `${reuse.ratio!.toFixed(1)}:1`,
      note: `${compact(reuse.cacheRead)} read, ${compact(reuse.cacheWrite)} written`,
    },
  ];

  // Below a handful of people a median is theatre, and the backend says so by
  // returning none.
  if (benchmark.median === null || benchmark.rank === null) {
    cells.push({ k: "median", v: "—", idle: true, note: "too few people yet" });
    return cells;
  }

  cells.push(
    {
      k: "median",
      v: `${benchmark.median.toFixed(1)}:1`,
      note: `across ${benchmark.cohort} people`,
    },
    {
      k: "rank",
      v: `${ordinal(benchmark.rank)}`,
      note: `of ${benchmark.cohort}`,
    },
  );

  if (benchmark.headroomUsd !== null) {
    cells.push({
      k: "at the median",
      v: `−${usd(benchmark.headroomUsd)}`,
      note: own ? "you would have spent" : "they would have spent",
    });
  }

  return cells;
}

function ordinal(n: number): string {
  const suffix =
    n % 100 >= 11 && n % 100 <= 13
      ? "th"
      : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${suffix}`;
}
