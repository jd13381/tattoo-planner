// Framework-free geometry helpers for the procedural patterns (PROJECT_BRIEF.md §7).
// Generators return plain shapes in canvas pixels; `draw.ts` strokes them. Keeping the two apart
// lets the tests check the geometry in Node without a canvas.
import type { PatternContext } from "./types.ts";

export type Pt = { x: number; y: number };

/** A mark in canvas pixels. `alpha` (0..1, default 1) scales the ink opacity. */
export type Shape =
  | { kind: "stroke"; points: Pt[]; width: number; alpha?: number }
  | { kind: "fill"; points: Pt[]; alpha?: number }
  | { kind: "dot"; x: number; y: number; r: number; alpha?: number };

/** Everything a generator needs: the painter context without the canvas and the colour. */
export type PatternParams = Omit<PatternContext, "ctx" | "ink">;

export type Generator = (p: PatternParams) => Shape[];

// ---------------------------------------------------------------------------------------------
// Randomness

/** Stable 32-bit FNV-1a hash of a string, for seeding patterns from element ids. */
export function seedFromId(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: small, fast, deterministic PRNG returning floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Hash of a lattice point to [0, 1), independent of evaluation order. */
export function hash2(seed: number, ix: number, iy: number): number {
  let h = (seed ^ Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iy, 0x165667b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth 2D value noise in [0, 1) with features about `cell` units apart. */
export function valueNoise(seed: number, x: number, y: number, cell: number): number {
  const gx = x / cell;
  const gy = y / cell;
  const ix = Math.floor(gx);
  const iy = Math.floor(gy);
  const fx = gx - ix;
  const fy = gy - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash2(seed, ix, iy);
  const b = hash2(seed, ix + 1, iy);
  const c = hash2(seed, ix, iy + 1);
  const d = hash2(seed, ix + 1, iy + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

// ---------------------------------------------------------------------------------------------
// Bands

/**
 * Horizontal repeat of a band in px. With `ringCm`, the target module is stretched or squeezed so
 * that a whole number of modules spans the ring exactly and the band meets itself at the seam.
 */
export function bandRepeatPx(targetCm: number, pxPerCm: number, ringCm?: number): number {
  if (ringCm === undefined || !(ringCm > 0)) return targetCm * pxPerCm;
  const n = Math.max(1, Math.round(ringCm / targetCm));
  return (ringCm / n) * pxPerCm;
}

/** Left edges of the band modules covering [x, x + w], anchored at x (one spare on each side). */
export function bandModules(x: number, w: number, repeat: number): number[] {
  const out: number[] = [];
  for (let k = -1; x + k * repeat < x + w + repeat; k++) out.push(x + k * repeat);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Clipping

export type Rect = { x: number; y: number; w: number; h: number };

function inside(r: Rect, p: Pt, pad = 0): boolean {
  return p.x >= r.x - pad && p.x <= r.x + r.w + pad && p.y >= r.y - pad && p.y <= r.y + r.h + pad;
}

/** Liang–Barsky: the part of segment a→b inside r, or null. */
export function clipSegment(r: Rect, a: Pt, b: Pt): [Pt, Pt] | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let t0 = 0;
  let t1 = 1;
  const edges: [number, number][] = [
    [-dx, a.x - r.x],
    [dx, r.x + r.w - a.x],
    [-dy, a.y - r.y],
    [dy, r.y + r.h - a.y],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return null;
      continue;
    }
    const t = q / p;
    if (p < 0) {
      if (t > t1) return null;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return null;
      if (t < t1) t1 = t;
    }
  }
  return [
    { x: a.x + t0 * dx, y: a.y + t0 * dy },
    { x: a.x + t1 * dx, y: a.y + t1 * dy },
  ];
}

const EPS = 1e-6;

/**
 * Restricts shapes to the rectangle: strokes are cut at its edges (possibly into several pieces),
 * fills and dots are kept only when they lie completely inside.
 */
export function clipShapes(shapes: Shape[], r: Rect): Shape[] {
  const out: Shape[] = [];
  for (const s of shapes) {
    if (s.kind === "dot") {
      if (s.x - s.r >= r.x && s.x + s.r <= r.x + r.w && s.y - s.r >= r.y && s.y + s.r <= r.y + r.h)
        out.push(s);
      continue;
    }
    if (s.kind === "fill") {
      if (s.points.every((p) => inside(r, p))) out.push(s);
      continue;
    }
    let current: Pt[] = [];
    const flush = () => {
      if (current.length > 1) out.push({ ...s, points: current });
      current = [];
    };
    for (let i = 0; i + 1 < s.points.length; i++) {
      const seg = clipSegment(r, s.points[i]!, s.points[i + 1]!);
      if (!seg) {
        flush();
        continue;
      }
      const last = current[current.length - 1];
      if (last && Math.abs(last.x - seg[0].x) < EPS && Math.abs(last.y - seg[0].y) < EPS) {
        current.push(seg[1]);
      } else {
        flush();
        current.push(seg[0], seg[1]);
      }
      // A segment that leaves the rect ends the piece.
      if (!inside(r, s.points[i + 1]!, EPS)) flush();
    }
    flush();
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Small curve helpers

/** Samples a quadratic Bézier a→b with control c (excluding a when `skipFirst`). */
export function quad(a: Pt, c: Pt, b: Pt, steps = 10, skipFirst = false): Pt[] {
  const pts: Pt[] = [];
  for (let i = skipFirst ? 1 : 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    pts.push({
      x: u * u * a.x + 2 * u * t * c.x + t * t * b.x,
      y: u * u * a.y + 2 * u * t * c.y + t * t * b.y,
    });
  }
  return pts;
}

/** Total length of all strokes plus dot/fill counts, a simple "how much ink" measure. */
export function inkMeasure(shapes: Shape[]): { strokeLength: number; marks: number } {
  let strokeLength = 0;
  for (const s of shapes) {
    if (s.kind !== "stroke") continue;
    for (let i = 0; i + 1 < s.points.length; i++)
      strokeLength += Math.hypot(s.points[i + 1]!.x - s.points[i]!.x, s.points[i + 1]!.y - s.points[i]!.y);
  }
  return { strokeLength, marks: shapes.length };
}

export const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
