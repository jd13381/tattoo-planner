// Registry of procedural patterns for the reference renderer (PROJECT_BRIEF.md §7, §14 Phase 4).
// Layout elements name a pattern with `pattern:`; unknown names get a faint fallback hatch.
import { painterFrom } from "./draw.ts";
import { fallback } from "./fallback.ts";
import { clipShapes, type Generator, type PatternParams, type Shape } from "./geometry.ts";
import { hatching } from "./hatching.ts";
import { lotus } from "./lotus.ts";
import { meander } from "./meander.ts";
import { snakeScales } from "./snakeScales.ts";
import { starfield } from "./starfield.ts";
import type { PatternPainter } from "./types.ts";

export { seedFromId } from "./geometry.ts";
export type { PatternContext, PatternPainter } from "./types.ts";

/** Pattern name → geometry generator. Bands: meander, lotus. Fillers: the rest. */
export const GENERATORS: Record<string, Generator> = {
  "snake-scales": snakeScales,
  meander,
  lotus,
  "lotus-frieze": lotus,
  hatching,
  starfield,
};

export const PATTERNS: Record<string, PatternPainter> = Object.fromEntries(
  Object.entries(GENERATORS).map(([name, g]) => [name, painterFrom(g)]),
);

export const fallbackPainter: PatternPainter = painterFrom(fallback);

export function isKnownPattern(name: string): boolean {
  return Object.hasOwn(PATTERNS, name);
}

/** The painter for a pattern name; unknown names get the fallback painter. */
export function getPattern(name: string): PatternPainter {
  return isKnownPattern(name) ? PATTERNS[name]! : fallbackPainter;
}

/** The clipped shapes a pattern would draw (for tests, previews and metrics without a canvas). */
export function patternShapes(name: string, p: PatternParams): Shape[] {
  const g = Object.hasOwn(GENERATORS, name) ? GENERATORS[name]! : fallback;
  return clipShapes(g(p), p);
}
