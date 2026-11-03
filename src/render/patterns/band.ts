// Shared frame for band patterns: thin border lines along both edges and the inner field the
// motif fills. The horizontal repeat fits the ring exactly when ringCm is known.
import { bandModules, bandRepeatPx, type PatternParams, type Shape } from "./geometry.ts";

export type BandFrame = {
  /** Top and bottom of the inner field, in px. */
  top: number;
  bottom: number;
  /** Width of one repeat in px and the left edges of the modules to draw. */
  repeat: number;
  modules: number[];
  /** Stroke width for the motif. */
  line: number;
  borders: Shape[];
};

/**
 * @param moduleOverField target repeat width as a multiple of the inner field height
 */
export function bandFrame(p: PatternParams, moduleOverField: number): BandFrame {
  const line = Math.max(0.6, Math.min(0.045 * p.pxPerCm, p.h * 0.05));
  const borderInset = Math.max(line, p.h * 0.05);
  const fieldInset = p.h * 0.17;
  const top = p.y + fieldInset;
  const bottom = p.y + p.h - fieldInset;
  const fieldCm = (bottom - top) / p.pxPerCm;
  const repeat = bandRepeatPx(fieldCm * moduleOverField, p.pxPerCm, p.ringCm);
  const border = (y: number): Shape => ({
    kind: "stroke",
    points: [
      { x: p.x, y },
      { x: p.x + p.w, y },
    ],
    width: line * 0.8,
  });
  return {
    top,
    bottom,
    repeat,
    modules: bandModules(p.x, p.w, repeat),
    line,
    borders: [border(p.y + borderInset), border(p.y + p.h - borderInset)],
  };
}
