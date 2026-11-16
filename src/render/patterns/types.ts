// Contract for procedural fillers and bands (docs/history/project-brief.md §7, §14 Phase 4).
// A painter fills a pixel rectangle of the unwrap canvas; the caller clips the result to the
// element's shape. Painters are deterministic: the same inputs always give the same pixels.

export type PatternContext = {
  ctx: CanvasRenderingContext2D;
  /** Rectangle to fill, in canvas pixels. */
  x: number;
  y: number;
  w: number;
  h: number;
  pxPerCm: number;
  /** 0..1, from the layout element (fillers); bands use 1. */
  density: number;
  /** Seed for any randomness, derived from the element id. */
  seed: number;
  /** Ink colour (CSS). */
  ink: string;
  /**
   * Bands only: the arm circumference in cm at the band, so the pattern repeat can be adjusted
   * to a whole number of repeats and meets itself at the seam.
   */
  ringCm?: number;
};

export type PatternPainter = (p: PatternContext) => void;
