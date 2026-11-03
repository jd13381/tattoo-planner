// Starfield filler (PROJECT_BRIEF.md §7): a sparse, seeded scatter of dots and small four-point
// stars (a nod to Nyx and the sky goddess Nut). Density sets how many of a fixed, seeded list of
// candidates are drawn, so a higher density keeps every star of a lower one and adds more.
import { clamp01, mulberry32, type Generator, type Pt, type Shape } from "./geometry.ts";

/** Candidates per cm² at density 1. Even at full density the field stays open. */
const STARS_PER_CM2 = 0.45;

/** A four-point sparkle as a filled polygon around (cx, cy). */
export function sparkle(cx: number, cy: number, r: number, rot = 0): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < 8; i++) {
    const a = rot + (i * Math.PI) / 4;
    const rr = i % 2 === 0 ? r : r * 0.2;
    pts.push({ x: cx + Math.cos(a) * rr, y: cy + Math.sin(a) * rr });
  }
  return pts;
}

export const starfield: Generator = (p) => {
  const d = clamp01(p.density);
  const areaCm2 = (p.w * p.h) / (p.pxPerCm * p.pxPerCm);
  const total = Math.floor(areaCm2 * STARS_PER_CM2);
  const keep = Math.round(total * d);
  const rand = mulberry32(p.seed);
  const cm = p.pxPerCm;
  const shapes: Shape[] = [];
  for (let i = 0; i < total; i++) {
    // Draw all random numbers for every candidate, so the sequence does not depend on density.
    const x = p.x + rand() * p.w;
    const y = p.y + rand() * p.h;
    const kind = rand();
    const size = rand();
    const rot = (rand() - 0.5) * 0.3;
    if (i >= keep) continue;
    if (kind < 0.7) {
      shapes.push({ kind: "dot", x, y, r: (0.025 + 0.04 * size) * cm });
    } else if (kind < 0.94) {
      shapes.push({ kind: "fill", points: sparkle(x, y, (0.12 + 0.12 * size) * cm, rot) });
    } else {
      // A brighter star: a larger sparkle with a thin halo of four dots.
      const r = (0.3 + 0.15 * size) * cm;
      // Keep the group whole: skip it rather than leave a halo without its star at the edge.
      if (x - r < p.x || x + r > p.x + p.w || y - r < p.y || y + r > p.y + p.h) continue;
      shapes.push({ kind: "fill", points: sparkle(x, y, r, rot) });
      for (let k = 0; k < 4; k++) {
        const a = rot + Math.PI / 4 + (k * Math.PI) / 2;
        shapes.push({
          kind: "dot",
          x: x + Math.cos(a) * r * 0.55,
          y: y + Math.sin(a) * r * 0.55,
          r: 0.02 * cm,
        });
      }
    }
  }
  return shapes;
};
