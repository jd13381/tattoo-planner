import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { ArmProfile } from "../arm/profile.ts";
import { wrapU } from "../arm/uv.ts";
import type { ElementAspects } from "../layout/imageFit.ts";
import type { Layout, LayoutElement } from "../layout/schema.ts";
import { resolveElement, wrapDelta, type ExistingSize, type Shape } from "../layout/shapes.ts";
import { moveElement, movePoint, scaleFigure } from "./edit.ts";

type Props = {
  profile: ArmProfile;
  layout: Layout;
  existing: ExistingSize;
  /** Image proportions per element id (figures without a width take them). */
  aspects?: ElementAspects;
  /** Rendered unwrap for `centerU`; bumped `version` when it changes. */
  image: HTMLCanvasElement;
  version: number;
  centerU: number;
  selected: number | null;
  onSelect: (index: number | null) => void;
  onChange: (index: number, element: LayoutElement) => void;
};

type Drag =
  | { kind: "pan"; startX: number; startY: number; box: ViewBox }
  | { kind: "move"; index: number; start: LayoutElement; u: number; v: number }
  | { kind: "scale"; index: number; start: LayoutElement; cx: number; cy: number; d0: number }
  | { kind: "rotate"; index: number; start: LayoutElement; cx: number; cy: number }
  | { kind: "point"; index: number; point: number; start: LayoutElement };

type ViewBox = { x: number; y: number; w: number; h: number };

/** 2D editor on the skin unwrap. SVG units are cm; x grows towards medial (right), y from the shoulder down. */
export function UnwrapEditor(props: Props) {
  const { profile, layout, existing, aspects, image, version, centerU, selected, onSelect, onChange } = props;
  const L = profile.length;
  const half = profile.maxCircumference / 2;
  const fullView = useMemo<ViewBox>(() => ({ x: -half - 1, y: -1, w: 2 * half + 2, h: L + 2 }), [half, L]);
  const [view, setView] = useState<ViewBox>(fullView);
  const [drag, setDrag] = useState<Drag | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // The rendered canvas is shown as it is, inside a foreignObject: encoding it as a PNG data URL
  // on every change cost seconds per mode switch with reference images (Phase 4 acceptance).
  const hostRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    host.replaceChildren(image);
  }, [image, version]);

  const resolved = useMemo(
    () => layout.elements.map((el) => resolveElement(el, profile, existing, aspects?.get(el.id))),
    [layout, profile, existing, aspects],
  );

  /** Screen (SVG) position of a skin point. */
  const toSvg = (u: number, y: number) => ({
    x: -wrapDelta(u - centerU) * profile.circumferenceAt(y),
    y: L - y,
  });

  const pointer = (e: { clientX: number; clientY: number }) => {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return null;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    const y = Math.min(L, Math.max(0, L - p.y));
    const c = profile.circumferenceAt(y);
    return { sx: p.x, sy: p.y, u: wrapU(centerU - p.x / c), v: y / L };
  };

  const startDrag = (e: ReactPointerEvent, next: Drag) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setDrag(next);
  };

  const onElementDown = (e: ReactPointerEvent, index: number) => {
    onSelect(index);
    const el = layout.elements[index]!;
    const p = pointer(e);
    if (!p || el.locked) {
      e.stopPropagation();
      return;
    }
    startDrag(e, { kind: "move", index, start: el, u: p.u, v: p.v });
  };

  const onMove = (e: ReactPointerEvent) => {
    if (!drag) return;
    const p = pointer(e);
    if (!p) return;
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
        onChange(drag.index, moveElement(drag.start, wrapDelta(p.u - drag.u), p.v - drag.v));
        return;
      case "scale": {
        const d = Math.hypot(p.sx - drag.cx, p.sy - drag.cy);
        if (drag.d0 > 0) onChange(drag.index, scaleFigure(drag.start, d / drag.d0));
        return;
      }
      case "rotate": {
        const deg = (Math.atan2(drag.cy - p.sy, p.sx - drag.cx) * 180) / Math.PI - 90;
        const norm = Math.round(((deg + 540) % 360) - 180);
        if (drag.start.type === "figure" || drag.start.type === "existing")
          onChange(drag.index, { ...drag.start, rotation_deg: norm });
        return;
      }
      case "point":
        onChange(drag.index, movePoint(drag.start, drag.point, p.u, p.v));
        return;
    }
  };

  const onWheel = (e: React.WheelEvent) => {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM();
    if (!ctm) return;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    const f = Math.exp(e.deltaY * 0.0015);
    const w = Math.min(fullView.w * 2, Math.max(4, view.w * f));
    const k = w / view.w;
    setView({ x: p.x - (p.x - view.x) * k, y: p.y - (p.y - view.y) * k, w, h: view.h * k });
  };

  return (
    <div className="unwrap-editor">
      <svg
        ref={svgRef}
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        preserveAspectRatio="xMidYMid meet"
        onPointerDown={(e) => {
          onSelect(null);
          startDrag(e, { kind: "pan", startX: e.clientX, startY: e.clientY, box: view });
        }}
        onPointerMove={onMove}
        onPointerUp={() => setDrag(null)}
        onPointerCancel={() => setDrag(null)}
        onWheel={onWheel}
        onDoubleClick={() => setView(fullView)}
        role="application"
        aria-label="Unwrap editor"
      >
        <foreignObject x={-half} y={0} width={2 * half} height={L} className="unwrap-image-host">
          <div ref={hostRef} />
        </foreignObject>
        <text className="edge-label" x={-half + 0.3} y={-0.3}>
          {centerU === 0 ? "lateral ←" : "medial ←"}
        </text>
        <text className="edge-label" x={half - 0.3} y={-0.3} textAnchor="end">
          {centerU === 0 ? "→ medial" : "→ lateral"}
        </text>
        {resolved.map((r, i) => (
          <ShapeOverlay
            key={r.element.id}
            shape={r.shape}
            label={r.element.id}
            selected={i === selected}
            locked={!!r.element.locked}
            toSvg={toSvg}
            profile={profile}
            centerU={centerU}
            onDown={(e) => onElementDown(e, i)}
          />
        ))}
        {selected !== null && resolved[selected] && !resolved[selected].element.locked && (
          <Handles
            shape={resolved[selected].shape}
            toSvg={toSvg}
            onScale={(e, cx, cy, hx, hy) =>
              startDrag(e, {
                kind: "scale",
                index: selected,
                start: layout.elements[selected]!,
                cx,
                cy,
                d0: Math.hypot(hx - cx, hy - cy),
              })
            }
            onRotate={(e, cx, cy) =>
              startDrag(e, { kind: "rotate", index: selected, start: layout.elements[selected]!, cx, cy })
            }
            onPoint={(e, point) =>
              startDrag(e, { kind: "point", index: selected, point, start: layout.elements[selected]! })
            }
          />
        )}
      </svg>
      <p className="muted small">
        Click to select, drag to move; corner handle scales, round handle rotates. Drag the background to pan,
        scroll to zoom, double-click to reset. Seen from outside the arm, shoulder at the top.
      </p>
    </div>
  );
}

type ToSvg = (u: number, y: number) => { x: number; y: number };

function ShapeOverlay(props: {
  shape: Shape;
  label: string;
  selected: boolean;
  locked: boolean;
  toSvg: ToSvg;
  profile: ArmProfile;
  centerU: number;
  onDown: (e: ReactPointerEvent) => void;
}) {
  const { shape, label, selected, locked, toSvg, profile, onDown } = props;
  const cls = `shape${selected ? " selected" : ""}${locked ? " locked" : ""}`;
  let body: React.ReactNode;
  let labelAt: { x: number; y: number };
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
      labelAt = { x: c.x, y: c.y - shape.h / 2 - 0.4 };
      break;
    }
    case "region": {
      const ys: number[] = [];
      for (let y = shape.y0; y <= shape.y1 + 1e-9; y += 0.5) ys.push(Math.min(y, shape.y1));
      const left = ys.map((y) => toSvg(shape.u0, y));
      const right = ys.map((y) => toSvg(shape.u1, y)).reverse();
      body = <polygon points={[...left, ...right].map((p) => `${p.x},${p.y}`).join(" ")} />;
      labelAt = toSvg((shape.u0 + shape.u1) / 2, shape.y1);
      labelAt = { x: labelAt.x, y: labelAt.y - 0.4 };
      break;
    }
    case "band": {
      const c = profile.circumferenceAt(shape.y);
      const p = toSvg(props.centerU, shape.y);
      body = <rect x={-c / 2} y={p.y - shape.half} width={c} height={shape.half * 2} />;
      labelAt = { x: 0, y: p.y - shape.half - 0.4 };
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
      labelAt = { x: pts[0]!.x + 0.5, y: pts[0]!.y - 0.5 };
      break;
    }
  }
  return (
    <g className={cls} onPointerDown={onDown}>
      {body}
      <text x={labelAt.x} y={labelAt.y} textAnchor="middle" className="shape-label">
        {label}
        {locked ? " 🔒" : ""}
      </text>
    </g>
  );
}

function Handles(props: {
  shape: Shape;
  toSvg: ToSvg;
  onScale: (e: ReactPointerEvent, cx: number, cy: number, hx: number, hy: number) => void;
  onRotate: (e: ReactPointerEvent, cx: number, cy: number) => void;
  onPoint: (e: ReactPointerEvent, index: number) => void;
}) {
  const { shape, toSvg } = props;
  if (shape.kind === "box") {
    const c = toSvg(shape.uc, shape.cy);
    const cos = Math.cos(shape.rot);
    const sin = Math.sin(shape.rot);
    // Local (right, up) → SVG (right, down).
    const at = (lx: number, ly: number) => ({ x: c.x + lx * cos - ly * sin, y: c.y - (lx * sin + ly * cos) });
    const corner = at(shape.w / 2, shape.h / 2);
    const top = at(0, shape.h / 2 + 1.5);
    const topEdge = at(0, shape.h / 2);
    return (
      <g className="handles">
        <line x1={topEdge.x} y1={topEdge.y} x2={top.x} y2={top.y} />
        <rect
          x={corner.x - 0.45}
          y={corner.y - 0.45}
          width={0.9}
          height={0.9}
          onPointerDown={(e) => props.onScale(e, c.x, c.y, corner.x, corner.y)}
          className="handle scale"
        />
        <circle
          cx={top.x}
          cy={top.y}
          r={0.5}
          onPointerDown={(e) => props.onRotate(e, c.x, c.y)}
          className="handle rotate"
        />
      </g>
    );
  }
  if (shape.kind === "line") {
    return (
      <g className="handles">
        {shape.points.map((p, i) => {
          const s = toSvg(p.u, p.y);
          return (
            <circle
              key={i}
              cx={s.x}
              cy={s.y}
              r={0.5}
              className="handle"
              onPointerDown={(e) => props.onPoint(e, i)}
            />
          );
        })}
      </g>
    );
  }
  return null;
}
