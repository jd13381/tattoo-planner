// Fallback for pattern names the registry does not know: a faint, wide diagonal hatch, so the
// element is visible in reference mode without pretending to be a real design.
import { hatchLines } from "./hatching.ts";
import type { Generator } from "./geometry.ts";

export const fallback: Generator = (p) =>
  hatchLines(p, -Math.PI / 4, 1 * p.pxPerCm, Math.max(0.5, 0.025 * p.pxPerCm), 0, 0, 0.35);
