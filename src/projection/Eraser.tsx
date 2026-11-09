// The projection workspace's Clean up tool (docs/adr/0023-projection-cleanup.md, "Eraser";
// docs/adr/0024-projection-workspace.md): the combined patch as it goes onto the skin ("Ink only") with
// a brush that erases what is left of skin shadow, or restores it; "Photo" shows the patch as the photos
// have it, and holding Space shows the other one while it is held. The strokes and speck removal are
// the projection's `erase:` block, so the workspace's undo covers them; the maths is in erase.ts, this
// file only draws and listens.
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { isEditableTarget } from "../editor/shortcuts.ts";
import {
  BRUSH_MAX_CM,
  BRUSH_MIN_CM,
  composeView,
  extendStroke,
  paintStrokes,
  patchPxToUv,
  speckMask,
  specksToPx,
  type EraseSettings,
  type EraseStroke,
} from "./erase.ts";
import type { ProjectedPatch } from "./patch.ts";

/** The planner's plain skin (src/render/cmGrid.ts) and the tint of erased ink. */
const SKIN: [number, number, number] = [0xef, 0xe6, 0xdc];
const GHOST: [number, number, number] = [0xe9, 0x1e, 0x63];
const MAX_ZOOM = 16;

type Mode = "erase" | "restore";
/** Zoom 1 = the patch fits the pane; (cx, cy) = the patch pixel in the pane's middle. */
type View = { zoom: number; cx: number; cy: number };
/** Which picture the pane shows: the cleaned patch (painted on) or the photos as they are. */
export type CleanView = "ink" | "photo";

const clampSize = (cm: number) => Math.min(BRUSH_MAX_CM, Math.max(BRUSH_MIN_CM, Math.round(cm * 10) / 10));

export function EraserStage(props: {
  before: ProjectedPatch | null;
  /** The patch after ink only, before erasing (what the strokes apply to). */
  after: ProjectedPatch | null;
  erase: EraseSettings | null;
  onErase: (next: EraseSettings | null) => void;
  mirrored: boolean;
  /** Whether a clean-up is on at all (else the after view equals the photos). */
  cleaned: boolean;
}) {
  const { before, after, erase, onErase, mirrored } = props;
  const [mode, setMode] = useState<Mode>("erase");
  const [size, setSize] = useState(1);
  const [ghost, setGhost] = useState(true);
  const [show, setShow] = useState<CleanView>("ink");
  const [compare, setCompare] = useState(false);
  const [view, setView] = useState<View>({ zoom: 1, cx: NaN, cy: NaN });
  const [drawing, setDrawing] = useState<EraseStroke | null>(null);
  const drawingRef = useRef<EraseStroke | null>(null);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const strokes = useMemo(() => erase?.strokes ?? [], [erase]);
  const specks = erase?.specks_mm2 ?? 0;
  const W = after?.width ?? 1;
  const H = after?.height ?? 1;
  const centre = { cx: Number.isNaN(view.cx) ? W / 2 : view.cx, cy: Number.isNaN(view.cy) ? H / 2 : view.cy };
  // Space held shows the other picture (compare); letting go comes back.
  const shown: CleanView = compare ? (show === "ink" ? "photo" : "ink") : show;

  // Speck removal depends only on the patch and the size; the strokes go over it.
  const speckBase = useMemo(
    () => (after ? speckMask(after.ink, after.width, after.height, specksToPx(specks, after.pxPerCm)) : null),
    [after, specks],
  );
  const committed = useMemo(
    () => (after && speckBase ? paintStrokes(speckBase.slice(), strokes, after) : null),
    [after, speckBase, strokes],
  );
  const mask = useMemo(
    () => (committed && after && drawing ? paintStrokes(committed.slice(), [drawing], after) : committed),
    [committed, after, drawing],
  );
  const afterPixels = useMemo(
    () => (after ? composeView(after, mask, { skin: SKIN, ghost: ghost ? GHOST : null, mirrored }) : null),
    [after, mask, ghost, mirrored],
  );
  const beforePixels = useMemo(
    () => (before ? composeView(before, null, { skin: SKIN, mirrored }) : null),
    [before, mirrored],
  );

  const set = useCallback(
    (nextStrokes: EraseStroke[]) => onErase({ specks_mm2: specks, strokes: nextStrokes }),
    [onErase, specks],
  );
  const clear = () => {
    if (strokes.length > 0) set([]);
  };
  const zoomBy = (f: number, at?: { x: number; y: number }) =>
    setView((v) => {
      const zoom = Math.min(MAX_ZOOM, Math.max(1, v.zoom * f));
      const cx = Number.isNaN(v.cx) ? W / 2 : v.cx;
      const cy = Number.isNaN(v.cy) ? H / 2 : v.cy;
      if (!at) return { zoom, cx, cy };
      // Keep the patch point under the pointer where it is.
      const k = v.zoom / zoom;
      return { zoom, cx: at.x + (cx - at.x) * k, cy: at.y + (cy - at.y) * k };
    });
  const fit = () => setView({ zoom: 1, cx: NaN, cy: NaN });

  // Keys while this tool is on screen: E, R, [ ], 0, + and -; Space held compares. Undo and redo are
  // the workspace's (the strokes are part of its draft).
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => undefined);
  useEffect(() => {
    keyRef.current = (e: KeyboardEvent) => {
      const root = rootRef.current;
      if (e.defaultPrevented || e.isComposing || !root || root.closest("[hidden]")) return;
      if (document.querySelector("dialog[open]")) return;
      if (e.metaKey || e.ctrlKey || e.altKey || isEditableTarget(e.target)) return;
      const typing =
        e.target instanceof HTMLInputElement && !["range", "checkbox", "radio"].includes(e.target.type);
      if (typing) return;
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      const act = (fn: () => void) => {
        e.preventDefault();
        fn();
      };
      if (e.code === "Space" && !(e.target instanceof HTMLButtonElement)) act(() => setCompare(true));
      else if (key === "e") act(() => setMode("erase"));
      else if (key === "r") act(() => setMode("restore"));
      else if (key === "[") act(() => setSize((s) => clampSize(s / 1.25)));
      else if (key === "]") act(() => setSize((s) => clampSize(s * 1.25)));
      else if (key === "0") act(fit);
      else if (key === "+" || key === "=") act(() => zoomBy(1.5));
      else if (key === "-") act(() => zoomBy(1 / 1.5));
    };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keyRef.current(e);
    const onUp = (e: KeyboardEvent) => e.code === "Space" && setCompare(false);
    const onBlur = () => setCompare(false);
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  const ready = !!after;
  const stats = `${strokes.length} stroke${strokes.length === 1 ? "" : "s"}`;
  const inkLabel = props.cleaned ? "Ink only" : "Ink only (off)";
  return (
    <div className="eraser" ref={rootRef}>
      <div className="toolbar eraser-bar" role="toolbar" aria-label="Clean up">
        <span className="segmented" role="group" aria-label="Picture">
          <button
            type="button"
            className={shown === "ink" ? "active" : ""}
            aria-pressed={show === "ink"}
            onClick={() => setShow("ink")}
            title="What goes onto the skin: the cleaned picture, painted on with the brush"
          >
            {inkLabel}
          </button>
          <button
            type="button"
            className={shown === "photo" ? "active" : ""}
            aria-pressed={show === "photo"}
            onClick={() => setShow("photo")}
            title="The photos as they are, with skin and shadows (hold Space to compare)"
          >
            Photo
          </button>
        </span>
        <span className="toolbar-sep" aria-hidden="true" />
        <span className="segmented" role="group" aria-label="Brush">
          <button
            type="button"
            className={mode === "erase" ? "active" : ""}
            aria-pressed={mode === "erase"}
            aria-keyshortcuts="E"
            onClick={() => setMode("erase")}
            title="Paint over what is not tattoo to remove it (E)"
          >
            Eraser <kbd className="kbd">E</kbd>
          </button>
          <button
            type="button"
            className={mode === "restore" ? "active" : ""}
            aria-pressed={mode === "restore"}
            aria-keyshortcuts="R"
            onClick={() => setMode("restore")}
            title="Paint over erased ink to bring it back, also specks removed by size (R)"
          >
            Restore <kbd className="kbd">R</kbd>
          </button>
        </span>
        <label className="eraser-size" title="Brush size: [ smaller, ] larger">
          <span className="field-label">Size</span>
          <input
            type="range"
            min={BRUSH_MIN_CM}
            max={BRUSH_MAX_CM}
            step={0.1}
            value={size}
            aria-label="Brush size in cm"
            onChange={(e) => setSize(clampSize(Number(e.target.value)))}
          />
          <span className="mono xs eraser-size-value">{size.toFixed(1)} cm</span>
        </label>
        <button
          type="button"
          className="ghost"
          disabled={strokes.length === 0}
          onClick={clear}
          title={`Remove every stroke (${stats}); speck removal stays. Undo brings them back.`}
        >
          Clear erasing
        </button>
        <span className="spacer" />
        <label className="inline xs" title="Show the ink the eraser took away as a faint pink, to restore it">
          <input type="checkbox" checked={ghost} onChange={(e) => setGhost(e.target.checked)} /> Show erased
        </label>
        <span className="segmented eraser-zoom" role="group" aria-label="Zoom">
          <button
            type="button"
            onClick={() => zoomBy(1 / 1.5)}
            disabled={view.zoom <= 1}
            title="Zoom out (-)"
          >
            −
          </button>
          <button type="button" onClick={fit} title="Fit the whole tattoo (0)">
            <span className="mono">{Math.round(view.zoom * 100)}%</span>
          </button>
          <button
            type="button"
            onClick={() => zoomBy(1.5)}
            disabled={view.zoom >= MAX_ZOOM}
            title="Zoom in (+)"
          >
            +
          </button>
        </span>
      </div>
      <Pane
        label={
          shown === "photo"
            ? "Photo: the photos as they are, with skin and shadows"
            : props.cleaned
              ? "Ink only: what goes onto the skin"
              : "Ink only is off: the photos as they are"
        }
        hint="Drag to paint · hold Space to compare · right button + drag to move · pinch, Ctrl + wheel or + / − to zoom"
        pixels={shown === "photo" ? beforePixels : afterPixels}
        width={W}
        height={H}
        view={view}
        centre={centre}
        setView={setView}
        zoomBy={zoomBy}
        hover={hover}
        setHover={setHover}
        brushPx={(size / 2) * (after?.pxPerCm ?? 10)}
        brushMode={mode}
        interactive={ready && shown === "ink"}
        onStroke={(phase, x, y) => {
          if (!after) return;
          const px = mirrored ? W - x : x;
          const point = patchPxToUv(after, px, y);
          const cur = drawingRef.current;
          if (phase === "start")
            drawingRef.current = {
              size_cm: size,
              ...(mode === "restore" ? { restore: true } : {}),
              points: [point],
            };
          else if (phase === "move") drawingRef.current = cur ? extendStroke(cur, point, after) : null;
          else {
            drawingRef.current = null;
            if (cur) set([...strokes, extendStroke(cur, point, after)]);
          }
          setDrawing(drawingRef.current);
        }}
        empty="Building the picture from the photos…"
      />
    </div>
  );
}


/** One view of a patch: its pixels scaled to the pane by the shared view, the brush circle on top. */
function Pane(props: {
  label: string;
  hint?: string;
  pixels: Uint8ClampedArray | null;
  width: number;
  height: number;
  view: View;
  centre: { cx: number; cy: number };
  setView: (f: (v: View) => View) => void;
  zoomBy: (f: number, at?: { x: number; y: number }) => void;
  hover: { x: number; y: number } | null;
  setHover: (p: { x: number; y: number } | null) => void;
  brushPx: number;
  brushMode: Mode;
  interactive: boolean;
  onStroke?: (phase: "start" | "move" | "end", x: number, y: number) => void;
  empty: string;
}) {
  const { pixels, width: W, height: H, view, centre } = props;
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const drag = useRef<{ kind: "paint" | "pan"; x: number; y: number; id: number } | null>(null);

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setBox({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const fitScale = box.w > 0 && box.h > 0 ? Math.min(box.w / W, box.h / H) * 0.96 : 1;
  const scale = fitScale * view.zoom;
  const toPatch = useCallback(
    (sx: number, sy: number) => ({
      x: (sx - box.w / 2) / scale + centre.cx,
      y: (sy - box.h / 2) / scale + centre.cy,
    }),
    [box, scale, centre.cx, centre.cy],
  );

  const bitmap = useMemo(() => {
    if (!pixels) return null;
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    c.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(pixels), W, H), 0, 0);
    return c;
  }, [pixels, W, H]);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.max(1, Math.round(box.w * dpr));
    c.height = Math.max(1, Math.round(box.h * dpr));
    const g = c.getContext("2d");
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, box.w, box.h);
    if (!bitmap) return;
    g.imageSmoothingEnabled = scale < 3;
    const ox = box.w / 2 - centre.cx * scale;
    const oy = box.h / 2 - centre.cy * scale;
    g.drawImage(bitmap, ox, oy, W * scale, H * scale);
    g.strokeStyle = "rgba(128, 128, 128, 0.5)";
    g.lineWidth = 1;
    g.strokeRect(ox - 0.5, oy - 0.5, W * scale + 1, H * scale + 1);
    if (props.hover && props.interactive) {
      const x = ox + props.hover.x * scale;
      const y = oy + props.hover.y * scale;
      const r = Math.max(2, props.brushPx * scale);
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.lineWidth = 2;
      g.strokeStyle = "rgba(255, 255, 255, 0.9)";
      g.stroke();
      g.lineWidth = 1;
      g.setLineDash(props.brushMode === "restore" ? [4, 3] : []);
      g.strokeStyle = props.brushMode === "restore" ? "#1e88e5" : "#111";
      g.stroke();
      g.setLineDash([]);
    }
  }, [
    bitmap,
    box,
    scale,
    centre.cx,
    centre.cy,
    W,
    H,
    props.hover,
    props.brushPx,
    props.brushMode,
    props.interactive,
  ]);

  // Wheel: pinch / Ctrl or Cmd + wheel zooms at the pointer, plain wheel scrolls the view.
  const wheelRef = useRef<(e: WheelEvent) => void>(() => undefined);
  useEffect(() => {
    wheelRef.current = (e: WheelEvent) => {
      e.preventDefault();
      const r = canvasRef.current!.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        props.zoomBy(Math.exp(-e.deltaY * 0.01), toPatch(e.clientX - r.left, e.clientY - r.top));
      } else if (view.zoom > 1) {
        props.setView((v) => ({
          ...v,
          cx: (Number.isNaN(v.cx) ? W / 2 : v.cx) + e.deltaX / scale,
          cy: (Number.isNaN(v.cy) ? H / 2 : v.cy) + e.deltaY / scale,
        }));
      }
    };
  });
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const onWheel = (e: WheelEvent) => wheelRef.current(e);
    c.addEventListener("wheel", onWheel, { passive: false });
    return () => c.removeEventListener("wheel", onWheel);
  }, []);

  const local = (e: ReactPointerEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { sx: e.clientX - r.left, sy: e.clientY - r.top };
  };
  const onDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const { sx, sy } = local(e);
    const pan = e.button === 1 || e.button === 2 || !props.interactive;
    if (pan && view.zoom <= 1 && !props.interactive) return;
    if (!pan && e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { kind: pan ? "pan" : "paint", x: sx, y: sy, id: e.pointerId };
    if (!pan) {
      const p = toPatch(sx, sy);
      props.onStroke?.("start", p.x, p.y);
    }
  };
  const onMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const { sx, sy } = local(e);
    const p = toPatch(sx, sy);
    props.setHover(p);
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    if (d.kind === "pan") {
      const dx = (sx - d.x) / scale;
      const dy = (sy - d.y) / scale;
      d.x = sx;
      d.y = sy;
      props.setView((v) => ({
        ...v,
        cx: (Number.isNaN(v.cx) ? W / 2 : v.cx) - dx,
        cy: (Number.isNaN(v.cy) ? H / 2 : v.cy) - dy,
      }));
    } else props.onStroke?.("move", p.x, p.y);
  };
  const onUp = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    if (d.kind === "paint") {
      const { sx, sy } = local(e);
      const p = toPatch(sx, sy);
      props.onStroke?.("end", p.x, p.y);
    }
  };

  return (
    <figure className="eraser-pane">
      <div className="eraser-host" ref={hostRef}>
        <canvas
          ref={canvasRef}
          className={`eraser-canvas${props.interactive ? " paint" : ""}`}
          style={{ width: box.w, height: box.h }}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          onPointerLeave={() => props.setHover(null)}
          onContextMenu={(e) => e.preventDefault()}
          aria-label={props.label}
          role="img"
        />
        {!pixels && <p className="eraser-empty faint small">{props.empty}</p>}
      </div>
      <figcaption className="faint xs">
        {props.label}
        {props.hint && <span className="eraser-hint"> · {props.hint}</span>}
      </figcaption>
    </figure>
  );
}
