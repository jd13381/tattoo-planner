// Meander (Greek key) band (PROJECT_BRIEF.md §7, Greek side): square spirals on a running base line
// between two thin border lines. The module is about as wide as the band is high.
import { bandFrame } from "./band.ts";
import type { Generator, Pt, Shape } from "./geometry.ts";

/**
 * One key on a 5 × 4 grid (x along the band, y up from the bottom of the field): a square spiral
 * rising from the continuous base line, as in the classic running key. Line and gap are both one
 * grid unit wide.
 */
export const KEY_SPIRAL: readonly [number, number][] = [
  [0, 0],
  [0, 4],
  [4, 4],
  [4, 1],
  [1, 1],
  [1, 3],
  [3, 3],
  [3, 2],
  [2, 2],
];
const KEY_W = 5;
const KEY_H = 4;

export const meander: Generator = (p) => {
  const f = bandFrame(p, KEY_W / KEY_H);
  const sx = f.repeat / KEY_W;
  const sy = (f.bottom - f.top) / KEY_H;
  const at = (x0: number, [gx, gy]: readonly [number, number]): Pt => ({
    x: x0 + gx * sx,
    y: f.bottom - gy * sy,
  });
  const shapes: Shape[] = [...f.borders];
  const first = f.modules[0]!;
  const last = f.modules[f.modules.length - 1]!;
  shapes.push({
    kind: "stroke",
    points: [at(first, [0, 0]), at(last + f.repeat, [0, 0])],
    width: f.line,
  });
  for (const x0 of f.modules)
    shapes.push({ kind: "stroke", points: KEY_SPIRAL.map((g) => at(x0, g)), width: f.line });
  return shapes;
};
