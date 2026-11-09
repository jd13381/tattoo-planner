// Where was the camera (docs/adr/0023; the projection workspace's Camera tool, docs/adr/0024): the
// person seen from above with the camera on a ring, the four sides as big buttons and "a little from the
// side". One facing u, split into the nearest side and a small turn (src/projection/sides.ts); the
// picture places the sides as sides.ts does (checked against the model in tests/projectionSides.test.ts).
import {
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { REGIONS, type RegionId } from "../body/regions.ts";
import {
  cameraAngle,
  describeFacing,
  facingAtAngle,
  joinFacing,
  neighbours,
  sideChoices,
  snapFacing,
  splitFacing,
} from "./sides.ts";

/** The four sides as the picture shows them: front and back first, then its left and right. */
const sideOrder = (region: RegionId) =>
  [90, 270, 180, 0].map((a) => sideChoices(region).find((sd) => sd.angle === a)!);

export function SidePicker({
  region,
  value,
  onChange,
  compact,
}: {
  region: RegionId;
  value: number;
  /** `key` groups a run of changes (the slider, the dial) into one undo step. */
  onChange: (u: number, key?: string) => void;
  compact?: boolean;
}) {
  const { main, offset } = splitFacing(value);
  const [less, more] = neighbours(region, main);
  const now = describeFacing(region, value);
  return (
    <div className={`side-picker${compact ? " compact" : ""}`}>
      <CameraDial
        region={region}
        value={value}
        onChange={(u) => onChange(u, "camera-dial")}
        label="Camera position"
      />
      <div className="side-choices" role="radiogroup" aria-label="Side in the photo">
        {sideOrder(region).map((sd) => (
          <button
            key={sd.u}
            type="button"
            role="radio"
            aria-checked={sd.u === main}
            className={`side-choice${sd.u === main ? " current" : ""}`}
            onClick={() => onChange(sd.u)}
          >
            <span className="side-label">{sd.label}</span>
            {sd.hint && <span className="side-hint xs">{sd.hint}</span>}
          </button>
        ))}
      </div>
      <label className="wizard-field side-turn">
        <span className="field-label">
          A little from the side?{" "}
          <span className="faint">
            {now.turnDeg === 0
              ? "straight on"
              : `${Math.abs(now.turnDeg)}° towards the ${(now.turnDeg < 0 ? less : more).label.toLowerCase()}`}
          </span>
        </span>
        <input
          type="range"
          min={-45}
          max={45}
          step={1}
          value={Math.round(offset * 360)}
          aria-valuetext={now.turnDeg === 0 ? "straight on" : `${now.turnDeg} degrees`}
          onChange={(e) => onChange(joinFacing(main, Number(e.target.value) / 360), "camera-turn")}
        />
        <span className="side-turn-ends faint xs" aria-hidden="true">
          <span>← {less.label.toLowerCase()}</span>
          <span>{more.label.toLowerCase()} →</span>
        </span>
      </label>
    </div>
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
