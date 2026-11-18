import type { Glyph } from "@/lib/prefs";

/**
 * A thumbnail of a section look, for the settings page.
 *
 * Choosing between "stacked" and "split bar" by name means imagining both;
 * a 28×18 sketch of each shape makes it a glance. Drawn in `currentColor`, so
 * the chosen look picks up the accent along with its label.
 */
export function LookGlyph({ glyph }: { glyph: Glyph }) {
  return (
    <svg
      viewBox="0 0 28 18"
      width={28}
      height={18}
      aria-hidden="true"
      fill="currentColor"
      className="look-glyph"
    >
      {SHAPES[glyph]}
    </svg>
  );
}

const SHAPES: Record<Glyph, React.ReactNode> = {
  squares: (
    <>
      {[0, 1, 2, 3, 4, 5].map((x) =>
        [0, 1, 2].map((y) => (
          <rect
            key={`${x}${y}`}
            x={1 + x * 4.4}
            y={2 + y * 5}
            width={3.4}
            height={3.4}
            rx={0.6}
            opacity={(x * 3 + y * 5) % 4 === 0 ? 1 : 0.35}
          />
        )),
      )}
    </>
  ),
  columns: (
    <>
      {[6, 10, 4, 13, 8, 15, 9].map((h, i) => (
        <rect key={i} x={1 + i * 3.8} y={17 - h} width={2.6} height={h} rx={0.5} />
      ))}
    </>
  ),
  cells: (
    <>
      {[0, 1].map((x) =>
        [0, 1].map((y) => (
          <g key={`${x}${y}`}>
            <rect x={1 + x * 14} y={2 + y * 8} width={6} height={1.6} rx={0.8} opacity={0.45} />
            <rect x={1 + x * 14} y={4.6 + y * 8} width={10} height={2.8} rx={1} />
          </g>
        )),
      )}
    </>
  ),
  list: (
    <>
      {[0, 1, 2, 3].map((y) => (
        <g key={y}>
          <rect x={1} y={2 + y * 4} width={11} height={1.8} rx={0.9} opacity={0.45} />
          <rect x={20} y={2 + y * 4} width={7} height={1.8} rx={0.9} />
        </g>
      ))}
    </>
  ),
  headline: (
    <>
      <rect x={1} y={2} width={8} height={1.6} rx={0.8} opacity={0.45} />
      <rect x={1} y={5} width={17} height={5} rx={1.2} />
      <polyline
        points="1,16 6,14 10,15 15,12 20,13 27,10"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.2}
        opacity={0.6}
      />
    </>
  ),
  tags: (
    <>
      <rect x={1} y={2} width={11} height={5} rx={2.5} />
      <rect x={14} y={2} width={13} height={5} rx={2.5} opacity={0.45} />
      <rect x={1} y={10} width={14} height={5} rx={2.5} opacity={0.45} />
      <rect x={17} y={10} width={10} height={5} rx={2.5} opacity={0.45} />
    </>
  ),
  line: (
    <>
      <polygon points="1,17 1,12 6,9 11,11 16,5 21,8 27,3 27,17" opacity={0.25} />
      <polyline
        points="1,12 6,9 11,11 16,5 21,8 27,3"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.4}
        strokeLinejoin="round"
      />
    </>
  ),
  compact: (
    <>
      {[4, 7, 3, 9, 6, 10, 5].map((h, i) => (
        <rect key={i} x={1 + i * 3.8} y={11 - h} width={2.6} height={h} rx={0.5} />
      ))}
      <rect x={1} y={14} width={26} height={1.8} rx={0.9} opacity={0.45} />
    </>
  ),
  split: (
    <>
      <rect x={1} y={4} width={15} height={4} rx={1} />
      <rect x={16.6} y={4} width={6} height={4} opacity={0.55} />
      <rect x={23.2} y={4} width={3.8} height={4} rx={1} opacity={0.3} />
      <rect x={1} y={12} width={5} height={1.8} rx={0.9} opacity={0.45} />
      <rect x={9} y={12} width={5} height={1.8} rx={0.9} opacity={0.45} />
      <rect x={17} y={12} width={5} height={1.8} rx={0.9} opacity={0.45} />
    </>
  ),
  table: (
    <>
      <rect x={1} y={2} width={26} height={1.6} rx={0.8} opacity={0.45} />
      {[0, 1, 2].map((y) => (
        <g key={y}>
          <rect x={1} y={6.5 + y * 3.8} width={9} height={1.8} rx={0.9} />
          <rect x={14} y={6.5 + y * 3.8} width={5} height={1.8} rx={0.9} opacity={0.6} />
          <rect x={22} y={6.5 + y * 3.8} width={5} height={1.8} rx={0.9} opacity={0.6} />
        </g>
      ))}
    </>
  ),
  hbars: (
    <>
      {[24, 15, 9, 5].map((w, y) => (
        <g key={y}>
          <rect x={1} y={1.5 + y * 4.2} width={26} height={1.6} rx={0.8} opacity={0.2} />
          <rect x={1} y={1.5 + y * 4.2} width={w} height={1.6} rx={0.8} />
        </g>
      ))}
    </>
  ),
  ring: (
    <>
      <circle cx={9} cy={9} r={6} fill="none" stroke="currentColor" strokeWidth={3} opacity={0.3} />
      <circle
        cx={9}
        cy={9}
        r={6}
        fill="none"
        stroke="currentColor"
        strokeWidth={3}
        strokeDasharray="22 40"
        transform="rotate(-90 9 9)"
      />
      <rect x={18} y={4} width={9} height={1.8} rx={0.9} opacity={0.45} />
      <rect x={18} y={8.2} width={7} height={1.8} rx={0.9} opacity={0.45} />
      <rect x={18} y={12.4} width={8} height={1.8} rx={0.9} opacity={0.45} />
    </>
  ),
  grid: (
    <>
      {[0, 1, 2].map((x) =>
        [0, 1, 2].map((y) => (
          <rect key={`${x}${y}`} x={1 + x * 9.3} y={2 + y * 5} width={7.4} height={1.8} rx={0.9} opacity={x === 2 ? 1 : 0.45} />
        )),
      )}
    </>
  ),
  full: (
    <>
      <rect x={1} y={2} width={26} height={3} rx={1.2} />
      <rect x={1} y={8} width={26} height={1.6} rx={0.8} opacity={0.45} />
      <rect x={1} y={11.5} width={26} height={1.6} rx={0.8} opacity={0.45} />
      <rect x={1} y={15} width={18} height={1.6} rx={0.8} opacity={0.45} />
    </>
  ),
};
