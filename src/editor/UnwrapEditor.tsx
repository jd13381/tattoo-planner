import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import type { RegionProfile } from "../body/profile.ts";
import { REGIONS, type CentreLines } from "../body/regions.ts";
import { screenSign, wrapU } from "../body/uv.ts";
import type { ElementAspects } from "../layout/imageFit.ts";
import type { AreaShape, BackgroundLayer, Layout, LayoutElement } from "../layout/schema.ts";
import {
  nextInCycle,
  pickAllElements,
  resolveElement,
  wrapDelta,
  wrappedMidU,
  type ElementPatches,
  type ExistingSize,
  type Shape,
} from "../layout/shapes.ts";
import { addShape, addStroke, moveShape, shapeFromDrag, thinStroke } from "./backgroundOps.ts";
import { moveElement, movePoint } from "./edit.ts";
import type { BackgroundTool } from "./LayersPanel.tsx";
import {
  applyResize,
  formatSize,
  HANDLES,
  isCorner,
  resizeBox,
  resizeCursor,
  resizeOptions,
  skinAt,
  svgToSkin,
  type Box,
  type Handle,
  type ResizeOptions,
} from "./resize.ts";
import { placeTag, scaleLabelZones, type TagBounds, type TagRect } from "./tagPlacement.ts";
import { imagePlacement } from "./viewBox.ts";

type Props = {
  profile: RegionProfile;
  layout: Layout;
  existing: ExistingSize;
  /** Image proportions per element id (figures without a width take them). */
  aspects?: ElementAspects;
  /** Existing tattoos projected from photos (they sit where the photos put them and cannot move). */
  patches?: ElementPatches;
  /** Rendered unwrap for `centerU`; bumped `version` when it changes. */
  image: HTMLCanvasElement;
  version: number;
  centerU: number;
  /** Names of the centre lines at u = 0, 0.25, 0.5, 0.75 (for the edge labels); default the arm's. */
  lines?: CentreLines;
  selected: number | null;
  onSelect: (index: number | null) => void;
  /** `gesture` is the same for every change of one drag, so the caller can make it one undo step. */
  onChange: (index: number, element: LayoutElement, gesture?: string) => void;
  /** A drag ended (pointer up). */
  onGestureEnd?: () => void;
  /** The skin point under the pointer, null when it leaves the sheet (status bar readout). */
  onCursor?: (p: { u: number; v: number } | null) => void;
  /** The zoom in percent of the whole sheet (100 = fitted), whenever it changes. */
  onZoom?: (pct: number) => void;
  /** Changing this number fits the whole sheet again (the status bar's Fit button). */
  fitRequest?: number;
  /** A new `nonce` zooms about the middle of the view: factor > 1 zooms in (the status bar's − / +). */
  zoomRequest?: { factor: number; nonce: number };
  /** false leaves out the usage hint under the editor (the page shows EDITOR_HINT elsewhere). */
  hint?: boolean;
  /** Floats next to the selected figure or existing tattoo (e.g. "Change image"); hidden while dragging. */
  selectionAction?: ReactNode;
  /**
   * The Background view (docs/adr/0019): the elements are shown but cannot be picked; the selected
   * layer's area shapes and brush strokes are edited with the chosen tool instead.
   */
  background?: BackgroundEditing;
};

export type BackgroundEditing = {
  /** The selected layer, or null when none is selected. */
  layer: BackgroundLayer | null;
  tool: BackgroundTool;
  brushCm: number;
  selectedShape: number | null;
  onSelectShape: (index: number | null) => void;
  /** `gesture` is the same for every change of one drag (one undo step). */
  onChange: (layer: BackgroundLayer, gesture?: string) => void;
};

/** How to use the Background view's editor. */
export const BACKGROUND_HINT =
  "Background view: Rect / Ellipse drag a shape, Polygon clicks corners (Enter or the first corner closes, Esc cancels), Brush and Eraser paint the area. Select moves shapes; Delete removes the selected shape. Motifs are dimmed and cannot be picked here.";

/** How to use the editor, shown under it or as a tooltip. */
export const EDITOR_HINT =
  "Click to select, drag to move, Alt-click for the element underneath. Corner handles resize in proportion, edge handles stretch one side (Shift swaps this, Alt resizes from the centre, sizes snap to 0.5 cm unless Ctrl/⌘ is held); the round handle rotates. Drag the background to pan, scroll to zoom, double-click to reset. Seen from outside the arm, shoulder at the top.";

type Drag =
  | { kind: "pan"; startX: number; startY: number; box: ViewBox }
  | { kind: "move"; index: number; start: LayoutElement; u: number; v: number }
  | {
      kind: "resize";
      index: number;
      start: LayoutElement;
      /** The box when the drag started, in the SVG frame. */
      box: Box;
      handle: Handle;
      /** Pointer position when the drag started (SVG frame). */
      sx: number;
      sy: number;
      /** The width is not stored but follows the height (see applyResize). */
      widthDerived: boolean;
      /** The box and modifiers of the latest update, for the live label. */
      current: Box;
      opts: ResizeOptions;
    }
  | { kind: "rotate"; index: number; start: LayoutElement; cx: number; cy: number }
  | { kind: "point"; index: number; point: number; start: LayoutElement }
  | { kind: "shape-move"; index: number; start: AreaShape; u: number; v: number }
  | { kind: "draw-box"; shape: "rect" | "ellipse"; a: { x: number; y: number }; b: { x: number; y: number } }
  | { kind: "paint"; erase: boolean; svg: { x: number; y: number }[]; skin: { u: number; v: number }[] };

type ViewBox = { x: number; y: number; w: number; h: number };

/**
 * 2D editor on the skin unwrap. SVG units are cm; x grows to the right (towards medial on the left arm,
 * against u unless the region is mirrored), y from the region's end (the shoulder) down.
 */
export function UnwrapEditor(props: Props) {
  const {
    profile,
    layout,
    existing,
    aspects,
    patches,
    image,
    version,
    centerU,
    selected,
    onSelect,
    onChange,
    onGestureEnd,
    onCursor,
    onZoom,
    fitRequest,
    zoomRequest,
    hint = true,
    selectionAction,
    background: bg,
  } = props;
  // A polygon being drawn in the Background view: its corners so far (SVG frame and skin).
  const [poly, setPoly] = useState<{ x: number; y: number; u: number; v: number }[] | null>(null);
  const [polyCursor, setPolyCursor] = useState<{ x: number; y: number } | null>(null);
  const bgLayer = bg?.layer ?? null;
  const bgEditable = !!bgLayer && !bgLayer.locked;
  const bgTool = bg ? bg.tool : null;
  // A tool change or another layer drops an unfinished polygon (adjusting state during render).
  const polyKey = `${bgTool}|${bgLayer?.id}`;
  const [polySeen, setPolySeen] = useState(polyKey);
  if (polyKey !== polySeen) {
    setPolySeen(polyKey);
    setPoly(null);
  }
  const L = profile.length;
  const half = profile.maxCircumference / 2;
  // The lines a quarter turn left and right of the centre line, as seen on screen.
  const lineNames = props.lines ?? REGIONS["arm-left"].lines;
  const sign = screenSign(profile);
  const lineAt = (du: number) => lineNames[Math.round(wrapU(centerU + du) * 4) % 4]!;
  const edgeLabels = [lineAt(-sign * 0.25), lineAt(sign * 0.25)];
  // A margin of 1 cm around the sheet, and a little more above it for the two edge labels.
  const fullView = useMemo<ViewBox>(
    () => ({ x: -half - 1, y: -TOP_MARGIN_CM, w: 2 * half + 2, h: L + TOP_MARGIN_CM + 1 }),
    [half, L],
  );
  const [view, setView] = useState<ViewBox>(fullView);
  // Fit on request (adjusting state during render, so no extra effect pass).
  const [fitSeen, setFitSeen] = useState(fitRequest);
  if (fitRequest !== fitSeen) {
    setFitSeen(fitRequest);
    setView(fullView);
  }
  const [zoomSeen, setZoomSeen] = useState(zoomRequest?.nonce);
  if (zoomRequest && zoomRequest.nonce !== zoomSeen) {
    setZoomSeen(zoomRequest.nonce);
    const w = clampViewWidth(view.w / zoomRequest.factor, fullView.w);
    const k = w / view.w;
    setView({ x: view.x + (view.w - w) / 2, y: view.y + (view.h * (1 - k)) / 2, w, h: view.h * k });
  }
  const reportZoom = useEffectEvent((pct: number) => onZoom?.(pct));
  useEffect(() => reportZoom(Math.round((100 * fullView.w) / view.w)), [view.w, fullView.w]);
  const [drag, setDrag] = useState<Drag | null>(null);
  // Every drag gets its own id; all changes of one drag share it.
  const gestureSeq = useRef(0);
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // The rendered canvas is shown as it is (encoding it as a PNG data URL on every change cost
  // seconds per mode switch). It sits in a clipped layer behind the SVG and is placed with CSS to
  // match the SVG's viewBox. A canvas inside a <foreignObject> is drawn at the wrong place and size
  // when the browser composites it on the GPU (Chrome and Safari on a Mac), so it is kept out of the SVG.
  const hostRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    host.replaceChildren(image);
  }, [image, version]);

  const [svgSize, setSvgSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const ro = new ResizeObserver(() => setSvgSize({ w: svg.clientWidth, h: svg.clientHeight }));
    ro.observe(svg);
    return () => ro.disconnect();
  }, []);

  useLayoutEffect(() => {
    const svg = svgRef.current;
    const host = hostRef.current;
    if (!svg || !host) return;
    const box = imagePlacement(
      view,
      { w: svg.clientWidth, h: svg.clientHeight },
      { x: -half, y: 0, w: 2 * half, h: L },
    );
    const layer = host.parentElement;
    const wrapper = layer?.parentElement;
    if (layer && wrapper) {
      const a = svg.getBoundingClientRect();
      const b = wrapper.getBoundingClientRect();
      layer.style.left = `${a.left - b.left + svg.clientLeft}px`;
      layer.style.top = `${a.top - b.top + svg.clientTop}px`;
      layer.style.width = `${svg.clientWidth}px`;
      layer.style.height = `${svg.clientHeight}px`;
    }
    Object.assign(host.style, {
      left: `${box.x}px`,
      top: `${box.y}px`,
      width: `${box.w}px`,
      height: `${box.h}px`,
    });
  }, [view, svgSize, half, L, image, version]);

  const resolved = useMemo(
    () =>
      layout.elements.map((el) =>
        resolveElement(el, profile, existing, aspects?.get(el.id), patches?.get(el.id)),
      ),
    [layout, profile, existing, aspects, patches],
  );

  const labelZones = useMemo(() => scaleLabelZones(L), [L]);

  /** Screen (SVG) position of a skin point. */
  const toSvg = (u: number, y: number) => ({
    x: screenSign(profile) * wrapDelta(u - centerU) * profile.circumferenceAt(y),
    y: L - y,
  });

  // Where the selection action floats: right of the selected box's top-right corner, in pixels
  // of the editor element (measured after layout, since it depends on the SVG's on-screen box).
  const rootRef = useRef<HTMLDivElement>(null);
  const [actionAt, setActionAt] = useState<{ left: number; top: number } | null>(null);
  const selShape = selected !== null ? resolved[selected]?.shape : undefined;
  useLayoutEffect(() => {
    const svg = svgRef.current;
    const root = rootRef.current;
    const ctm = svg?.getScreenCTM();
    if (!selectionAction || !svg || !root || !ctm || selShape?.kind !== "box") {
      setActionAt(null);
      return;
    }
    const c = {
      x: -wrapDelta(selShape.uc - centerU) * profile.circumferenceAt(selShape.cy),
      y: L - selShape.cy,
    };
    const cos = Math.abs(Math.cos(selShape.rot));
    const sin = Math.abs(Math.sin(selShape.rot));
    const ex = (cos * selShape.w + sin * selShape.h) / 2;
    const ey = (sin * selShape.w + cos * selShape.h) / 2;
    const p = new DOMPoint(c.x + ex, c.y - ey).matrixTransform(ctm);
    const r = root.getBoundingClientRect();
    const s = svg.getBoundingClientRect();
    // Kept inside the visible sheet.
    const left = Math.min(Math.max(p.x, s.left + 4), s.right - 120) - r.left + 8;
    const top = Math.min(Math.max(p.y, s.top + 4), s.bottom - 32) - r.top;
    setActionAt({ left, top });
  }, [selectionAction, selShape, view, svgSize, centerU, profile, L]);

  const pointer = (e: { clientX: number; clientY: number }) => {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return null;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    return { sx: p.x, sy: p.y, ...svgToSkin(profile, centerU, p.x, p.y) };
  };

  // Screen pixels per SVG unit (cm), so handles and labels keep their size on screen at any zoom.
  const pxPerCm = svgSize.w > 0 && svgSize.h > 0 ? Math.min(svgSize.w / view.w, svgSize.h / view.h) : 10;
  const px = 1 / pxPerCm;

  /** Applies a resize drag for the pointer at (sx, sy) with the given modifier keys. */
  const updateResize = (
    d: Extract<Drag, { kind: "resize" }>,
    sx: number,
    sy: number,
    keys: { shiftKey: boolean; altKey: boolean; ctrlKey: boolean; metaKey: boolean },
  ) => {
    const opts = resizeOptions(d.handle, keys);
    const box = resizeBox(d.box, d.handle, sx - d.sx, sy - d.sy, opts);
    const moved = Math.abs(box.cx - d.box.cx) > 1e-9 || Math.abs(box.cy - d.box.cy) > 1e-9;
    const next = applyResize(d.start, box, {
      keepAspect: opts.keepAspect,
      widthDerived: d.widthDerived,
      position: moved ? svgToSkin(profile, centerU, box.cx, box.cy) : undefined,
    });
    onChange(d.index, next, `drag-${gestureSeq.current}`);
    setDrag({ ...d, current: box, opts });
  };

  // Modifier keys pressed or released mid-drag take effect at once, without moving the pointer.
  const lastPointer = useRef<{ sx: number; sy: number } | null>(null);
  const onModifierKey = useEffectEvent((e: KeyboardEvent) => {
    const p = lastPointer.current;
    if (drag?.kind === "resize" && p && ["Shift", "Alt", "Control", "Meta"].includes(e.key)) {
      e.preventDefault();
      updateResize(drag, p.sx, p.sy, e);
    }
  });
  const resizing = drag?.kind === "resize";
  useEffect(() => {
    if (!resizing) return;
    const on = (e: KeyboardEvent) => onModifierKey(e);
    window.addEventListener("keydown", on);
    window.addEventListener("keyup", on);
    return () => {
      window.removeEventListener("keydown", on);
      window.removeEventListener("keyup", on);
    };
  }, [resizing]);

  const startDrag = (e: ReactPointerEvent, next: Drag) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    gestureSeq.current += 1;
    setDrag(next);
  };

  const finishPolygon = (pts: { u: number; v: number }[]) => {
    setPoly(null);
    if (!bg || !bgLayer || pts.length < 3) return;
    const shape: AreaShape = {
      kind: "polygon",
      points: pts.map((p) => ({ u: Math.round(p.u * 1000) / 1000, v: Math.round(p.v * 1000) / 1000 })),
    };
    bg.onChange(addShape(bgLayer, shape));
    bg.onSelectShape(bgLayer.shapes?.length ?? 0);
  };
  const onPolyKey = useEffectEvent((e: KeyboardEvent) => {
    if (!poly) return;
    if (e.key === "Enter") {
      e.preventDefault();
      finishPolygon(poly);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setPoly(null);
    }
  });
  const drawingPoly = poly !== null;
  useEffect(() => {
    if (!drawingPoly) return;
    const on = (e: KeyboardEvent) => onPolyKey(e);
    window.addEventListener("keydown", on, true);
    return () => window.removeEventListener("keydown", on, true);
  }, [drawingPoly]);

  const endDrag = () => {
    if (drag?.kind === "draw-box" && bg && bgLayer) {
      const shape = shapeFromDrag(drag.shape, profile, centerU, drag.a, drag.b);
      if (shape) {
        bg.onChange(addShape(bgLayer, shape));
        bg.onSelectShape(bgLayer.shapes?.length ?? 0);
      }
    } else if (drag?.kind === "paint" && bg && bgLayer && drag.skin.length > 0) {
      bg.onChange(
        addStroke(bgLayer, {
          ...(drag.erase ? { erase: true } : {}),
          radius_cm: bg.brushCm,
          points: thinStroke(drag.svg, drag.skin),
        }),
      );
    } else if (drag && drag.kind !== "pan") onGestureEnd?.();
    lastPointer.current = null;
    setDrag(null);
  };

  /** Pointer down on the sheet in the Background view: start the tool's gesture. */
  const onBackgroundDown = (e: ReactPointerEvent): boolean => {
    if (!bg || !bgTool || bgTool === "select" || !bgEditable || e.button !== 0) return false;
    const p = pointer(e);
    if (!p) return true;
    if (bgTool === "rect" || bgTool === "ellipse") {
      startDrag(e, { kind: "draw-box", shape: bgTool, a: { x: p.sx, y: p.sy }, b: { x: p.sx, y: p.sy } });
    } else if (bgTool === "brush" || bgTool === "eraser") {
      startDrag(e, {
        kind: "paint",
        erase: bgTool === "eraser",
        svg: [{ x: p.sx, y: p.sy }],
        skin: [{ u: p.u, v: p.v }],
      });
    } else if (bgTool === "polygon") {
      e.stopPropagation();
      const first = poly?.[0];
      // A click near the first corner closes the polygon.
      if (poly && first && poly.length >= 3 && Math.hypot(p.sx - first.x, p.sy - first.y) < 10 * px) {
        finishPolygon(poly);
        return true;
      }
      setPoly([...(poly ?? []), { x: p.sx, y: p.sy, u: p.u, v: p.v }]);
    }
    return true;
  };

  const onShapeDown = (e: ReactPointerEvent, index: number) => {
    if (!bg || !bgLayer || bgTool !== "select") return;
    e.stopPropagation();
    bg.onSelectShape(index);
    const p = pointer(e);
    const shape = bgLayer.shapes?.[index];
    if (!p || !shape || bgLayer.locked) return;
    startDrag(e, { kind: "shape-move", index, start: shape, u: p.u, v: p.v });
  };

  const onElementDown = (e: ReactPointerEvent, index: number) => {
    const p = pointer(e);
    // Alt-click cycles through every element under the pointer, topmost first, without moving any.
    if (e.altKey && p) {
      e.stopPropagation();
      const hits = pickAllElements(resolved, profile, p.u, p.v);
      if (!hits.includes(index)) hits.unshift(index);
      onSelect(nextInCycle(hits, selected));
      return;
    }
    onSelect(index);
    const el = layout.elements[index]!;
    if (!p || el.locked || resolved[index]?.shape.kind === "patch") {
      e.stopPropagation();
      return;
    }
    startDrag(e, { kind: "move", index, start: el, u: p.u, v: p.v });
  };

  const onMove = (e: ReactPointerEvent) => {
    if (onCursor) {
      const ctm = svgRef.current?.getScreenCTM();
      const q = ctm && new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
      onCursor(q ? skinAt(profile, centerU, q.x, q.y) : null);
    }
    if (!drag) return;
    const p = pointer(e);
    if (!p) return;
    lastPointer.current = { sx: p.sx, sy: p.sy };
    const gesture = `drag-${gestureSeq.current}`;
    switch (drag.kind) {
      case "pan": {
        const ctm = svgRef.current?.getScreenCTM();
        if (!ctm) return;
        setView({
          ...drag.box,
          x: drag.box.x - (e.clientX - drag.startX) / ctm.a,
          y: drag.box.y - (e.clientY - drag.startY) / ctm.d,
        });
        return;
      }
      case "move":
        onChange(drag.index, moveElement(drag.start, wrapDelta(p.u - drag.u), p.v - drag.v), gesture);
        return;
      case "resize":
        updateResize(drag, p.sx, p.sy, e);
        return;
      case "rotate": {
        const deg = (Math.atan2(drag.cy - p.sy, p.sx - drag.cx) * 180) / Math.PI - 90;
        const norm = Math.round(((deg + 540) % 360) - 180);
        if (drag.start.type === "figure" || drag.start.type === "existing")
          onChange(drag.index, { ...drag.start, rotation_deg: norm }, gesture);
        return;
      }
      case "point":
        onChange(drag.index, movePoint(drag.start, drag.point, p.u, p.v), gesture);
        return;
      case "shape-move": {
        if (!bg || !bgLayer) return;
        const moved = moveShape(drag.start, wrapDelta(p.u - drag.u), p.v - drag.v);
        bg.onChange(
          { ...bgLayer, shapes: (bgLayer.shapes ?? []).map((s, i) => (i === drag.index ? moved : s)) },
          gesture,
        );
        return;
      }
      case "draw-box":
        setDrag({ ...drag, b: { x: p.sx, y: p.sy } });
        return;
      case "paint":
        setDrag({
          ...drag,
          svg: [...drag.svg, { x: p.sx, y: p.sy }],
          skin: [...drag.skin, { u: p.u, v: p.v }],
        });
        return;
    }
  };

  const onWheel = (e: React.WheelEvent) => {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM();
    if (!ctm) return;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    const f = Math.exp(e.deltaY * 0.0015);
    const w = clampViewWidth(view.w * f, fullView.w);
    const k = w / view.w;
    setView({ x: p.x - (p.x - view.x) * k, y: p.y - (p.y - view.y) * k, w, h: view.h * k });
  };

  return (
    <div className="unwrap-editor" ref={rootRef}>
      <div className="unwrap-image-layer" aria-hidden="true">
        <div ref={hostRef} className="unwrap-image-host" />
      </div>
      <svg
        ref={svgRef}
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        preserveAspectRatio="xMidYMid meet"
        onPointerDown={(e) => {
          if (onBackgroundDown(e)) return;
          if (bg) bg.onSelectShape(null);
          else onSelect(null);
          startDrag(e, { kind: "pan", startX: e.clientX, startY: e.clientY, box: view });
        }}
        onPointerMove={(e) => {
          if (poly) {
            const p = pointer(e);
            setPolyCursor(p ? { x: p.sx, y: p.sy } : null);
          }
          onMove(e);
        }}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={() => {
          setHover(null);
          onCursor?.(null);
        }}
        onWheel={onWheel}
        onDoubleClick={() => {
          if (poly) finishPolygon(poly);
          else setView(fullView);
        }}
        role="application"
        aria-label="Unwrap editor"
        className={
          drag?.kind === "pan"
            ? "panning"
            : drag?.kind === "resize"
              ? "resizing"
              : drag
                ? "dragging"
                : undefined
        }
        style={
          drag?.kind === "resize"
            ? ({ "--resize-cursor": resizeCursor(drag.handle, drag.box.rot) } as React.CSSProperties)
            : undefined
        }
      >
        <text className="edge-label" x={-half} y={-6 * px} style={{ fontSize: 10.5 * px }}>
          ← {edgeLabels[0]}
        </text>
        <text className="edge-label" x={half} y={-6 * px} textAnchor="end" style={{ fontSize: 10.5 * px }}>
          {edgeLabels[1]} →
        </text>
        {resolved.map((r, i) => (
          <ShapeOverlay
            passive={!!bg}
            key={r.element.id}
            shape={r.shape}
            title={`${r.element.id} (${r.element.type})${r.element.locked ? ", locked" : r.shape.kind === "patch" ? ", placed by its projection" : ""}. Alt-click selects the element underneath.`}
            selected={i === selected}
            hovered={i === hover && !drag}
            locked={!!r.element.locked || r.shape.kind === "patch"}
            toSvg={toSvg}
            profile={profile}
            centerU={centerU}
            onDown={(e) => onElementDown(e, i)}
            onEnter={() => setHover(i)}
            onLeave={() => setHover((h) => (h === i ? null : h))}
          />
        ))}
        {!bg && (
          <g className="shape-tags">
            {resolved.map((r, i) => (
              <ShapeTag
                key={r.element.id}
                label={r.element.id}
                bounds={shapeBounds(r.shape, toSvg, profile, centerU)}
                px={px}
                avoid={
                  i === selected && r.shape.kind === "box" && !r.element.locked
                    ? [...labelZones, rotateHandleZone(r.shape, toSvg, px)]
                    : labelZones
                }
                selected={i === selected}
                hovered={i === hover && !drag}
                locked={!!r.element.locked}
                fixed={r.shape.kind === "patch"}
                onDown={(e) => onElementDown(e, i)}
                onEnter={() => setHover(i)}
                onLeave={() => setHover((h) => (h === i ? null : h))}
              />
            ))}
          </g>
        )}
        {bg && bgLayer && (
          <AreaOverlay
            layer={bgLayer}
            toSvg={toSvg}
            profile={profile}
            px={px}
            selected={bg.selectedShape}
            selectable={bgTool === "select"}
            onDown={onShapeDown}
          />
        )}
        {drag?.kind === "draw-box" && <DrawPreview kind={drag.shape} a={drag.a} b={drag.b} />}
        {drag?.kind === "paint" && (
          <polyline
            className={`paint-preview${drag.erase ? " erase" : ""}`}
            points={drag.svg.map((q) => `${q.x},${q.y}`).join(" ")}
            style={{ strokeWidth: (bg?.brushCm ?? 1) * 2 }}
          />
        )}
        {poly && (
          <g className="poly-preview" pointerEvents="none">
            <polyline
              points={[...poly, ...(polyCursor ? [polyCursor] : [])].map((q) => `${q.x},${q.y}`).join(" ")}
            />
            {poly.map((q, k) => (
              <circle key={k} cx={q.x} cy={q.y} r={(k === 0 ? 5 : 3.5) * px} />
            ))}
          </g>
        )}
        {!bg &&
          selected !== null &&
          resolved[selected] &&
          !resolved[selected].element.locked &&
          resolved[selected].shape.kind !== "patch" && (
            <Handles
              shape={resolved[selected].shape}
              toSvg={toSvg}
              px={px}
              active={drag?.kind === "resize" ? drag.handle : null}
              onResize={(e, box, handle) => {
                const p = pointer(e);
                const el = layout.elements[selected]!;
                if (!p || (el.type !== "figure" && el.type !== "existing")) return;
                lastPointer.current = { sx: p.sx, sy: p.sy };
                startDrag(e, {
                  kind: "resize",
                  index: selected,
                  start: el,
                  box,
                  handle,
                  sx: p.sx,
                  sy: p.sy,
                  widthDerived: el.size_cm.w == null && !(el.type === "existing" && existing.width !== null),
                  current: box,
                  opts: resizeOptions(handle, e),
                });
              }}
              onRotate={(e, cx, cy) =>
                startDrag(e, { kind: "rotate", index: selected, start: layout.elements[selected]!, cx, cy })
              }
              onPoint={(e, point) =>
                startDrag(e, { kind: "point", index: selected, point, start: layout.elements[selected]! })
              }
            />
          )}
        {drag?.kind === "resize" && <ResizeFeedback drag={drag} px={px} view={view} />}
      </svg>
      {actionAt && !drag && selectionAction && (
        <div className="selection-action" style={{ left: actionAt.left, top: actionAt.top }}>
          {selectionAction}
        </div>
      )}
      {hint && <p className="muted small">{EDITOR_HINT}</p>}
    </div>
  );
}

type ToSvg = (u: number, y: number) => { x: number; y: number };

function ShapeOverlay(props: {
  shape: Shape;
  title: string;
  selected: boolean;
  hovered: boolean;
  locked: boolean;
  toSvg: ToSvg;
  profile: RegionProfile;
  centerU: number;
  /** Names of the centre lines at u = 0, 0.25, 0.5, 0.75 (for the edge labels); default the arm's. */
  lines?: CentreLines;
  onDown: (e: ReactPointerEvent) => void;
  onEnter: () => void;
  onLeave: () => void;
  /** Shown faintly and ignores the pointer (the Background view). */
  passive?: boolean;
}) {
  const { shape, title, selected, hovered, locked, toSvg, profile, onDown, passive } = props;
  const cls = `shape shape-${shape.kind}${selected && !passive ? " selected" : ""}${hovered && !passive ? " hovered" : ""}${locked ? " locked" : ""}${passive ? " passive" : ""}`;
  let body: React.ReactNode;
  switch (shape.kind) {
    case "box": {
      const c = toSvg(shape.uc, shape.cy);
      const deg = (shape.rot * 180) / Math.PI;
      body = (
        <g transform={`translate(${c.x} ${c.y}) rotate(${-deg})`}>
          <rect
            x={-shape.w / 2}
            y={-shape.h / 2}
            width={shape.w}
            height={shape.h}
            rx={Math.min(shape.w, shape.h) * 0.25}
          />
        </g>
      );
      break;
    }
    case "region":
    case "patch": {
      const ys: number[] = [];
      for (let y = shape.y0; y <= shape.y1 + 1e-9; y += 0.5) ys.push(Math.min(y, shape.y1));
      const left = ys.map((y) => toSvg(shape.u0, y));
      const right = ys.map((y) => toSvg(shape.u1, y)).reverse();
      body = <polygon points={[...left, ...right].map((p) => `${p.x},${p.y}`).join(" ")} />;
      break;
    }
    case "band": {
      const c = profile.circumferenceAt(shape.y);
      const p = toSvg(props.centerU, shape.y);
      body = <rect x={-c / 2} y={p.y - shape.half} width={c} height={shape.half * 2} />;
      break;
    }
    case "line": {
      const pts = shape.points.map((p) => toSvg(p.u, p.y));
      body = (
        <polyline
          points={pts.map((p) => `${p.x},${p.y}`).join(" ")}
          style={{ strokeWidth: Math.max(shape.half * 2, 0.6) }}
          className="line-hit"
        />
      );
      break;
    }
  }
  return (
    <g className={cls} onPointerDown={onDown} onPointerEnter={props.onEnter} onPointerLeave={props.onLeave}>
      <title>{title}</title>
      {body}
    </g>
  );
}

/** The sheet's margin above the far end, in cm: room for the edge labels at any window height. */
const TOP_MARGIN_CM = 1.8;

/** The zoom limits: from twice the whole sheet down to 4 cm across. */
function clampViewWidth(w: number, fullWidth: number): number {
  return Math.min(fullWidth * 2, Math.max(4, w));
}

/** An element's bounding box on the sheet (SVG units), for its name tag. */
function shapeBounds(shape: Shape, toSvg: ToSvg, profile: RegionProfile, centerU: number): TagBounds {
  switch (shape.kind) {
    case "box": {
      const c = toSvg(shape.uc, shape.cy);
      const cos = Math.abs(Math.cos(shape.rot));
      const sin = Math.abs(Math.sin(shape.rot));
      const ex = (cos * shape.w + sin * shape.h) / 2;
      const ey = (sin * shape.w + cos * shape.h) / 2;
      return { left: c.x - ex, right: c.x + ex, top: c.y - ey, bottom: c.y + ey };
    }
    case "region":
    case "patch": {
      const mid = toSvg(wrappedMidU(shape.u0, shape.u1), shape.y1);
      const xs = [shape.y0, shape.y1].flatMap((y) => [toSvg(shape.u0, y).x, toSvg(shape.u1, y).x]);
      return {
        left: Math.min(...xs),
        right: Math.max(...xs),
        top: mid.y,
        bottom: toSvg(shape.u0, shape.y0).y,
      };
    }
    case "band": {
      const c = profile.circumferenceAt(shape.y);
      const y = toSvg(centerU, shape.y).y;
      return { left: -c / 2, right: c / 2, top: y - shape.half, bottom: y + shape.half };
    }
    case "line": {
      const pts = shape.points.map((p) => toSvg(p.u, p.y));
      const xs = pts.map((p) => p.x);
      const ys = pts.map((p) => p.y);
      return { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) };
    }
  }
}

/** The area the rotate handle of a selected box takes, so the box's tag keeps off it. */
function rotateHandleZone(shape: Extract<Shape, { kind: "box" }>, toSvg: ToSvg, px: number): TagRect {
  const c = toSvg(shape.uc, shape.cy);
  const stemTop = -shape.h / 2 - HANDLE_PX.stem * px;
  const r = (HANDLE_PX.rotateHit + 2) * px;
  // The handle sits on the box's own "up" axis, which turns with the box.
  const x = c.x + stemTop * Math.sin(shape.rot);
  const y = c.y + stemTop * Math.cos(shape.rot);
  return { x: x - r, y: y - r, w: 2 * r, h: 2 * r };
}

const TAG_FONT = '500 10.5px "Inter Variable", Inter, system-ui, sans-serif';
let measureCtx: CanvasRenderingContext2D | null | undefined;

/** Width of a tag's text in screen pixels (an estimate where a canvas cannot measure it). */
function tagTextWidth(text: string): number {
  if (measureCtx === undefined) measureCtx = document.createElement("canvas").getContext("2d");
  if (!measureCtx) return text.length * 6;
  measureCtx.font = TAG_FONT;
  return measureCtx.measureText(text).width;
}

/**
 * An element's name on the sheet: a small tag on a corner of its box, in screen pixels at any zoom,
 * clear of the grid's cm labels (tagPlacement.ts). It takes the pointer like the element itself, so
 * a thin band or a short line can be picked and dragged by its name.
 */
function ShapeTag(props: {
  label: string;
  bounds: TagBounds;
  /** SVG units (cm) per screen pixel. */
  px: number;
  avoid: readonly TagRect[];
  selected: boolean;
  hovered: boolean;
  locked: boolean;
  /** Placed by its projection: selectable, but it cannot be moved. */
  fixed: boolean;
  onDown: (e: ReactPointerEvent) => void;
  onEnter: () => void;
  onLeave: () => void;
}) {
  const { label, bounds, px, locked, fixed } = props;
  const textW = tagTextWidth(label);
  const w = (textW + 12 + (locked ? 12 : 0)) * px;
  const h = 17 * px;
  // The selected element's tag stands clear of its handles.
  const tag = placeTag(bounds, { w, h }, (props.selected ? 10 : 4) * px, props.avoid);
  const cls = `shape-tag${props.selected ? " selected" : ""}${props.hovered ? " hovered" : ""}${locked || fixed ? " locked" : ""}`;
  return (
    <g
      className={cls}
      transform={`translate(${tag.x} ${tag.y})`}
      onPointerDown={props.onDown}
      onPointerEnter={props.onEnter}
      onPointerLeave={props.onLeave}
    >
      <rect width={w} height={h} rx={4 * px} />
      <text x={6 * px} y={h / 2} style={{ fontSize: 10.5 * px }}>
        {label}
      </text>
      {locked && (
        <g className="tag-lock" transform={`translate(${w - 14 * px} ${4 * px}) scale(${px})`}>
          <path d="M2.2 4V2.8a1.8 1.8 0 0 1 3.6 0V4" />
          <rect x={0.8} y={4} width={6.4} height={5} rx={1.2} />
        </g>
      )}
    </g>
  );
}

/** The selected background layer's area in the Background view: its shapes and brush strokes. */
function AreaOverlay(props: {
  layer: BackgroundLayer;
  toSvg: ToSvg;
  profile: RegionProfile;
  px: number;
  selected: number | null;
  selectable: boolean;
  onDown: (e: ReactPointerEvent, index: number) => void;
}) {
  const { layer, toSvg, profile, px, selected } = props;
  const L = profile.length;
  if ((layer.cover ?? "region") === "region") return null;
  return (
    <g className={`area-overlay${props.selectable ? " selectable" : ""}`}>
      {(layer.mask ?? []).map((s, k) => {
        const pts = s.points.map((q) => toSvg(q.u, q.v * L));
        return pts.length === 1 ? (
          <circle
            key={`m${k}`}
            className={`mask-stroke${s.erase ? " erase" : ""}`}
            cx={pts[0]!.x}
            cy={pts[0]!.y}
            r={s.radius_cm}
          />
        ) : (
          <polyline
            key={`m${k}`}
            className={`mask-stroke${s.erase ? " erase" : ""}`}
            points={pts.map((q) => `${q.x},${q.y}`).join(" ")}
            style={{ strokeWidth: s.radius_cm * 2 }}
          />
        );
      })}
      {(layer.shapes ?? []).map((s, k) => {
        const cls = `area-shape${selected === k ? " selected" : ""}`;
        const down = (e: ReactPointerEvent) => props.onDown(e, k);
        const sw = { strokeWidth: (selected === k ? 2 : 1.25) * px };
        switch (s.kind) {
          case "rect":
          case "ellipse": {
            const c = toSvg(s.u, s.v * L);
            const deg = s.rotation_deg ?? 0;
            return (
              <g
                key={k}
                className={cls}
                transform={`translate(${c.x} ${c.y}) rotate(${-deg})`}
                onPointerDown={down}
              >
                {s.kind === "rect" ? (
                  <rect x={-s.w_cm / 2} y={-s.h_cm / 2} width={s.w_cm} height={s.h_cm} style={sw} />
                ) : (
                  <ellipse rx={s.w_cm / 2} ry={s.h_cm / 2} style={sw} />
                )}
              </g>
            );
          }
          case "polygon": {
            const pts = s.points.map((q) => toSvg(q.u, q.v * L));
            return (
              <polygon
                key={k}
                className={cls}
                points={pts.map((q) => `${q.x},${q.y}`).join(" ")}
                style={sw}
                onPointerDown={down}
              />
            );
          }
          case "span": {
            const ys: number[] = [];
            for (let y = s.v[0] * L; y <= s.v[1] * L + 1e-9; y += 0.5) ys.push(Math.min(y, s.v[1] * L));
            const left = ys.map((y) => toSvg(s.u[0], y));
            const right = ys.map((y) => toSvg(s.u[1], y)).reverse();
            return (
              <polygon
                key={k}
                className={cls}
                points={[...left, ...right].map((q) => `${q.x},${q.y}`).join(" ")}
                style={sw}
                onPointerDown={down}
              />
            );
          }
        }
        return null;
      })}
    </g>
  );
}

/** The rectangle or ellipse being dragged out, upright on screen. */
function DrawPreview(props: {
  kind: "rect" | "ellipse";
  a: { x: number; y: number };
  b: { x: number; y: number };
}) {
  const x = Math.min(props.a.x, props.b.x);
  const y = Math.min(props.a.y, props.b.y);
  const w = Math.abs(props.b.x - props.a.x);
  const h = Math.abs(props.b.y - props.a.y);
  return props.kind === "rect" ? (
    <rect className="draw-preview" x={x} y={y} width={w} height={h} pointerEvents="none" />
  ) : (
    <ellipse
      className="draw-preview"
      cx={x + w / 2}
      cy={y + h / 2}
      rx={w / 2}
      ry={h / 2}
      pointerEvents="none"
    />
  );
}

/** Handle sizes in screen pixels: what is drawn, and the larger area that takes the pointer. */
const HANDLE_PX = { corner: 9, edge: 7, hit: 20, rotateR: 5.5, rotateHit: 11, stem: 26, point: 6 };

function Handles(props: {
  shape: Shape;
  toSvg: ToSvg;
  /** SVG units (cm) per screen pixel. */
  px: number;
  /** The handle being dragged. */
  active: Handle | null;
  onResize: (e: ReactPointerEvent, box: Box, handle: Handle) => void;
  onRotate: (e: ReactPointerEvent, cx: number, cy: number) => void;
  onPoint: (e: ReactPointerEvent, index: number) => void;
}) {
  const { shape, toSvg, px, active } = props;
  if (shape.kind === "box") {
    const c = toSvg(shape.uc, shape.cy);
    const box: Box = { cx: c.x, cy: c.y, w: shape.w, h: shape.h, rot: shape.rot };
    const deg = (shape.rot * 180) / Math.PI;
    const stemTop = -shape.h / 2 - HANDLE_PX.stem * px;
    // Drawn in the box's own frame (SVG y down inside the group, so local "up" is -y).
    return (
      <g className="handles" transform={`translate(${c.x} ${c.y}) rotate(${-deg})`}>
        <rect className="selection-box" x={-shape.w / 2} y={-shape.h / 2} width={shape.w} height={shape.h} />
        <line x1={0} y1={-shape.h / 2} x2={0} y2={stemTop} />
        <g className="grip rotate" onPointerDown={(e) => props.onRotate(e, c.x, c.y)}>
          <title>Drag to rotate</title>
          <circle className="hit" cx={0} cy={stemTop} r={HANDLE_PX.rotateHit * px} />
          <circle className="handle" cx={0} cy={stemTop} r={HANDLE_PX.rotateR * px} />
        </g>
        {HANDLES.map((h) => {
          const x = (h.x * shape.w) / 2;
          const y = (-h.y * shape.h) / 2;
          const size = (isCorner(h) ? HANDLE_PX.corner : HANDLE_PX.edge) * px;
          const hit = HANDLE_PX.hit * px;
          const on = active?.x === h.x && active?.y === h.y;
          return (
            <g
              key={`${h.x},${h.y}`}
              className={`grip resize${on ? " active" : ""}`}
              style={{ cursor: resizeCursor(h, shape.rot) }}
              onPointerDown={(e) => props.onResize(e, box, h)}
            >
              <title>
                {isCorner(h)
                  ? "Drag to resize in proportion (Shift: free, Alt: from the centre)"
                  : "Drag to stretch this side (Shift: in proportion, Alt: from the centre)"}
              </title>
              <rect className="hit" x={x - hit / 2} y={y - hit / 2} width={hit} height={hit} />
              <rect className="handle" x={x - size / 2} y={y - size / 2} width={size} height={size} />
            </g>
          );
        })}
      </g>
    );
  }
  if (shape.kind === "line") {
    return (
      <g className="handles">
        {shape.points.map((p, i) => {
          const s = toSvg(p.u, p.y);
          return (
            <g key={i} className="grip point" onPointerDown={(e) => props.onPoint(e, i)}>
              <circle className="hit" cx={s.x} cy={s.y} r={(HANDLE_PX.hit / 2) * px} />
              <circle className="handle" cx={s.x} cy={s.y} r={HANDLE_PX.point * px} />
            </g>
          );
        })}
      </g>
    );
  }
  return null;
}

/** While resizing: the original box as a dashed ghost and a label with the new size in cm. */
function ResizeFeedback({
  drag,
  px,
  view,
}: {
  drag: Extract<Drag, { kind: "resize" }>;
  px: number;
  view: ViewBox;
}) {
  const { box, current, opts } = drag;
  const deg = (box.rot * 180) / Math.PI;
  // Above the box's highest point on screen (below it when there is no room), upright whatever the
  // rotation, and always inside the visible part of the editor.
  const cos = Math.abs(Math.cos(current.rot));
  const sin = Math.abs(Math.sin(current.rot));
  const extent = (sin * current.w + cos * current.h) / 2;
  const text = formatSize(current.w, current.h);
  const mode = [
    opts.keepAspect ? "in proportion" : "free",
    opts.fromCentre ? "from centre" : null,
    opts.snap ? "0.5 cm steps" : "no snap",
  ]
    .filter(Boolean)
    .join(" · ");
  const fs = 13 * px;
  const small = 10.5 * px;
  const width = Math.max(text.length * 0.6 * fs, mode.length * 0.56 * small) + 16 * px;
  const height = fs + small + 14 * px;
  const margin = 6 * px;
  const above = current.cy - extent - 34 * px - height / 2;
  const below = current.cy + extent + 18 * px + height / 2;
  const minY = view.y + margin + height / 2;
  const maxY = view.y + view.h - margin - height / 2;
  const y = Math.min(maxY, Math.max(minY, above >= minY ? above : below));
  const halfW = width / 2;
  const x = Math.min(view.x + view.w - margin - halfW, Math.max(view.x + margin + halfW, current.cx));
  return (
    <g className="resize-feedback" pointerEvents="none">
      <g transform={`translate(${box.cx} ${box.cy}) rotate(${-deg})`}>
        <rect className="ghost" x={-box.w / 2} y={-box.h / 2} width={box.w} height={box.h} />
      </g>
      <g transform={`translate(${x} ${y})`}>
        <rect
          className="size-pill"
          x={-width / 2}
          y={-height / 2}
          width={width}
          height={height}
          rx={5 * px}
        />
        <text className="size-label" y={-height / 2 + 5 * px + fs * 0.85} style={{ fontSize: fs }}>
          {text}
        </text>
        <text className="size-mode" y={height / 2 - 6 * px} style={{ fontSize: small }}>
          {mode}
        </text>
      </g>
    </g>
  );
}
