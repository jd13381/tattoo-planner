// Resizing a figure's box in the unwrap editor: pure maths behind the eight handles of the selection.
//
// Frames: the editor's SVG frame is in cm with x to the right (medial) and y down (towards the
// wrist). A box's local frame has x along its width and y along its height, pointing *up* on the
// screen when the box is not rotated; `rot` (radians) turns the box counter-clockwise on the screen,
// as `Shape.rot` and the editor's `rotate(-deg)` do.
import type { ArmProfile } from "../arm/profile.ts";
import { wrapU } from "../arm/uv.ts";
import type { LayoutElement } from "../layout/schema.ts";

/** Sizes snap to this step (cm) unless snapping is off. */
export const SNAP_CM = 0.5;
/** No side of a resized box gets smaller than this (cm). */
export const MIN_SIZE_CM = 1;

/** A handle on the box: -1, 0 or 1 per local axis (x: left/right, y: bottom/top). (0, 0) is not one. */
export type Handle = { x: -1 | 0 | 1; y: -1 | 0 | 1 };

/** The eight handles: four corners, then the four edge midpoints. */
export const HANDLES: readonly Handle[] = [
  { x: 1, y: 1 },
  { x: -1, y: 1 },
  { x: -1, y: -1 },
  { x: 1, y: -1 },
  { x: 0, y: 1 },
  { x: 1, y: 0 },
  { x: 0, y: -1 },
  { x: -1, y: 0 },
];

export const isCorner = (h: Handle) => h.x !== 0 && h.y !== 0;

/** A box in the SVG frame: centre (cx, cy), size w × h (cm), rotation rot (radians, CCW on screen). */
export type Box = { cx: number; cy: number; w: number; h: number; rot: number };

export type ResizeOptions = {
  /** Keep the width-to-height ratio. */
  keepAspect: boolean;
  /** Resize around the centre instead of the opposite corner or edge. */
  fromCentre: boolean;
  /** Snap step in cm; 0 turns snapping off. Default SNAP_CM. */
  snap?: number;
  /** Smallest side in cm. Default MIN_SIZE_CM. */
  min?: number;
};

/**
 * Default modifiers: corners keep the aspect ratio and edges stretch one side; Shift swaps that.
 * Alt resizes around the centre; Ctrl or Cmd turns snapping off.
 */
export function resizeOptions(
  handle: Handle,
  keys: { shiftKey: boolean; altKey: boolean; ctrlKey: boolean; metaKey: boolean },
): ResizeOptions {
  return {
    keepAspect: isCorner(handle) !== keys.shiftKey,
    fromCentre: keys.altKey,
    snap: keys.ctrlKey || keys.metaKey ? 0 : SNAP_CM,
  };
}

/** Local (x right, y up) → SVG offset (x right, y down). */
function toSvgOffset(lx: number, ly: number, rot: number) {
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  return { x: lx * cos - ly * sin, y: -(lx * sin + ly * cos) };
}

/** SVG offset → local (x right, y up). */
function toLocal(dx: number, dy: number, rot: number) {
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const up = -dy;
  return { x: dx * cos + up * sin, y: -dx * sin + up * cos };
}

/** Where a handle sits in the SVG frame. */
export function handlePoint(box: Box, handle: Handle) {
  const o = toSvgOffset((handle.x * box.w) / 2, (handle.y * box.h) / 2, box.rot);
  return { x: box.cx + o.x, y: box.cy + o.y };
}

const snapTo = (n: number, step: number) => (step > 0 ? Math.round(n / step) * step : n);
/**
 * Snaps a size that started at `from`; it keeps its start value until it has moved half a step,
 * so grabbing a handle never makes an off-grid size (e.g. a derived 9.9 cm width) jump.
 */
const snapFrom = (n: number, from: number, step: number) =>
  step > 0 && Math.abs(n - from) < step / 2 ? from : snapTo(n, step);
const ceilTo = (n: number, step: number) => (step > 0 ? Math.ceil(n / step - 1e-9) * step : n);

/**
 * The box after dragging `handle` by (dx, dy) in the SVG frame (the pointer's movement since the drag
 * started, so grabbing a handle off-centre does not make the box jump). Without `fromCentre` the
 * opposite corner or edge stays put; the box never flips and never gets smaller than `min`.
 *
 * With `keepAspect`, a corner scales by the pointer's projection onto the box's diagonal and an edge
 * scales the whole box (the cross axis stays centred). The dimension that drives the drag snaps: the
 * height for corners and top/bottom edges, the width for left/right edges. Free resizing snaps every
 * side the handle moves. A size stays at its start value until it has moved half a snap step.
 */
export function resizeBox(start: Box, handle: Handle, dx: number, dy: number, opts: ResizeOptions): Box {
  const snap = opts.snap ?? SNAP_CM;
  const min = opts.min ?? MIN_SIZE_CM;
  const hw = start.w / 2;
  const hh = start.h / 2;
  const d = toLocal(dx, dy, start.rot);
  // The dragged handle, and the point that stays fixed (local frame, from the old centre).
  const px = handle.x * hw + d.x;
  const py = handle.y * hh + d.y;
  const ax = opts.fromCentre ? 0 : -handle.x * hw;
  const ay = opts.fromCentre ? 0 : -handle.y * hh;
  const k = opts.fromCentre ? 2 : 1;

  let w = start.w;
  let h = start.h;
  if (opts.keepAspect) {
    let s: number;
    if (isCorner(handle)) {
      const ox = handle.x * hw - ax;
      const oy = handle.y * hh - ay;
      s = ((px - ax) * ox + (py - ay) * oy) / (ox * ox + oy * oy);
    } else if (handle.x !== 0) {
      s = (k * handle.x * (px - ax)) / start.w;
    } else {
      s = (k * handle.y * (py - ay)) / start.h;
    }
    const drive = handle.x !== 0 && handle.y === 0 ? start.w : start.h;
    const sMin = Math.max(min / start.w, min / start.h);
    s = snapFrom(Math.max(s, sMin) * drive, drive, snap) / drive;
    if (s < sMin) s = ceilTo(sMin * drive, snap) / drive;
    w = start.w * s;
    h = start.h * s;
  } else {
    const floor = ceilTo(min, snap);
    const side = (raw: number, from: number) => Math.max(floor, snapFrom(Math.max(min, raw), from, snap));
    if (handle.x !== 0) w = side(k * handle.x * (px - ax), start.w);
    if (handle.y !== 0) h = side(k * handle.y * (py - ay), start.h);
  }

  // New centre: the fixed point plus half the new size towards the handle, on the axes it moves.
  // An aspect-kept edge grows the cross axis around the centre (lc = 0 there).
  const lcx = opts.fromCentre || handle.x === 0 ? 0 : ax + (handle.x * w) / 2;
  const lcy = opts.fromCentre || handle.y === 0 ? 0 : ay + (handle.y * h) / 2;
  const o = toSvgOffset(lcx, lcy, start.rot);
  return { cx: start.cx + o.x, cy: start.cy + o.y, w, h, rot: start.rot };
}

/** The resize cursor for a handle on a rotated box (the nearest of the four CSS resize cursors). */
export function resizeCursor(handle: Handle, rot: number): string {
  const o = toSvgOffset(handle.x, handle.y, rot);
  // Screen angle of the handle's direction, folded to 0…180° (y up).
  const deg = ((((Math.atan2(-o.y, o.x) * 180) / Math.PI) % 180) + 180) % 180;
  const sector = Math.round(deg / 45) % 4;
  return ["ew-resize", "nesw-resize", "ns-resize", "nwse-resize"][sector]!;
}

/** "18.0 × 9.9 cm": width × height with one decimal. */
export function formatSize(w: number, h: number): string {
  return `${w.toFixed(1)} × ${h.toFixed(1)} cm`;
}

/** A point in the editor's SVG frame as skin coordinates (u around, v along), clamped to the arm. */
export function svgToSkin(profile: ArmProfile, centerU: number, x: number, y: number) {
  const L = profile.length;
  const skinY = Math.min(L, Math.max(0, L - y));
  return { u: wrapU(centerU - x / profile.circumferenceAt(skinY)), v: skinY / L };
}

const round = (n: number, digits: number) => Math.round(n * 10 ** digits) / 10 ** digits;

/**
 * Writes a resized box back to a figure or existing tattoo: size in cm (one decimal) and, unless the
 * centre stayed, its new position. `widthDerived` says the element's width is not stored but follows
 * its height (image proportions or the default aspect): when the aspect ratio is kept, only the
 * height changes so the width stays derived; a free resize stores the width too.
 */
export function applyResize(
  el: LayoutElement,
  box: Box,
  opts: {
    keepAspect: boolean;
    widthDerived: boolean;
    /** Skin position of the new centre; leave out when the centre did not move. */
    position?: { u: number; v: number };
  },
): LayoutElement {
  if (el.type !== "figure" && el.type !== "existing") return el;
  const h = round(box.h, 1);
  const size =
    opts.keepAspect && opts.widthDerived ? { ...el.size_cm, h } : { ...el.size_cm, h, w: round(box.w, 1) };
  const position = opts.position
    ? { u: round(wrapU(opts.position.u), 3), v: round(Math.min(1, Math.max(0, opts.position.v)), 3) }
    : el.position;
  return { ...el, position, size_cm: size };
}
