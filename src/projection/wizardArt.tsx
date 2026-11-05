// Small schematic drawings for the projection wizard's steps (docs/adr/0014): what to do, drawn once
// for every body part. Plain SVG in the planner's colours; the orientation thumbnails are computed
// from the same cross-section maths as the model (wizard.ts sectionSketch).
import type { RegionId } from "../body/regions.ts";
import { EDGE_COLOR } from "./PhotoEditor.tsx";
import { sectionSketch } from "./wizard.ts";

const SKIN = "#d9b49a";
const SKIN_EDGE = "#8a6a55";
const INK = "#2b2b33";
const RED = "#e53935";

/** A limb standing upright, tapering towards its start at the bottom. */
function Limb({ ink = true }: { ink?: boolean }) {
  return (
    <>
      <path d="M38 8 L82 8 L74 112 L46 112 Z" fill={SKIN} stroke={SKIN_EDGE} strokeWidth={1} />
      {ink && <path d="M54 40 q6 -10 12 0 q4 12 -6 22 q-10 -10 -6 -22 Z" fill={INK} opacity={0.85} />}
    </>
  );
}

export function TurnArt() {
  return (
    <svg viewBox="0 0 120 120" className="wizard-art" aria-hidden="true">
      <Limb />
      <path d="M100 30 L100 96" stroke="currentColor" strokeWidth={2} markerEnd="url(#wa-arrow)" />
      <defs>
        <marker
          id="wa-arrow"
          viewBox="0 0 10 10"
          refX="5"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto"
        >
          <path d="M0 0 L10 5 L0 10 Z" fill="currentColor" />
        </marker>
      </defs>
      <text x={60} y={119} textAnchor="middle" fontSize={9} fill="currentColor">
        start
      </text>
    </svg>
  );
}

export function EdgesArt() {
  return (
    <svg viewBox="0 0 120 120" className="wizard-art" aria-hidden="true">
      <Limb />
      <line x1={38} y1={8} x2={46} y2={112} stroke={EDGE_COLOR} strokeWidth={2.5} />
      <line x1={82} y1={8} x2={74} y2={112} stroke={EDGE_COLOR} strokeWidth={2.5} />
      {[
        [38, 8],
        [46, 112],
        [82, 8],
        [74, 112],
      ].map(([x, y]) => (
        <circle
          key={`${x}-${y}`}
          cx={x}
          cy={y === 8 ? 12 : 108}
          r={4.5}
          fill="rgba(255,152,0,0.5)"
          stroke={EDGE_COLOR}
        />
      ))}
    </svg>
  );
}

export function MarksArt() {
  return (
    <svg viewBox="0 0 120 120" className="wizard-art" aria-hidden="true">
      <Limb />
      <line x1={36} y1={104} x2={84} y2={104} stroke={INK} strokeDasharray="3 2" />
      <circle cx={60} cy={104} r={4} fill="rgba(229,57,53,0.4)" stroke={RED} />
      <circle cx={60} cy={30} r={4} fill="rgba(229,57,53,0.4)" stroke={RED} />
      <line x1={100} y1={104} x2={100} y2={30} stroke="currentColor" />
      <line x1={96} y1={104} x2={104} y2={104} stroke="currentColor" />
      <line x1={96} y1={30} x2={104} y2={30} stroke="currentColor" />
      <text
        x={104}
        y={70}
        fontSize={10}
        fill="currentColor"
        transform="rotate(-90 104 70)"
        textAnchor="middle"
      >
        cm
      </text>
    </svg>
  );
}

/**
 * One orientation thumbnail: the cross-section seen from above with the camera below it, the side
 * facing the camera at the bottom and the four centre lines labelled.
 */
export function FacingThumb({ region, u }: { region: RegionId; u: number }) {
  const sketch = sectionSketch(region, u);
  const k = 30;
  const pt = (p: { x: number; y: number }) => `${50 + p.x * k},${42 + p.y * k}`;
  return (
    <svg viewBox="0 0 100 100" className="facing-thumb" aria-hidden="true">
      <polygon points={sketch.outline.map(pt).join(" ")} fill={SKIN} stroke={SKIN_EDGE} />
      {sketch.lines.map((l) => {
        const out = { x: l.p.x * 1.32, y: l.p.y * 1.32 };
        const [x, y] = pt(out).split(",").map(Number) as [number, number];
        return (
          <g key={l.u}>
            <circle cx={50 + l.p.x * k} cy={42 + l.p.y * k} r={2.2} fill={l.u === 0.5 ? RED : INK} />
            <text x={x} y={y + 3} fontSize={9} textAnchor="middle" fill="currentColor">
              {l.label}
            </text>
          </g>
        );
      })}
      {/* The camera, looking up at the limb. */}
      <rect x={42} y={86} width={16} height={10} rx={2} fill="currentColor" opacity={0.75} />
      <path d="M46 86 L50 80 L54 86 Z" fill="currentColor" opacity={0.75} />
    </svg>
  );
}
