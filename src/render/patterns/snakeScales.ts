// Snake-scale filler (docs/history/project-brief.md §7): staggered rows of overlapping scales in B&G linework.
// Density decides how many scales are inked; a smooth noise field plus an edge fade makes the
// texture scatter out into open skin instead of ending as a hard-edged wallpaper (§4.4).
import { clamp01, hash2, valueNoise, type Generator, type Pt, type Shape } from "./geometry.ts";

/** Scale width across the arm in cm. */
export const SCALE_WIDTH_CM = 1.2;
/** Scale height relative to its width (snake scales are a little flatter than fish scales). */
const SCALE_ASPECT = 0.62;
/** How pointed the free edge is: 0 round, 1 a straight V. */
const POINT = 0.35;
/** Distance in cm over which scales thin out towards the region edge. */
const EDGE_FADE_CM = 2;

type Scale = { cx: number; cy: number; rx: number; ry: number };

/** y of a scale's free edge at x: its corners lie at (cx ± rx, cy), its tip at (cx, cy + ry). */
function edgeY(s: Scale, x: number): number {
  const u = Math.min(1, Math.abs((x - s.cx) / s.rx));
  return s.cy + s.ry * (Math.sqrt(1 - u * u) * (1 - POINT) + (1 - u) * POINT);
}

function edge(s: Scale, from = -1, to = 1, steps = 14): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const x = s.cx + s.rx * (from + ((to - from) * i) / steps);
    pts.push({ x, y: edgeY(s, x) });
  }
  return pts;
}

export const snakeScales: Generator = (p) => {
  const density = clamp01(p.density);
  if (density <= 0) return [];
  const rx = (SCALE_WIDTH_CM / 2) * p.pxPerCm;
  const ry = rx * 2 * SCALE_ASPECT;
  const line = Math.max(0.6, 0.035 * p.pxPerCm);
  const fine = line * 0.6;
  const fade = EDGE_FADE_CM * p.pxPerCm;
  const shapes: Shape[] = [];

  // Rows are ry apart and staggered by rx, so each edge touches the corners of the row below.
  const rows = Math.ceil(p.h / ry) + 1;
  const cols = Math.ceil(p.w / (2 * rx)) + 2;
  for (let j = 0; j <= rows; j++) {
    const cy = p.y + (j - 1) * ry;
    const shift = j % 2 === 0 ? 0 : rx;
    for (let i = -1; i <= cols; i++) {
      const cx = p.x + i * 2 * rx + shift;
      // Score in [0, 1] that does not depend on density: a scale is inked when score <= density,
      // so raising the density only ever adds marks.
      const my = cy + ry / 2;
      const toEdge = Math.min(cx - p.x, p.x + p.w - cx, my - p.y, p.y + p.h - my);
      const score = clamp01(
        0.55 * valueNoise(p.seed, cx, my, 3.5 * p.pxPerCm) +
          0.3 * hash2(p.seed + 1, i, j) +
          0.15 * (1 - clamp01(toEdge / fade)),
      );
      if (score > density) continue;
      const outer: Scale = { cx, cy, rx, ry };
      shapes.push({ kind: "stroke", points: edge(outer), width: line });
      // Deeper in the inked area a rim line inside the edge, and in the densest part short
      // shading ticks between rim and edge.
      if (score > density - 0.2) continue;
      const rim: Scale = { cx, cy: cy - ry * 0.2, rx: rx * 0.72, ry: ry * 0.92 };
      shapes.push({ kind: "stroke", points: edge(rim, -0.85, 0.85, 10), width: fine });
      if (score > density - 0.4) continue;
      for (const f of [-0.42, -0.14, 0.14, 0.42]) {
        const x = cx + f * rx;
        shapes.push({
          kind: "stroke",
          points: [
            { x, y: edgeY(outer, x) - fine * 1.5 },
            { x, y: edgeY(rim, x) + fine * 1.5 },
          ],
          width: fine,
        });
      }
    }
  }
  return shapes;
};
