// Red strokes drawn on the 3D arm (PROJECT_BRIEF.md §4.3, §14 Phase 6 "brush tool"): from texture
// coordinates of raycast hits to a simplified `line` element in layout coordinates. Pure maths, no DOM.
//
// Lines are drawn straight between their points in (u, y) with u scaled by the local circumference
// (src/layout/shapes.ts `hits`), and a segment always takes the short way round the arm. The
// simplification measures distances the same way, so the simplified line stays within the
// tolerance of what was drawn, also across the inner seam.
import type { ArmProfile } from "../arm/profile.ts";
import { wrapU } from "../arm/uv.ts";
import type { Layout, LayoutElement } from "../layout/schema.ts";
import { wrapDelta } from "../layout/shapes.ts";

export type UV = { u: number; v: number };
type LineElement = Extract<LayoutElement, { type: "line" }>;

/** Largest deviation (cm on the skin) the simplified stroke may have from the drawn one. */
export const STROKE_TOLERANCE_CM = 0.3;
/** Samples closer than this to the previous one are skipped while drawing. */
export const STROKE_MIN_STEP_CM = 0.2;
/** Strokes shorter than this are taken as a click and dropped. */
export const STROKE_MIN_LENGTH_CM = 1;
/** Width of a new stroke when the layout has no red line yet (red-stroke-1 in the brief). */
export const DEFAULT_STROKE_WIDTH_CM = 1.5;

const round = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Layout coordinates of a texture point (three.js UV: x across the unwrap, y = v, origin bottom
 * left; see src/arm/uv.ts layoutToTexture). Null outside the skin of that row.
 */
export function textureToLayout(profile: ArmProfile, x: number, y: number): UV | null {
  const v = Math.min(1, Math.max(0, y));
  const cm = (0.5 - x) * profile.maxCircumference; // lateral positive, from the outer line
  const c = profile.circumferenceAt(v * profile.length);
  if (Math.abs(cm) > c / 2 + 1e-6) return null;
  return { u: wrapU(cm / c), v };
}

/** Distance in cm on the skin between two layout points, the short way round. */
export function skinDistance(profile: ArmProfile, a: UV, b: UV): number {
  const y = ((a.v + b.v) / 2) * profile.length;
  return Math.hypot(wrapDelta(b.u - a.u) * profile.circumferenceAt(y), (b.v - a.v) * profile.length);
}

/** Adds a sample unless it is closer than `minCm` to the last one; returns the same array if skipped. */
export function addSample(profile: ArmProfile, points: UV[], p: UV, minCm = STROKE_MIN_STEP_CM): UV[] {
  const last = points[points.length - 1];
  if (last && skinDistance(profile, last, p) < minCm) return points;
  return [...points, p];
}

export function strokeLength(profile: ArmProfile, points: UV[]): number {
  let sum = 0;
  for (let i = 1; i < points.length; i++) sum += skinDistance(profile, points[i - 1]!, points[i]!);
  return sum;
}

/** Distance (cm) of p from segment a–b, measured as the line renders: u scaled by p's circumference. */
function segmentDistance(profile: ArmProfile, p: UV, a: UV, b: UV): number {
  const L = profile.length;
  const c = profile.circumferenceAt(p.v * L);
  // Unwrapped around p, so a segment across the seam stays in one piece.
  const ax = wrapDelta(a.u - p.u) * c;
  const ay = (a.v - p.v) * L;
  const bx = ax + wrapDelta(b.u - a.u) * c;
  const by = (b.v - p.v) * L;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.min(1, Math.max(0, -(ax * dx + ay * dy) / len2)) : 0;
  return Math.hypot(ax + t * dx, ay + t * dy);
}

/**
 * Ramer–Douglas–Peucker on the skin: keeps the fewest points whose line stays within `toleranceCm`
 * of every drawn sample. Points come back wrapped to 0…1 and rounded like the editor's edits.
 */
export function simplifyStroke(profile: ArmProfile, points: UV[], toleranceCm = STROKE_TOLERANCE_CM): UV[] {
  if (points.length <= 2) return points.map((p) => ({ u: round(wrapU(p.u)), v: round(p.v) }));
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [i, j] = stack.pop()!;
    let worst = -1;
    let at = -1;
    for (let k = i + 1; k < j; k++) {
      const d = segmentDistance(profile, points[k]!, points[i]!, points[j]!);
      if (d > worst) {
        worst = d;
        at = k;
      }
    }
    if (at >= 0 && worst > toleranceCm) {
      keep[at] = 1;
      stack.push([i, at], [at, j]);
    }
  }
  return points.filter((_, i) => keep[i]).map((p) => ({ u: round(wrapU(p.u)), v: round(p.v) }));
}

/**
 * Joins a new stroke to an existing line at whichever ends are closest, so drawing on from either
 * end of a line continues it. The existing points keep their order.
 */
export function appendStroke(profile: ArmProfile, line: UV[], stroke: UV[]): UV[] {
  if (line.length === 0) return stroke;
  if (stroke.length === 0) return line;
  const first = line[0]!;
  const last = line[line.length - 1]!;
  const options = [
    { d: skinDistance(profile, last, stroke[0]!), pts: () => [...line, ...stroke] },
    {
      d: skinDistance(profile, last, stroke[stroke.length - 1]!),
      pts: () => [...line, ...[...stroke].reverse()],
    },
    { d: skinDistance(profile, first, stroke[stroke.length - 1]!), pts: () => [...stroke, ...line] },
    { d: skinDistance(profile, first, stroke[0]!), pts: () => [...[...stroke].reverse(), ...line] },
  ];
  return options.reduce((best, o) => (o.d < best.d ? o : best)).pts();
}

/** `red-stroke-N` with the smallest free N. */
export function nextStrokeId(taken: Iterable<string>): string {
  const ids = new Set(taken);
  let n = 1;
  while (ids.has(`red-stroke-${n}`)) n++;
  return `red-stroke-${n}`;
}

/** Width of a new stroke: that of the layout's first red line, else the brief's 1.5 cm. */
export function defaultStrokeWidth(layout: Layout): number {
  const red = layout.elements.find(
    (e): e is LineElement => e.type === "line" && (e.color ?? "red") === "red",
  );
  return red?.width_cm ?? DEFAULT_STROKE_WIDTH_CM;
}

/**
 * Applies a drawn stroke (raw samples in layout coordinates) to the layout: appended to the line at
 * `appendTo`, or as a new red line on top. Returns null for a stroke too short to keep.
 */
export function applyStroke(
  profile: ArmProfile,
  layout: Layout,
  samples: UV[],
  appendTo: number | null,
): { layout: Layout; index: number } | null {
  if (samples.length < 2 || strokeLength(profile, samples) < STROKE_MIN_LENGTH_CM) return null;
  const target = appendTo !== null ? layout.elements[appendTo] : undefined;
  if (target?.type === "line") {
    // Only the new part is simplified: points placed by hand are never dropped.
    const points = appendStroke(profile, target.points, simplifyStroke(profile, samples));
    const elements = layout.elements.map((e, i) => (i === appendTo ? { ...target, points } : e));
    return { layout: { ...layout, elements }, index: appendTo! };
  }
  const line: LineElement = {
    id: nextStrokeId(layout.elements.map((e) => e.id)),
    type: "line",
    color: "red",
    points: simplifyStroke(profile, samples),
    width_cm: defaultStrokeWidth(layout),
  };
  return { layout: { ...layout, elements: [...layout.elements, line] }, index: layout.elements.length };
}
