// Row geometry of the "vase" unwrap (docs/adr/0002), shared by the reference renderer.
// Screen cm: x from the centre of the image (the `centerU` line), positive to the right (medial when
// the outer side is centred); every texture row is as wide as the local circumference.
import type { ArmProfile } from "../arm/profile.ts";
import { hits, wrapDelta, type Shape } from "../layout/shapes.ts";

/** Screen x (cm) of the line u in a row with circumference c, for an image centred on centerU. */
export function screenX(u: number, centerU: number, c: number): number {
  return -wrapDelta(u - centerU) * c;
}

/** One piece of a strip after wrapping it round the arm: local offsets [from, to) land at `at`. */
export type StripPiece = { from: number; to: number; at: number };

/**
 * Wraps a horizontal strip of an element around the arm. The strip covers local offsets
 * [x0, x1) (cm, relative to the element centre) and is centred at screen x `cx` in a row of
 * circumference c. Offsets beyond half the circumference are dropped (they would be the element
 * meeting itself on the far side); what crosses the seam re-enters on the other edge.
 */
export function wrapStrip(cx: number, x0: number, x1: number, c: number): StripPiece[] {
  const half = c / 2;
  const lo = Math.max(x0, -half);
  const hi = Math.min(x1, half);
  if (hi <= lo) return [];
  const pieces: StripPiece[] = [];
  for (const k of [-1, 0, 1]) {
    const shift = cx + k * c;
    const from = Math.max(lo, -half - shift);
    const to = Math.min(hi, half - shift);
    if (to > from) pieces.push({ from, to, at: shift + from });
  }
  return pieces;
}

/** Texture rows (0 = shoulder) whose centres fall within [y0, y1] cm from the wrist. */
export function rowRange(profile: ArmProfile, pxPerCm: number, y0: number, y1: number): [number, number] {
  const height = Math.ceil(profile.length * pxPerCm);
  const first = Math.max(0, Math.floor((profile.length - y1) * pxPerCm - 0.5));
  const last = Math.min(height - 1, Math.ceil((profile.length - y0) * pxPerCm - 0.5));
  return [first, last];
}

/** The rows a shape can touch, in cm from the wrist. */
export function shapeYRange(shape: Shape, profile: ArmProfile): [number, number] {
  switch (shape.kind) {
    case "box": {
      const r = Math.hypot(shape.w, shape.h) / 2;
      return [shape.cy - r, shape.cy + r];
    }
    case "region":
    case "patch":
      return [shape.y0, shape.y1];
    case "band":
      return [shape.y - shape.half, shape.y + shape.half];
    case "line": {
      const ys = shape.points.map((p) => p.y);
      return [Math.min(...ys) - shape.half, Math.max(...ys) + shape.half];
    }
  }
  return [0, profile.length];
}

/**
 * Screen x range (cm) a line can touch in the row at y, so masks skip the rest of the row:
 * "none" = the row is clear, null = test the whole row (other shapes, or a segment at the seam).
 */
export function columnSpan(
  shape: Shape,
  y: number,
  c: number,
  centerU: number,
): [number, number] | null | "none" {
  if (shape.kind !== "line") return null;
  let lo = Infinity;
  let hi = -Infinity;
  const pts = shape.points;
  for (let k = 0; k < pts.length - 1; k++) {
    const a = pts[k]!;
    const b = pts[k + 1]!;
    if (y < Math.min(a.y, b.y) - shape.half || y > Math.max(a.y, b.y) + shape.half) continue;
    const xa = screenX(a.u, centerU, c);
    // The segment is unwrapped from its first point, as in hits().
    const xb = xa - wrapDelta(b.u - a.u) * c;
    lo = Math.min(lo, xa, xb) - shape.half;
    hi = Math.max(hi, xa, xb) + shape.half;
  }
  if (lo === Infinity) return "none";
  if (lo < -c / 2 || hi > c / 2) return null;
  return [lo, hi];
}

/**
 * Coverage mask of one shape on the unwrap (exact per pixel, seam included): 255 inside, 0 outside.
 * Only rows [rowStart, rowStart + rows) are returned, `width` pixels each.
 */
export function shapeMask(
  shape: Shape,
  profile: ArmProfile,
  pxPerCm: number,
  centerU: number,
): { rowStart: number; rows: number; width: number; alpha: Uint8Array } {
  const width = Math.ceil(profile.maxCircumference * pxPerCm);
  const [y0, y1] = shapeYRange(shape, profile);
  const [first, last] = rowRange(profile, pxPerCm, y0, y1);
  const rows = Math.max(0, last - first + 1);
  const alpha = new Uint8Array(rows * width);
  for (let r = 0; r < rows; r++) {
    const j = first + r;
    const y = profile.length - (j + 0.5) / pxPerCm;
    const c = profile.circumferenceAt(y);
    // Only test the columns the shape can reach in this row (a whole row near the seam).
    const span = columnSpan(shape, y, c, centerU);
    if (span === "none") continue;
    const i0 = span ? Math.max(0, Math.floor((span[0] + profile.maxCircumference / 2) * pxPerCm) - 1) : 0;
    const i1 = span
      ? Math.min(width - 1, Math.ceil((span[1] + profile.maxCircumference / 2) * pxPerCm) + 1)
      : width - 1;
    for (let i = i0; i <= i1; i++) {
      const sx = (i + 0.5) / pxPerCm - profile.maxCircumference / 2;
      if (Math.abs(sx) > c / 2) continue;
      // Screen x grows to the right; u grows towards lateral, which is on the left.
      const u = centerU - sx / c;
      if (hits(shape, ((u % 1) + 1) % 1, y, c)) alpha[r * width + i] = 255;
    }
  }
  return { rowStart: first, rows, width, alpha };
}
