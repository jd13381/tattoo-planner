// Small schematic drawings for the projection wizard's steps (docs/adr/0014): what to do, drawn once
// for every body part. Plain SVG in the planner's colours; the camera picture places the sides as
// src/projection/sides.ts does (checked against the model in tests/projectionSides.test.ts).
import {
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { REGIONS, type RegionId } from "../body/regions.ts";
import { EDGE_COLOR } from "./PhotoEditor.tsx";
import { cameraAngle, describeFacing, facingAtAngle, sideChoices, snapFacing } from "./sides.ts";

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

/** Where a region sits on the picture of the person seen from above, and the camera's orbit round it. */
function partPlace(region: RegionId): { c: { x: number; y: number }; orbit: number } {
  const def = REGIONS[region];
  const sign = def.side === "right" ? -1 : 1; // the person's left is on the picture's right
  switch (def.kind) {
    case "torso":
      return { c: { x: 0, y: 0 }, orbit: 54 };
    case "arm":
      return { c: { x: sign * 47, y: 0 }, orbit: 22 };
    case "leg":
      return { c: { x: sign * 15, y: 0 }, orbit: 24 };
  }
}

/**
 * The person seen from above, facing the viewer (front at the bottom), with the body part highlighted
 * and a camera on a ring round it. Dragging the camera (or the arrow keys) turns it; it snaps to the
 * four sides (src/projection/sides.ts).
 */
export function CameraDial({
  region,
  value,
  onChange,
  label,
}: {
  region: RegionId;
  value: number;
  onChange: (u: number) => void;
  label: string;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [dragging, setDragging] = useState(false);
  const def = REGIONS[region];
  const kind = def.kind;
  const { c, orbit } = partPlace(region);
  const angle = cameraAngle(region, value);
  const rad = (angle * Math.PI) / 180;
  const cam = { x: c.x + orbit * Math.cos(rad), y: c.y + orbit * Math.sin(rad) };
  const sides = sideChoices(region);
  const near = describeFacing(region, value);

  const angleAt = (e: { clientX: number; clientY: number }) => {
    const m = svgRef.current?.getScreenCTM();
    if (!m) return null;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return (Math.atan2(p.y - c.y, p.x - c.x) * 180) / Math.PI;
  };
  const move = (e: ReactPointerEvent<SVGSVGElement>) => {
    const a = angleAt(e);
    if (a !== null) onChange(snapFacing(region, a));
  };
  const onKey = (e: ReactKeyboardEvent<SVGSVGElement>) => {
    const step = e.shiftKey ? 1 : 5;
    const d =
      e.key === "ArrowLeft" || e.key === "ArrowDown"
        ? -step
        : e.key === "ArrowRight" || e.key === "ArrowUp"
          ? step
          : null;
    if (d === null) return;
    e.preventDefault();
    onChange(facingAtAngle(region, angle + d));
  };

  const faint = kind === "leg";
  const part = (on: boolean) => (on ? "dial-part on" : "dial-part");
  return (
    <svg
      ref={svgRef}
      viewBox="-100 -72 200 152"
      className={`camera-dial${dragging ? " dragging" : ""}`}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={359}
      aria-valuenow={Math.round(angle)}
      aria-valuetext={
        near.turnDeg === 0 ? near.side.label : `${near.side.label}, turned ${Math.abs(near.turnDeg)} degrees`
      }
      onKeyDown={onKey}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        setDragging(true);
        move(e);
      }}
      onPointerMove={(e) => {
        if (dragging) move(e);
      }}
      onPointerUp={() => setDragging(false)}
      onPointerCancel={() => setDragging(false)}
    >
      <text x={-94} y={-62} className="dial-word">
        ↑ back
      </text>
      <text x={-94} y={74} className="dial-word">
        ↓ front
      </text>
      {/* The person from above: shoulders, head with the nose to the front, arms at the sides. */}
      <ellipse
        cx={0}
        cy={0}
        rx={36}
        ry={19}
        className={kind === "torso" ? part(true) : faint ? "dial-body faint" : "dial-body"}
      />
      {kind !== "leg" && (
        <>
          <circle cx={47} cy={0} r={8} className={part(region === "arm-left")} />
          <circle cx={-47} cy={0} r={8} className={part(region === "arm-right")} />
        </>
      )}
      {kind === "leg" && (
        <>
          <ellipse cx={15} cy={17} rx={5} ry={8} className="dial-foot" />
          <ellipse cx={-15} cy={17} rx={5} ry={8} className="dial-foot" />
          <circle cx={15} cy={0} r={11} className={part(region === "leg-left")} />
          <circle cx={-15} cy={0} r={11} className={part(region === "leg-right")} />
        </>
      )}
      {kind !== "leg" && (
        <>
          <circle cx={0} cy={-1} r={11} className="dial-head" />
          <path d="M-3 9 L0 14 L3 9 Z" className="dial-head" />
        </>
      )}
      {def.side && (
        <text x={c.x} y={c.y - orbit - 6} textAnchor="middle" className="dial-word">
          {def.label.toLowerCase()}
        </text>
      )}
      {/* The ring the camera moves on, the four sides on it, the camera and its line of sight. */}
      <circle cx={c.x} cy={c.y} r={orbit} className="dial-ring" />
      {sides.map((sd) => {
        const a = (sd.angle * Math.PI) / 180;
        return (
          <circle
            key={sd.u}
            cx={c.x + orbit * Math.cos(a)}
            cy={c.y + orbit * Math.sin(a)}
            r={2}
            className="dial-stop"
          />
        );
      })}
      <line x1={cam.x} y1={cam.y} x2={c.x} y2={c.y} className="dial-sight" />
      <g transform={`translate(${cam.x} ${cam.y}) rotate(${angle + 90})`} className="dial-camera">
        <rect x={-8} y={-2} width={16} height={11} rx={2} />
        <path d="M-4 -2 L0 -7 L4 -2 Z" />
      </g>
    </svg>
  );
}
