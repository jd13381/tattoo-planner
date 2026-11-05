// The photo of a projection with its calibration drawn on it (docs/adr/0006, docs/adr/0014): the model's
// skin grid, the silhouette edges and the two marks along the axis; edge ends and marks can be dragged.
// Shared by the guided wizard and the Advanced calibration page.
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { RegionProfile } from "../body/profile.ts";
import type { AssetImage } from "../render/reference.ts";
import { modelGrid, photoFrame, turnedSize, twistReach, type GridLine } from "./model.ts";
import type { PhotoStatus } from "./photoStatus.ts";
import type { PhotoCalibration } from "./schema.ts";

/** Stands in for the photo while it cannot be shown, and says why. */
export function PhotoPlaceholder({
  status,
  file,
}: {
  status: Exclude<PhotoStatus, { kind: "ready" }>;
  file: string;
}) {
  return (
    <div
      className={`photo-frame placeholder ${status.kind}`}
      role="img"
      aria-label={`${file}: ${status.title}`}
    >
      <div className="photo-placeholder">
        <strong>{status.title}</strong>
        {status.kind === "blocked" && <span>{status.detail}</span>}
      </div>
    </div>
  );
}

/** Mounts a canvas made outside React. */
export function CanvasHost({ canvas }: { canvas: HTMLCanvasElement }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.replaceChildren(canvas);
  }, [canvas]);
  return <div ref={ref} className="proj-patch-host" />;
}

type Handle = { kind: "edge"; side: "left" | "right"; end: 0 | 1 } | { kind: "along"; index: 0 | 1 };

export const EDGE_COLOR = "#ff9800";

export const GRID_COLORS: Record<GridLine["kind"], string> = {
  inner: "#e53935",
  side: "#43a047",
  u: "rgba(0, 200, 255, 0.7)",
  s10: "#d81b60",
  s: "rgba(255, 235, 59, 0.8)",
};

/** Which handles can be dragged: all (Advanced), one kind (a wizard step) or none. */
export type EditableHandles = "all" | "edges" | "marks" | "none";

/** The turned photo with the calibration drawn on it; edge ends and marks can be dragged. */
export function PhotoEditor(props: {
  photo: PhotoCalibration;
  image: Extract<AssetImage, { status: "ready" }>;
  profile: RegionProfile;
  onChange: (p: PhotoCalibration) => void;
  /** Default "all". Handles that cannot be dragged are drawn faint. */
  editable?: EditableHandles;
  /** Draw the model's skin grid (default true). */
  grid?: boolean;
  /** Labels next to the marks (default "<cm> cm"). */
  markLabel?: (index: 0 | 1, cm: number) => string;
  /** Size of the handles relative to the Advanced page's (the wizard draws them larger). */
  handleScale?: number;
}) {
  const {
    photo,
    image: ready,
    profile,
    onChange,
    editable = "all",
    grid: showGrid = true,
    markLabel,
  } = props;
  const canEdges = editable === "all" || editable === "edges";
  const canMarks = editable === "all" || editable === "marks";
  const size = turnedSize(ready.width, ready.height, photo.turn);
  const turned = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = size.width;
    c.height = size.height;
    const ctx = c.getContext("2d")!;
    ctx.translate(size.width / 2, size.height / 2);
    ctx.rotate((photo.turn * Math.PI) / 180);
    ctx.drawImage(ready.image, -ready.width / 2, -ready.height / 2);
    return c.toDataURL("image/jpeg", 0.85);
  }, [ready, photo.turn, size.width, size.height]);
  const frame = useMemo(
    () => photoFrame(photo, size.width, size.height, twistReach(profile)),
    [photo, size.width, size.height, profile],
  );
  // Up to a little beyond the twist reference, or beyond the higher mark when that lies further.
  const sMax = Math.max(twistReach(profile) + 2, Math.max(photo.along[0].cm, photo.along[1].cm) + 4);
  const grid = useMemo(
    () => (frame && showGrid ? modelGrid(frame, profile, { sMax }) : []),
    [frame, profile, showGrid, sMax],
  );
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<Handle | null>(null);

  const toNorm = (e: { clientX: number; clientY: number }) => {
    const ctm = svgRef.current?.getScreenCTM();
    if (!ctm) return null;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    const r = (x: number) => Math.round(x * 10000) / 10000;
    return { x: r(p.x / size.width), y: r(p.y / size.height) };
  };
  const move = (e: ReactPointerEvent) => {
    if (!drag) return;
    const p = toNorm(e);
    if (!p) return;
    if (drag.kind === "edge") {
      const line = [...photo.edges[drag.side]] as PhotoCalibration["edges"]["left"];
      line[drag.end] = p;
      onChange({ ...photo, edges: { ...photo.edges, [drag.side]: line } });
    } else {
      const along = [...photo.along] as PhotoCalibration["along"];
      along[drag.index] = { ...along[drag.index], ...p };
      onChange({ ...photo, along });
    }
  };
  const start = (h: Handle) => (e: ReactPointerEvent) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setDrag(h);
  };
  const px = (q: { x: number; y: number }) => ({ x: q.x * size.width, y: q.y * size.height });
  const r = (Math.max(size.width, size.height) / 120) * (props.handleScale ?? 1);

  return (
    <div className="photo-frame photo-editor">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${size.width} ${size.height}`}
        onPointerMove={move}
        onPointerUp={() => setDrag(null)}
        onPointerCancel={() => setDrag(null)}
        role="application"
        aria-label={`Calibration of ${photo.file}`}
      >
        {turned && <image href={turned} width={size.width} height={size.height} />}
        {grid.map((l, i) => (
          <polyline
            key={i}
            points={l.pts.map((p) => `${p.x},${p.y}`).join(" ")}
            fill="none"
            stroke={GRID_COLORS[l.kind]}
            strokeWidth={l.kind === "u" || l.kind === "s" ? r / 6 : r / 3}
          />
        ))}
        {(["left", "right"] as const).map((side) => {
          const [a, b] = photo.edges[side].map(px) as [{ x: number; y: number }, { x: number; y: number }];
          return (
            <g key={side} className={canEdges ? "edge" : "edge inactive"}>
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={EDGE_COLOR} strokeWidth={r / 3} />
              {canEdges &&
                [a, b].map((p, end) => (
                  <circle
                    key={end}
                    cx={p.x}
                    cy={p.y}
                    r={r}
                    className="handle"
                    data-handle={`edge-${side}-${end}`}
                    fill="rgba(255, 152, 0, 0.5)"
                    stroke={EDGE_COLOR}
                    strokeWidth={r / 4}
                    onPointerDown={start({ kind: "edge", side, end: end as 0 | 1 })}
                  >
                    <title>{`${side} edge`}</title>
                  </circle>
                ))}
            </g>
          );
        })}
        {photo.along.map((m, index) => {
          const p = px(m);
          return (
            <g key={index} className={canMarks ? "mark" : "mark inactive"}>
              <circle
                cx={p.x}
                cy={p.y}
                r={canMarks ? r : r / 2}
                className={canMarks ? "handle" : undefined}
                data-handle={`mark-${index}`}
                fill="rgba(229, 57, 53, 0.4)"
                stroke="#e53935"
                strokeWidth={r / 4}
                onPointerDown={canMarks ? start({ kind: "along", index: index as 0 | 1 }) : undefined}
              />
              <text
                x={p.x + r * 1.4}
                y={p.y + r / 2}
                fontSize={r * 2}
                fill="#fff"
                stroke="#000"
                strokeWidth={r / 6}
              >
                {markLabel ? markLabel(index as 0 | 1, m.cm) : `${m.cm} cm`}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
