// Hatching filler (docs/history/project-brief.md §4.2, §7): parallel lines in the engraving language of the
// Anubis. Density tightens the spacing; above the middle a second, crossing layer joins in.
// Line ends are trimmed by a seeded amount, so the edge frays out instead of ending as a box.
import { clamp01, clipSegment, hash2, type Generator, type PatternParams, type Shape } from "./geometry.ts";

/** Line spacing in cm at density 0+ and at density 1. */
const SPACING_CM: [number, number] = [0.6, 0.16];
/** Density above which the crossing layer starts. */
const CROSS_FROM = 0.5;

/** Parallel lines at `angle` (radians) through the rect, `spacing` px apart, trimmed at both ends. */
export function hatchLines(
  p: Pick<PatternParams, "x" | "y" | "w" | "h" | "seed" | "pxPerCm">,
  angle: number,
  spacing: number,
  width: number,
  trimCm: number,
  layer = 0,
  alpha?: number,
): Shape[] {
  const shapes: Shape[] = [];
  const dir = { x: Math.cos(angle), y: Math.sin(angle) };
  const normal = { x: -dir.y, y: dir.x };
  const cx = p.x + p.w / 2;
  const cy = p.y + p.h / 2;
  const half = Math.hypot(p.w, p.h) / 2;
  const n = Math.ceil(half / spacing);
  const trim = trimCm * p.pxPerCm;
  for (let k = -n; k <= n; k++) {
    const ox = cx + normal.x * k * spacing;
    const oy = cy + normal.y * k * spacing;
    const seg = clipSegment(
      p,
      { x: ox - dir.x * half, y: oy - dir.y * half },
      { x: ox + dir.x * half, y: oy + dir.y * half },
    );
    if (!seg) continue;
    const [a, b] = seg;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const t0 = hash2(p.seed + 10 + layer, k, 0) * trim;
    const t1 = hash2(p.seed + 10 + layer, k, 1) * trim;
    if (len - t0 - t1 < 0.2 * p.pxPerCm) continue;
    const ux = (b.x - a.x) / len;
    const uy = (b.y - a.y) / len;
    shapes.push({
      kind: "stroke",
      points: [
        { x: a.x + ux * t0, y: a.y + uy * t0 },
        { x: b.x - ux * t1, y: b.y - uy * t1 },
      ],
      // Alternate slightly heavier lines, like an engraving burin.
      width: k % 3 === 0 ? width * 1.35 : width,
      alpha,
    });
  }
  return shapes;
}

export const hatching: Generator = (p) => {
  const d = clamp01(p.density);
  if (d <= 0) return [];
  const spacing = (SPACING_CM[0] + (SPACING_CM[1] - SPACING_CM[0]) * d) * p.pxPerCm;
  const width = Math.max(0.5, 0.03 * p.pxPerCm);
  const shapes = hatchLines(p, -Math.PI / 4, spacing, width, 1.2);
  if (d > CROSS_FROM) {
    // The crossing layer starts wide and closes up towards density 1.
    const t = (d - CROSS_FROM) / (1 - CROSS_FROM);
    const crossSpacing = spacing * (3 - 1.6 * t);
    shapes.push(...hatchLines(p, Math.PI / 4, crossSpacing, width * 0.8, 1.8, 1, 0.85));
  }
  return shapes;
};
