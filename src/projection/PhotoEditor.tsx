// The photo of a projection with its calibration drawn on it (docs/adr/0006, docs/adr/0014): the model's
// skin grid, the silhouette edges and the two marks along the axis, the cm ruler and an edited version
// laid over it; edge ends and marks can be dragged or moved with the keys. Shared by the projection
// workspace (docs/adr/0024) and the Advanced calibration page.
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { RegionProfile } from "../body/profile.ts";
import type { AssetImage } from "../render/reference.ts";
import { modelGrid, photoFrame, turnedSize, twistReach, type GridLine } from "./model.ts";
import { editMapping } from "./patch.ts";
import type { PhotoStatus } from "./photoStatus.ts";
import { rulerTicks } from "./ruler.ts";
import type { EditFit, PhotoCalibration } from "./schema.ts";

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

/** Which handles can be dragged: all (Advanced), one kind (a workspace tool) or none. */
export type EditableHandles = "all" | "edges" | "marks" | "none";

/** A drag of a handle as one undo step: begins, ends, or is cancelled with Esc. */
export type GesturePhase = "start" | "end" | "cancel";

/** An edited version laid over the photo (docs/adr/0024, "Picture and frame"). */
export type PhotoOverlay = {
  image: Extract<AssetImage, { status: "ready" }>;
  fit?: EditFit;
  offset?: { x: number; y: number } | null;
  /** 0 hides it, 1 shows only the edit. */
  opacity: number;
};

/** Keyboard step of a focused handle, in the photo's 0..1 coordinates (Shift: ten times). */
const KEY_STEP = 0.002;

const ARROWS: Record<string, { x: number; y: number }> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
};

const r4 = (x: number) => Math.round(x * 10000) / 10000;

/** The edit drawn on the photo's frame as `cleaned_fit` lays it, then turned like the photo. */
function overlayImage(
  photo: { width: number; height: number },
  edit: Extract<AssetImage, { status: "ready" }>,
  fit: EditFit | undefined,
  turn: number,
): string | null {
  const m = editMapping(photo, edit, fit);
  const f = document.createElement("canvas");
  f.width = photo.width;
  f.height = photo.height;
  const g = f.getContext("2d");
  if (!g) return null;
  g.drawImage(edit.image, -m.ox / m.sx, -m.oy / m.sy, edit.width / m.sx, edit.height / m.sy);
  const size = turnedSize(photo.width, photo.height, turn as 0 | 90 | 180 | 270);
  const t = document.createElement("canvas");
  t.width = size.width;
  t.height = size.height;
  const tg = t.getContext("2d")!;
  tg.translate(size.width / 2, size.height / 2);
  tg.rotate((turn * Math.PI) / 180);
  tg.drawImage(f, -photo.width / 2, -photo.height / 2);
  return t.toDataURL("image/png");
}

/**
 * The turned photo with the calibration drawn on it. Edge ends and marks can be dragged, or focused
 * (Tab) and moved with the arrow keys; Esc during a drag puts the handle back.
 */
export function PhotoEditor(props: {
  photo: PhotoCalibration;
  image: Extract<AssetImage, { status: "ready" }>;
  profile: RegionProfile;
  /** `key` groups a run of key presses on one handle into one undo step. */
  onChange: (p: PhotoCalibration, key?: string) => void;
  /** Default "all". Handles that cannot be dragged are drawn faint. */
  editable?: EditableHandles;
  /** Draw the model's skin grid (default true). */
  grid?: boolean;
  /** Labels next to the marks (default "<cm> cm"). */
  markLabel?: (index: 0 | 1, cm: number) => string;
  /** Size of the handles relative to the Advanced page's (the workspace draws them larger). */
  handleScale?: number;
  /** A drag begins, ends or is cancelled (Esc): the workspace makes one undo step of it. */
  onGesture?: (phase: GesturePhase) => void;
  /** Draw the cm ruler along the left edge (region length, cm). */
  ruler?: { length: number } | null;
  /** The edited version laid over the photo. */
  overlay?: PhotoOverlay | null;
  /** The mark a landmark chip sets, drawn highlighted; clicking a mark picks it. */
  activeMark?: 0 | 1;
  onActiveMark?: (index: 0 | 1) => void;
}) {
  const {
    photo,
    image: ready,
    profile,
    onChange,
    editable = "all",
    grid: showGrid = true,
    markLabel,
    onGesture,
    overlay,
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
  const overlayImg = overlay?.image;
  const overlayFit = overlay?.fit;
  const overlayUrl = useMemo(
    () => (overlayImg ? overlayImage(ready, overlayImg, overlayFit, photo.turn) : null),
    [ready, overlayImg, overlayFit, photo.turn],
  );
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
  const r = (Math.max(size.width, size.height) / 120) * (props.handleScale ?? 1);
  const rulerLength = props.ruler?.length ?? null;
  const ticks = useMemo(
    () => (frame && rulerLength !== null ? rulerTicks(frame, rulerLength, r * 1.2, r * 1.1) : []),
    [frame, rulerLength, r],
  );
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<Handle | null>(null);

  // Esc while dragging puts the handle back (the workspace restores the state before the drag) and
  // does not leave the page: this listener runs first and marks the key as handled.
  const gestureRef = useRef(onGesture);
  useEffect(() => {
    gestureRef.current = onGesture;
  });
  useEffect(() => {
    if (!drag) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopImmediatePropagation();
      setDrag(null);
      gestureRef.current?.("cancel");
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [drag]);

  const toNorm = (e: { clientX: number; clientY: number }) => {
    const ctm = svgRef.current?.getScreenCTM();
    if (!ctm) return null;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    return { x: r4(p.x / size.width), y: r4(p.y / size.height) };
  };
  const moveHandle = (h: Handle, p: { x: number; y: number }, key?: string) => {
    if (h.kind === "edge") {
      const line = [...photo.edges[h.side]] as PhotoCalibration["edges"]["left"];
      line[h.end] = p;
      onChange({ ...photo, edges: { ...photo.edges, [h.side]: line } }, key);
    } else {
      const along = [...photo.along] as PhotoCalibration["along"];
      along[h.index] = { ...along[h.index], ...p };
      onChange({ ...photo, along }, key);
    }
  };
  const handlePoint = (h: Handle) => (h.kind === "edge" ? photo.edges[h.side][h.end] : photo.along[h.index]);
  const move = (e: ReactPointerEvent) => {
    if (!drag) return;
    const p = toNorm(e);
    if (p) moveHandle(drag, p);
  };
  const start = (h: Handle) => (e: ReactPointerEvent) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    if (h.kind === "along") props.onActiveMark?.(h.index);
    onGesture?.("start");
    setDrag(h);
  };
  const end = () => {
    if (!drag) return;
    setDrag(null);
    onGesture?.("end");
  };
  const onHandleKey = (h: Handle) => (e: ReactKeyboardEvent) => {
    const d = ARROWS[e.key];
    if (!d) return;
    e.preventDefault();
    e.stopPropagation();
    const k = (e.shiftKey ? 10 : 1) * KEY_STEP;
    const p = handlePoint(h);
    const id = h.kind === "edge" ? `${h.side}-${h.end}` : `mark-${h.index}`;
    moveHandle(h, { x: r4(p.x + d.x * k), y: r4(p.y + d.y * k) }, `key-${id}`);
  };
  const px = (q: { x: number; y: number }) => ({ x: q.x * size.width, y: q.y * size.height });
  const off = overlay?.offset ?? { x: 0, y: 0 };

  return (
    <div className="photo-frame photo-editor">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${size.width} ${size.height}`}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        role="group"
        aria-label={`Calibration of ${photo.file}`}
      >
        {turned && <image href={turned} width={size.width} height={size.height} />}
        {overlayUrl && overlay && overlay.opacity > 0 && (
          <image
            href={overlayUrl}
            x={off.x * size.width}
            y={off.y * size.height}
            width={size.width}
            height={size.height}
            opacity={overlay.opacity}
            className="photo-overlay"
          />
        )}
        {grid.map((l, i) => (
          <polyline
            key={i}
            points={l.pts.map((p) => `${p.x},${p.y}`).join(" ")}
            fill="none"
            stroke={GRID_COLORS[l.kind]}
            strokeWidth={l.kind === "u" || l.kind === "s" ? r / 6 : r / 3}
          />
        ))}
        {ticks.length > 0 && (
          <g className="photo-ruler" aria-hidden="true">
            {ticks.map((t) => (
              <g key={t.cm}>
                <line
                  x1={t.a.x}
                  y1={t.a.y}
                  x2={t.b.x}
                  y2={t.b.y}
                  stroke="#fff"
                  strokeWidth={t.major ? r / 4 : r / 7}
                />
                {t.major && (
                  <text
                    x={t.b.x + (t.b.x - t.a.x) * 0.6}
                    y={t.b.y + r * 0.6}
                    fontSize={r * 1.6}
                    textAnchor="middle"
                    fill="#fff"
                    stroke="#000"
                    strokeWidth={r / 8}
                  >
                    {t.cm}
                  </text>
                )}
              </g>
            ))}
          </g>
        )}
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
                    tabIndex={0}
                    role="button"
                    aria-label={`${side} edge, ${end === 0 ? "first" : "second"} end: arrow keys move it`}
                    onPointerDown={start({ kind: "edge", side, end: end as 0 | 1 })}
                    onKeyDown={onHandleKey({ kind: "edge", side, end: end as 0 | 1 })}
                  >
                    <title>{`${side} edge`}</title>
                  </circle>
                ))}
            </g>
          );
        })}
        {photo.along.map((m, index) => {
          const p = px(m);
          const active = canMarks && props.activeMark === index;
          return (
            <g key={index} className={`${canMarks ? "mark" : "mark inactive"}${active ? " active" : ""}`}>
              <circle
                cx={p.x}
                cy={p.y}
                r={canMarks ? r : r / 2}
                className={canMarks ? "handle" : undefined}
                data-handle={`mark-${index}`}
                fill="rgba(229, 57, 53, 0.4)"
                stroke={active ? "#fff" : "#e53935"}
                strokeWidth={active ? r / 2.5 : r / 4}
                tabIndex={canMarks ? 0 : undefined}
                role={canMarks ? "button" : undefined}
                aria-label={canMarks ? `Point ${index + 1}, ${m.cm} cm: arrow keys move it` : undefined}
                onFocus={canMarks ? () => props.onActiveMark?.(index as 0 | 1) : undefined}
                onPointerDown={canMarks ? start({ kind: "along", index: index as 0 | 1 }) : undefined}
                onKeyDown={canMarks ? onHandleKey({ kind: "along", index: index as 0 | 1 }) : undefined}
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
