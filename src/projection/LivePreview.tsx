// The projection workspace's live result (docs/adr/0024-projection-workspace.md): the tattoo on the 3D
// body part and on the unwrap, rebuilt a moment after every change. Each photo's share shows as a
// coloured ghost (G), the covered area as a dashed outline. Dragging on the unwrap corrects the current
// photo (unwrapDrag.ts): sideways turns the camera side, up and down shifts the distances, the two
// handles stretch them; the arrow keys nudge.
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { AssetInfo } from "../assets/types.ts";
import type { RegionProfile } from "../body/profile.ts";
import type { AssetImage } from "../render/reference.ts";
import { renderUnwrap } from "../render/unwrapCanvas.ts";
import { ArmViewer } from "../viewer/ArmViewer.tsx";
import type { Pose } from "../viewer/useArm.ts";
import type { SkinArea } from "./area.ts";
import type { ProjectedPatch } from "./patch.ts";
import { previewCanvases } from "./preview.ts";
import type { ProjectionCalibration } from "./schema.ts";
import { areaOutline, skinToUnwrap, unwrapToSkin, type DragMode, type UnwrapView } from "./unwrapDrag.ts";

const TEXTURE_PX_PER_CM = 12;
const UNWRAP_PX_PER_CM = 10;

/** One photo's ghost: the skin it shows (u range, cm along the region) in its colour. */
export type Ghost = { index: number; color: string; u: [number, number]; s: [number, number] };

export type DragPhase = "start" | "move" | "end" | "cancel";

type Props = {
  profile: RegionProfile;
  pose: Pose;
  /** The calibration the picture was built from (a moment after the last change), or null. */
  cal: ProjectionCalibration | null;
  patch: ProjectedPatch | null;
  /** Why there is no picture yet, in words; null while there is one or it is being built. */
  note: string | null;
  assets: ReadonlyMap<string, AssetInfo> | null;
  images: ReadonlyMap<string, AssetImage>;
  area: SkinArea;
  auto: boolean;
  ghosts: Ghost[];
  showGhosts: boolean;
  onToggleGhosts: () => void;
  /** The ghost the unwrap drags (the current photo), or null when it is not in the picture. */
  current: Ghost | null;
  onDrag: (
    phase: DragPhase,
    mode: DragMode,
    from: { u: number; s: number },
    to: { u: number; s: number },
  ) => void;
  onNudge: (key: "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight", big: boolean, atS: number) => void;
};

export function LivePreview(props: Props) {
  const { profile, pose, cal, patch, area, ghosts, showGhosts, current } = props;
  const L = profile.length;
  const plain = useMemo(() => {
    const c = document.createElement("canvas");
    renderUnwrap(c, profile, "grid", null, { pxPerCm: 8, grid: true });
    return c;
  }, [profile]);
  const canvases = useMemo(
    () =>
      cal
        ? previewCanvases({
            name: cal.name || "preview",
            patch,
            profile,
            assets: props.assets,
            images: props.images,
            v1: Math.min(1, cal.patch.v[1] + 0.03),
            centerU: (cal.patch.u[0] + cal.patch.u[1]) / 2,
            pxPerCm: UNWRAP_PX_PER_CM,
          })
        : null,
    [cal, patch, profile, props.assets, props.images],
  );
  // The unwrap view follows the picture it shows; without one, the live area.
  const view: UnwrapView = useMemo(
    () => ({
      profile,
      pxPerCm: UNWRAP_PX_PER_CM,
      centerU: cal ? (cal.patch.u[0] + cal.patch.u[1]) / 2 : (area.u[0] + area.u[1]) / 2,
      top: canvases?.top ?? 0,
    }),
    [profile, cal, area, canvases],
  );
  const cropW = Math.ceil(profile.maxCircumference * UNWRAP_PX_PER_CM);
  const cropH = canvases ? canvases.innerImage.height : Math.ceil(L * UNWRAP_PX_PER_CM);
  const unwrapUrl = useMemo(() => canvases?.innerImage.toDataURL("image/png") ?? null, [canvases]);

  // The 3D texture with the area and the ghosts drawn on it.
  const texture = useMemo(() => {
    const base = canvases?.texture ?? null;
    const ppc = base ? TEXTURE_PX_PER_CM : 8;
    const src = base ?? plain;
    const c = document.createElement("canvas");
    c.width = src.width;
    c.height = src.height;
    const g = c.getContext("2d");
    if (!g) return src;
    g.drawImage(src, 0, 0);
    const tv: UnwrapView = { profile, pxPerCm: ppc, centerU: 0, top: 0 };
    const stroke = (lines: { x: number; y: number }[][], color: string, width: number, dash: number[]) => {
      g.strokeStyle = color;
      g.lineWidth = width;
      g.setLineDash(dash);
      for (const l of lines) {
        g.beginPath();
        l.forEach((p, k) => (k ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
        g.stroke();
      }
    };
    if (showGhosts)
      for (const gh of ghosts) stroke(areaOutline(tv, gh.u, gh.s), gh.color, ppc * 0.25, []);
    stroke(areaOutline(tv, area.u, [area.v[0] * L, area.v[1] * L]), "#7c6cff", ppc * 0.2, [ppc, ppc * 0.6]);
    return c;
  }, [canvases, plain, profile, ghosts, showGhosts, area, L]);

  // Dragging on the unwrap.
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<{ mode: DragMode; from: { u: number; s: number }; id: number } | null>(
    null,
  );
  const onDragRef = useRef(props.onDrag);
  useEffect(() => {
    onDragRef.current = props.onDrag;
  });
  useEffect(() => {
    if (!drag) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopImmediatePropagation();
      onDragRef.current("cancel", drag.mode, drag.from, drag.from);
      setDrag(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [drag]);
  const toSvg = (e: { clientX: number; clientY: number }) => {
    const m = svgRef.current?.getScreenCTM();
    if (!m) return null;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return { x: p.x, y: p.y };
  };
  const handles = current
    ? {
        top: skinToUnwrap(view, (current.u[0] + current.u[1]) / 2, current.s[1]),
        bottom: skinToUnwrap(view, (current.u[0] + current.u[1]) / 2, current.s[0]),
      }
    : null;
  const hr = UNWRAP_PX_PER_CM * 0.9;
  const onDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!current || e.button !== 0) return;
    const p = toSvg(e);
    if (!p) return;
    const near = (q: { x: number; y: number }) => Math.hypot(q.x - p.x, q.y - p.y) < hr * 2;
    const mode: DragMode = handles && near(handles.top) ? "top" : handles && near(handles.bottom) ? "bottom" : "move";
    const from = unwrapToSkin(view, p.x, p.y);
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.focus();
    setDrag({ mode, from, id: e.pointerId });
    props.onDrag("start", mode, from, from);
  };
  const onMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!drag || drag.id !== e.pointerId) return;
    const p = toSvg(e);
    if (p) props.onDrag("move", drag.mode, drag.from, unwrapToSkin(view, p.x, p.y));
  };
  const onUp = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!drag || drag.id !== e.pointerId) return;
    setDrag(null);
    props.onDrag("end", drag.mode, drag.from, drag.from);
  };
  const outline = (u: [number, number], s: [number, number]) =>
    areaOutline(view, u, s).map((l) => l.map((p) => `${p.x},${p.y}`).join(" "));

  return (
    <div className="pw-preview">
      <div className="pw-3d">
        <ArmViewer
          profile={profile}
          canvas={texture}
          version={0}
          bendDeg={pose.bendDeg}
          viewSides
          footer={false}
        />
      </div>
      <figure className="pw-unwrap">
        <div className="pw-unwrap-bar float-bar">
          <span className="faint xs">Unwrap</span>
          <span className="spacer" />
          <span className={`chip ${props.auto ? "ok" : "muted"} xs`} title="The dashed outline: the skin the projection covers">
            Area {props.auto ? "automatic" : "held"}
          </span>
          <button
            type="button"
            className={`ghost xs${showGhosts ? " active" : ""}`}
            aria-pressed={showGhosts}
            aria-keyshortcuts="G"
            onClick={props.onToggleGhosts}
            title="Show where each photo lands, in its colour (G)"
          >
            Ghosts <kbd className="kbd">G</kbd>
          </button>
        </div>
        <svg
          ref={svgRef}
          className={`pw-unwrap-svg${current ? " draggable" : ""}${drag ? " dragging" : ""}`}
          viewBox={`0 0 ${cropW} ${cropH}`}
          preserveAspectRatio="xMidYMid meet"
          tabIndex={current ? 0 : -1}
          role="application"
          aria-label={
            current
              ? `Unwrap: drag to move photo ${current.index + 1}, sideways turns the camera side, up and down shifts the distances; arrow keys nudge 0.1 cm, Shift 1 cm`
              : "Unwrap"
          }
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          onKeyDown={(e) => {
            if (!current) return;
            if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) return;
            e.preventDefault();
            props.onNudge(e.key as "ArrowUp", e.shiftKey, (current.s[0] + current.s[1]) / 2);
          }}
        >
          {unwrapUrl ? (
            <image href={unwrapUrl} width={cropW} height={cropH} />
          ) : (
            <rect width={cropW} height={cropH} className="pw-unwrap-empty" />
          )}
          {showGhosts &&
            ghosts.map((gh) =>
              outline(gh.u, gh.s).map((pts, k) => (
                <polyline
                  key={`${gh.index}-${k}`}
                  points={pts}
                  fill="none"
                  stroke={gh.color}
                  strokeWidth={gh.index === current?.index ? 2.5 : 1.5}
                  vectorEffect="non-scaling-stroke"
                  opacity={gh.index === current?.index ? 1 : 0.7}
                />
              )),
            )}
          {outline(area.u, [area.v[0] * L, area.v[1] * L]).map((pts, k) => (
            <polyline
              key={`area-${k}`}
              points={pts}
              fill="none"
              className="pw-area-line"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {handles &&
            (["top", "bottom"] as const).map((h) => (
              <rect
                key={h}
                x={handles[h].x - hr}
                y={handles[h].y - hr / 2}
                width={hr * 2}
                height={hr}
                rx={hr / 4}
                className="pw-unwrap-handle"
                fill={current?.color}
              >
                <title>{h === "top" ? "Drag to stretch the top" : "Drag to stretch the bottom"}</title>
              </rect>
            ))}
        </svg>
        <figcaption className="faint xs">
          {props.note ??
            (current
              ? `Drag to correct photo ${current.index + 1}: sideways turns it round the body part, up and down moves its distances, the handles stretch it. Arrow keys: 0.1 cm, Shift 1 cm.`
              : "The dashed line is the covered area.")}
        </figcaption>
      </figure>
    </div>
  );
}
