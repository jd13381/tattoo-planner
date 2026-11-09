// The eraser of the projection's Clean up step (docs/adr/0023-projection-cleanup.md, "Eraser"): what is
// left of skin shadow after ink only (grey streaks, specks) is removed by hand or by size. Pure
// functions on small buffers, so the patch builder (src/projection/patch.ts), the wizard's live view and
// the tests share them.
//
// The file keeps strokes, not pixels: each stroke is a brush size in cm and its points in skin
// coordinates (u, v, the patch's own frame), so it stays text, survives a change of the patch's
// resolution and needs no image next to the projection. A stroke either erases (the patch shows no ink
// there) or restores (undoes erasing and speck removal under it); later strokes win.
//
// "Remove small specks" drops every piece of ink smaller than `specks_mm2` that touches no other ink
// (8-connected, so diagonal hatching stays in one piece).

/** One brush stroke as stored: diameter in cm, points as [u, v]. */
export type EraseStroke = { size_cm: number; restore?: boolean; points: [number, number][] };
export type EraseSettings = { specks_mm2: number; strokes: EraseStroke[] };

/** What the patch builder knows of its grid (a ProjectedPatch fits). */
export type PatchGrid = {
  u0: number;
  u1: number;
  v0: number;
  v1: number;
  width: number;
  height: number;
  pxPerCm: number;
};

/** Ink amount (0..1) from which a pixel belongs to a piece of ink for speck removal. */
export const SPECK_INK_MIN = 0.06;
/** Brush sizes the UI offers, cm (diameter). */
export const BRUSH_MIN_CM = 0.2;
export const BRUSH_MAX_CM = 12;

/** Decimal places of stored u and v: 1e-4 of the circumference or length is well under a millimetre. */
const round4 = (n: number) => Math.round(n * 1e4) / 1e4;

/**
 * Patch pixel coordinates (continuous; pixel k spans k..k+1) of a skin point. Column 0 is the u1 end
 * and row 0 the v1 end, as in the patch (src/projection/patch.ts).
 */
export function uvToPatchPx(grid: PatchGrid, u: number, v: number): { x: number; y: number } {
  return {
    x: ((grid.u1 - u) / (grid.u1 - grid.u0)) * grid.width,
    y: ((grid.v1 - v) / (grid.v1 - grid.v0)) * grid.height,
  };
}

/** The skin point (rounded for the file) at patch pixel coordinates. */
export function patchPxToUv(grid: PatchGrid, x: number, y: number): [number, number] {
  return [
    round4(grid.u1 - (x / grid.width) * (grid.u1 - grid.u0)),
    round4(grid.v1 - (y / grid.height) * (grid.v1 - grid.v0)),
  ];
}

/**
 * Appends a point to a stroke being drawn unless it is closer than half the brush radius to the last
 * one (keeps the file short; the capsules between points cover the gaps).
 */
export function extendStroke(stroke: EraseStroke, point: [number, number], grid: PatchGrid): EraseStroke {
  const last = stroke.points.at(-1);
  if (last) {
    const a = uvToPatchPx(grid, last[0], last[1]);
    const b = uvToPatchPx(grid, point[0], point[1]);
    const minPx = Math.max(0.5, (stroke.size_cm * grid.pxPerCm) / 4);
    if (Math.hypot(a.x - b.x, a.y - b.y) < minPx) return stroke;
  }
  return { ...stroke, points: [...stroke.points, point] };
}

/**
 * Paints the strokes into `mask` (1 = erased) in order: erasing sets 1, restoring sets 0. A pixel is
 * painted when its centre lies inside the brush radius of the stroke's path. Changes and returns `mask`.
 */
export function paintStrokes(mask: Uint8Array, strokes: readonly EraseStroke[], grid: PatchGrid): Uint8Array {
  const { width: W, height: H } = grid;
  for (const s of strokes) {
    if (s.points.length === 0) continue;
    const r = Math.max(0.5, (s.size_cm * grid.pxPerCm) / 2);
    const r2 = r * r;
    const value = s.restore ? 0 : 1;
    const pts = s.points.map(([u, v]) => uvToPatchPx(grid, u, v));
    const segments = pts.length === 1 ? [[pts[0]!, pts[0]!]] : pts.slice(1).map((p, i) => [pts[i]!, p]);
    for (const [a, b] of segments) {
      const x0 = Math.max(0, Math.floor(Math.min(a!.x, b!.x) - r));
      const x1 = Math.min(W - 1, Math.ceil(Math.max(a!.x, b!.x) + r));
      const y0 = Math.max(0, Math.floor(Math.min(a!.y, b!.y) - r));
      const y1 = Math.min(H - 1, Math.ceil(Math.max(a!.y, b!.y) + r));
      const dx = b!.x - a!.x;
      const dy = b!.y - a!.y;
      const len2 = dx * dx + dy * dy;
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          const px = x + 0.5 - a!.x;
          const py = y + 0.5 - a!.y;
          const t = len2 > 0 ? Math.min(1, Math.max(0, (px * dx + py * dy) / len2)) : 0;
          const ex = px - t * dx;
          const ey = py - t * dy;
          if (ex * ex + ey * ey < r2) mask[y * W + x] = value;
        }
    }
  }
  return mask;
}

/** Speck size in mm² as a pixel count at `pxPerCm` (one pixel is (10 / pxPerCm)² mm²). */
export function specksToPx(mm2: number, pxPerCm: number): number {
  return (mm2 * pxPerCm * pxPerCm) / 100;
}

/**
 * Small specks: 1 on every pixel of a piece of ink (8-connected pixels with ink ≥ `inkMin`) smaller than
 * `minPx` pixels. NaN ink counts as none.
 */
export function speckMask(
  ink: Float32Array,
  w: number,
  h: number,
  minPx: number,
  inkMin = SPECK_INK_MIN,
): Uint8Array {
  const out = new Uint8Array(w * h);
  if (!(minPx > 0)) return out;
  const seen = new Uint8Array(w * h);
  const stack: number[] = [];
  const piece: number[] = [];
  const isInk = (k: number) => ink[k]! >= inkMin; // false for NaN
  for (let start = 0; start < w * h; start++) {
    if (seen[start] || !isInk(start)) continue;
    piece.length = 0;
    seen[start] = 1;
    stack.push(start);
    while (stack.length) {
      const k = stack.pop()!;
      piece.push(k);
      const x = k % w;
      const y = (k - x) / w;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const n = ny * w + nx;
          if (seen[n] || !isInk(n)) continue;
          seen[n] = 1;
          stack.push(n);
        }
    }
    if (piece.length < minPx) for (const k of piece) out[k] = 1;
  }
  return out;
}

/** Whether the settings change anything (no specks, no strokes: nothing to do, nothing to store). */
export function hasErase(e: EraseSettings | null | undefined): e is EraseSettings {
  return !!e && (e.specks_mm2 > 0 || e.strokes.length > 0);
}

/**
 * The erase mask of a patch (1 = no ink there): the specks of `ink` (the patch's ink amount before
 * erasing), then the strokes over them. Null when the settings do nothing. `specks` can pass a speck
 * mask computed before (the live view reuses it while strokes are drawn).
 */
export function eraseMask(
  settings: EraseSettings | null | undefined,
  grid: PatchGrid,
  ink: Float32Array,
  specks?: Uint8Array,
): Uint8Array | null {
  if (!hasErase(settings)) return null;
  const base =
    specks?.slice() ?? speckMask(ink, grid.width, grid.height, specksToPx(settings.specks_mm2, grid.pxPerCm));
  return paintStrokes(base, settings.strokes, grid);
}

/** Applies a mask: alpha and ink go to 0 where it is 1. Changes the buffers in place. */
export function applyEraseMask(alpha: Uint8ClampedArray, ink: Float32Array, mask: Uint8Array): void {
  for (let k = 0; k < mask.length; k++)
    if (mask[k]) {
      alpha[k] = 0;
      ink[k] = 0;
    }
}

/** The settings as they go into the file: null when they do nothing, strokes without empty ones. */
export function storedErase(e: EraseSettings | null | undefined): EraseSettings | null {
  if (!e) return null;
  const strokes = e.strokes.filter((s) => s.points.length > 0);
  const out = { specks_mm2: e.specks_mm2, strokes };
  return hasErase(out) ? out : null;
}

/** What the eraser's view needs of a patch (a ProjectedPatch fits). */
export type ViewPatch = {
  width: number;
  height: number;
  gray: Uint8ClampedArray;
  rgb?: Uint8ClampedArray;
  alpha: Uint8ClampedArray;
};

/**
 * RGBA pixels of a patch multiplied onto plain skin (as the planner draws it), with `mask` applied.
 * `ghost` shows the ink the mask took away faintly in that colour, so it can be restored. `mirrored`
 * turns the columns round, as the unwrap does on a mirrored region (src/render/reference.ts).
 */
export function composeView(
  patch: ViewPatch,
  mask: Uint8Array | null,
  opts: { skin: [number, number, number]; ghost?: [number, number, number] | null; mirrored?: boolean },
): Uint8ClampedArray {
  const { width: W, height: H } = patch;
  const out = new Uint8ClampedArray(4 * W * H);
  const [sr, sg, sb] = opts.skin;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const k = y * W + (opts.mirrored ? W - 1 - x : x);
      const o = 4 * (y * W + x);
      const a0 = patch.alpha[k]! / 255;
      const erased = !!mask?.[k];
      const a = erased ? 0 : a0;
      const ink = (c: number) => (patch.rgb ? patch.rgb[3 * k + c]! : patch.gray[k]!) / 255;
      out[o] = sr * (1 - a + a * ink(0));
      out[o + 1] = sg * (1 - a + a * ink(1));
      out[o + 2] = sb * (1 - a + a * ink(2));
      out[o + 3] = 255;
      if (erased && opts.ghost && a0 > 0) {
        // The removed ink as a faint tint: darker ink, stronger tint.
        const t = 0.45 * a0 * (1 - ink(0) * 0.7);
        out[o] = out[o]! * (1 - t) + opts.ghost[0] * t;
        out[o + 1] = out[o + 1]! * (1 - t) + opts.ghost[1] * t;
        out[o + 2] = out[o + 2]! * (1 - t) + opts.ghost[2] * t;
      }
    }
  return out;
}
