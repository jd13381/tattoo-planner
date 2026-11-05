// A schematic of the region being measured (front view, start at the bottom) with the tape line of the
// current wizard step highlighted. Hand-drawn shapes only, no images (src/body/measureGuide.ts).
import { LANDMARKS, type Diagram } from "../body/measureGuide.ts";
import type { RegionKind } from "../body/profile.ts";

/** Half width along the region, in schematic units, at t from 0 (start) to 1 (end); `len` its length. */
const OUTLINES: Record<RegionKind, { len: number; knots: [number, number][] }> = {
  arm: {
    len: 60,
    knots: [
      [0, 2.9],
      [0.225, 4.1],
      [0.36, 4.7],
      [0.45, 4.3],
      [0.53, 4.5],
      [0.72, 5],
      [0.82, 5.3],
      [0.93, 5.8],
      [1, 5],
    ],
  },
  leg: {
    len: 82,
    knots: [
      [0, 3.6],
      [0.15, 4.4],
      [0.36, 6],
      [0.42, 5.6],
      [0.51, 5.9],
      [0.6, 6.6],
      [0.75, 8],
      [0.95, 9.3],
      [1, 9.5],
    ],
  },
  torso: {
    len: 41,
    knots: [
      [0, 14],
      [0.29, 14.6],
      [0.63, 16.5],
      [0.86, 19],
      [0.94, 17],
      [1, 6.5],
    ],
  },
};

/** How much wider than to scale each kind is drawn. */
const WIDEN: Record<RegionKind, number> = { arm: 1.8, leg: 1.4, torso: 1 };

const W = 300;
const H = 270;
const CX = 150;
/** Bottom and top of the region in the drawing; the hand, foot or head go beyond. */
const Y0 = 228;
const Y1 = 36;

function halfWidth(kind: RegionKind, t: number): number {
  const k = OUTLINES[kind].knots;
  for (let i = 1; i < k.length; i++) {
    const [t0, w0] = k[i - 1]!;
    const [t1, w1] = k[i]!;
    if (t <= t1) {
      const f = (t - t0) / (t1 - t0);
      const e = (1 - Math.cos(Math.PI * f)) / 2; // smooth between knots
      return w0 + (w1 - w0) * e;
    }
  }
  return k[k.length - 1]![1];
}

export function MeasureDiagram({
  kind,
  diagram,
  label,
}: {
  kind: RegionKind;
  diagram: Diagram;
  label: string;
}) {
  if (diagram.kind === "height") return <HeightDiagram label={label} />;
  const { len, knots } = OUTLINES[kind];
  const maxHw = Math.max(...knots.map((k) => k[1]));
  // Fit the length into the drawing height and the width into ±80 px.
  const s = Math.min((Y0 - Y1) / len, 80 / maxHw);
  // Limbs are drawn wider than true to scale, so the tape lines stay readable.
  const wide = Math.min(WIDEN[kind], 80 / (maxHw * s));
  const top = Y0 - len * s;
  const y = (t: number) => Y0 - t * len * s;
  const hw = (t: number) => halfWidth(kind, t) * s * wide;
  const labelX = CX - maxHw * s * wide - 14;
  const ts = Array.from({ length: 41 }, (_, i) => i / 40);
  const right = ts.map((t) => `${(CX + hw(t)).toFixed(1)},${y(t).toFixed(1)}`);
  const left = ts.map((t) => `${(CX - hw(t)).toFixed(1)},${y(t).toFixed(1)}`).reverse();
  const outline = `M${right.join(" L")} L${left.join(" L")} Z`;
  const lineX = CX + maxHw * s * wide + 16;

  return (
    <svg
      className="measure-diagram"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`Where to measure: ${label}`}
    >
      <Extremities kind={kind} s={s} top={top} hw={hw} />
      <path className="md-outline" d={outline} />
      {/* The centre line, faint, for orientation. */}
      <line className="md-axis" x1={CX} x2={CX} y1={y(0)} y2={y(1)} />
      {LANDMARKS[kind].map((m) => (
        <g key={m.label} className="md-landmark">
          <line className="md-leader" x1={labelX + 4} x2={CX - hw(m.t)} y1={y(m.t)} y2={y(m.t)} />
          <circle cx={CX - hw(m.t)} cy={y(m.t)} r={3} />
          <text x={labelX} y={y(m.t) + 3.5} textAnchor="end">
            {m.label}
          </text>
        </g>
      ))}
      {diagram.kind === "girth" && (
        <g className="md-tape">
          {/* Back half dashed, front half solid: a band round the limb. */}
          <path
            className="md-tape-back"
            d={`M${CX - hw(diagram.at)},${y(diagram.at)} A${hw(diagram.at)},${hw(diagram.at) * 0.22} 0 0 1 ${CX + hw(diagram.at)},${y(diagram.at)}`}
          />
          <path
            d={`M${CX - hw(diagram.at)},${y(diagram.at)} A${hw(diagram.at)},${hw(diagram.at) * 0.22} 0 0 0 ${CX + hw(diagram.at)},${y(diagram.at)}`}
          />
        </g>
      )}
      {diagram.kind === "length" && (
        <g className="md-tape">
          <line
            className="md-leader"
            x1={CX + hw(diagram.from)}
            x2={lineX + 6}
            y1={y(diagram.from)}
            y2={y(diagram.from)}
          />
          <line
            className="md-leader"
            x1={CX + hw(diagram.to)}
            x2={lineX + 6}
            y1={y(diagram.to)}
            y2={y(diagram.to)}
          />
          <line x1={lineX} x2={lineX} y1={y(diagram.from)} y2={y(diagram.to)} />
          <path
            d={`M${lineX - 5},${y(diagram.to) + 7} L${lineX},${y(diagram.to)} L${lineX + 5},${y(diagram.to) + 7}`}
          />
          <path
            d={`M${lineX - 5},${y(diagram.from) - 7} L${lineX},${y(diagram.from)} L${lineX + 5},${y(diagram.from) - 7}`}
          />
        </g>
      )}
    </svg>
  );
}

/** Hand, foot or neck and head beyond the region, drawn in the neutral style. */
function Extremities({
  kind,
  s,
  top,
  hw,
}: {
  kind: RegionKind;
  s: number;
  top: number;
  hw: (t: number) => number;
}) {
  switch (kind) {
    case "arm":
      return (
        <>
          <ellipse className="md-neutral" cx={CX} cy={Y0 + 9 * s * 0.5} rx={hw(0) * 1.15} ry={9 * s * 0.55} />
          <ellipse className="md-neutral" cx={CX} cy={top} rx={hw(1) * 1.1} ry={hw(1) * 0.7} />
        </>
      );
    case "leg":
      return (
        <>
          <path
            className="md-neutral"
            d={`M${CX - hw(0)},${Y0} L${CX - hw(0)},${Y0 + 14} L${CX + hw(0) + 22},${Y0 + 16} L${CX + hw(0) + 22},${Y0 + 8} Q${CX + hw(0) + 6},${Y0 + 4} ${CX + hw(0)},${Y0} Z`}
          />
          <ellipse className="md-neutral" cx={CX} cy={top} rx={hw(1) * 1.05} ry={hw(1) * 0.35} />
        </>
      );
    case "torso":
      return (
        <>
          <rect
            className="md-neutral"
            x={CX - hw(1) * 0.85}
            y={top - 12}
            width={hw(1) * 1.7}
            height={14}
            rx={3}
          />
          <ellipse className="md-neutral" cx={CX} cy={top - 12 - 16} rx={hw(1) * 1.15} ry={18} />
          <path
            className="md-neutral"
            d={`M${CX - hw(0)},${Y0} Q${CX - hw(0) * 1.12},${Y0 + 22} ${CX - hw(0) * 0.7},${Y0 + 34} L${CX + hw(0) * 0.7},${Y0 + 34} Q${CX + hw(0) * 1.12},${Y0 + 22} ${CX + hw(0)},${Y0} Z`}
          />
        </>
      );
  }
}

/** A standing figure with the height marked from the floor to the top of the head. */
function HeightDiagram({ label }: { label: string }) {
  const floor = 252;
  const head = 22;
  return (
    <svg
      className="measure-diagram"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`Where to measure: ${label}`}
    >
      <line className="md-axis" x1={60} x2={240} y1={floor} y2={floor} />
      <circle className="md-outline" cx={CX} cy={head + 16} r={15} />
      <path
        className="md-outline"
        d={`M${CX - 8},${head + 31} L${CX + 8},${head + 31} L${CX + 30},${head + 44} L${CX + 34},${head + 120} L${CX + 26},${head + 120} L${CX + 22},${head + 58} L${CX + 20},${head + 128} L${CX + 14},${floor} L${CX + 3},${floor} L${CX},${head + 140} L${CX - 3},${floor} L${CX - 14},${floor} L${CX - 20},${head + 128} L${CX - 22},${head + 58} L${CX - 26},${head + 120} L${CX - 34},${head + 120} L${CX - 30},${head + 44} Z`}
      />
      <g className="md-tape">
        <line className="md-leader" x1={CX - 16} x2={CX + 70} y1={head} y2={head} />
        <line x1={CX + 64} x2={CX + 64} y1={head} y2={floor} />
        <path d={`M${CX + 59},${head + 7} L${CX + 64},${head} L${CX + 69},${head + 7}`} />
        <path d={`M${CX + 59},${floor - 7} L${CX + 64},${floor} L${CX + 69},${floor - 7}`} />
      </g>
      <g className="md-landmark">
        <text x={CX - 24} y={head + 4} textAnchor="end">
          top of the head
        </text>
        <text x={CX - 24} y={floor - 6} textAnchor="end">
          floor
        </text>
      </g>
    </svg>
  );
}
