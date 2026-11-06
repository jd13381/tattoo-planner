// Procedural standard backgrounds (docs/adr/0019): clouds, stars, smoke (dotwork shading), waves and
// a geometric lattice, as seamless tiles in black-grey ink. Deterministic: the same name, seed and
// settings always give the same pixels. Everything repeats exactly at the tile edges (periodic noise,
// marks drawn with wrap-around), so no seam fix is needed. Sketch placeholders for the artist talk,
// not designs.
import { inkTile, type Tile } from "./tile.ts";

function mix32(h: number): number {
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * Hash of a lattice point to [0, 1). Each coordinate goes through a full mixing round (the patterns'
 * hash2 leaves neighbouring cells correlated, which shows as stripes in fractal noise).
 */
export function hash2(seed: number, ix: number, iy: number): number {
  return mix32(mix32(mix32(seed >>> 0) ^ (ix | 0)) ^ (iy | 0)) / 4294967296;
}

export type ProceduralParams = {
  /** 0..1, how much ink. */
  density: number;
  seed: number;
  /** Ink colour as RGB. */
  ink: readonly number[];
  /** Tile width in cm and pixels per cm of the tile. */
  tileCm: number;
  pxPerCm: number;
};

type Field = { w: number; h: number; ppc: number; ink: Float32Array };

const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const mod = (a: number, n: number) => ((a % n) + n) % n;

/** Value noise that repeats every `px` × `py` lattice cells (x, y in cells). */
export function periodicNoise(seed: number, x: number, y: number, px: number, py: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const x0 = mod(ix, px);
  const x1 = mod(ix + 1, px);
  const y0 = mod(iy, py);
  const y1 = mod(iy + 1, py);
  const a = hash2(seed, x0, y0);
  const b = hash2(seed, x1, y0);
  const c = hash2(seed, x0, y1);
  const d = hash2(seed, x1, y1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/** Fractal noise over a tile of `w` × `h` px: `cells` lattice cells across at the coarsest octave. */
export function periodicFbm(
  seed: number,
  x: number,
  y: number,
  w: number,
  h: number,
  cells: number,
  octaves = 5,
): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let cx = cells;
  let cy = Math.max(1, Math.round((cells * h) / w));
  for (let o = 0; o < octaves; o++) {
    sum += amp * periodicNoise(seed + o * 1013, (x / w) * cx, (y / h) * cy, cx, cy);
    norm += amp;
    amp *= 0.5;
    cx *= 2;
    cy *= 2;
  }
  return sum / norm;
}

function field(p: ProceduralParams, aspect = 1): Field {
  const w = Math.max(8, Math.round(p.tileCm * p.pxPerCm));
  const h = Math.max(8, Math.round(w * aspect));
  return { w, h, ppc: w / p.tileCm, ink: new Float32Array(w * h) };
}

/** Adds ink with a soft round mark at (cx, cy) px of radius r px, wrapping round the tile. */
function dot(f: Field, cx: number, cy: number, r: number, strength = 1) {
  const x0 = Math.floor(cx - r - 1);
  const x1 = Math.ceil(cx + r + 1);
  const y0 = Math.floor(cy - r - 1);
  const y1 = Math.ceil(cy + r + 1);
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      const a = clamp01(r + 0.5 - d) * strength;
      if (a <= 0) continue;
      const k = mod(y, f.h) * f.w + mod(x, f.w);
      f.ink[k] = Math.max(f.ink[k]!, a);
    }
}

/** A four-point sparkle (astroid) at (cx, cy) px, radius r px, wrapping round the tile. */
function sparkle(f: Field, cx: number, cy: number, r: number) {
  const n = Math.ceil(r + 1);
  for (let y = -n; y <= n; y++)
    for (let x = -n; x <= n; x++) {
      const ax = Math.abs(x + 0.5 - (cx - Math.floor(cx))) / r;
      const ay = Math.abs(y + 0.5 - (cy - Math.floor(cy))) / r;
      // |x|^½ + |y|^½ ≤ 1 is a four-pointed star; the soft edge keeps the points from aliasing.
      const v = Math.sqrt(ax) + Math.sqrt(ay);
      const a = clamp01((1 - v) * r * 0.6 + 0.5);
      if (a <= 0) continue;
      const k = mod(Math.floor(cy) + y, f.h) * f.w + mod(Math.floor(cx) + x, f.w);
      f.ink[k] = Math.max(f.ink[k]!, a);
    }
}

/**
 * Puffy clouds as in a black-and-grey sky: clusters of overlapping billows (discs) with an ink rim
 * around their union and grey shading on each billow's underside. Density sets how many clouds a tile holds.
 */
function clouds(p: ProceduralParams): Field {
  const f = field(p);
  const d = clamp01(p.density);
  type Disc = { x: number; y: number; r: number; cloud: number };
  const discs: Disc[] = [];
  const count = 2 + Math.round(3 * d);
  for (let c = 0; c < count; c++) {
    const cx = hash2(p.seed, c, 1) * f.w;
    const cy = hash2(p.seed, c, 2) * f.h;
    const width = (3 + 3 * hash2(p.seed, c, 3)) * f.ppc;
    const base = (0.9 + 0.6 * hash2(p.seed, c, 4)) * f.ppc;
    // A bottom row of billows, then a smaller row on top of its middle.
    const n = 3 + Math.floor(hash2(p.seed, c, 5) * 3);
    for (let k = 0; k < n; k++) {
      const t = n === 1 ? 0 : k / (n - 1) - 0.5;
      const r = base * (0.75 + 0.5 * hash2(p.seed, c, 10 + k)) * (1 - Math.abs(t) * 0.5);
      discs.push({ x: cx + t * width, y: cy, r, cloud: c });
    }
    for (let k = 0; k < n - 1; k++) {
      const t = (k + 0.5) / (n - 1) - 0.5;
      const r = base * (0.9 + 0.5 * hash2(p.seed, c, 20 + k)) * (1 - Math.abs(t) * 0.6);
      discs.push({ x: cx + t * width * 0.7, y: cy - base * 0.75, r, cloud: c });
    }
  }
  const half = Math.max(0.6, 0.035 * f.ppc);
  const wrap = (dd: number, n: number) => dd - n * Math.round(dd / n);
  for (let y = 0; y < f.h; y++)
    for (let x = 0; x < f.w; x++) {
      // Signed distance to the union of the billows (positive inside).
      let inside = -Infinity;
      let shade = 0;
      for (const b of discs) {
        const dx = wrap(x + 0.5 - b.x, f.w);
        const dy = wrap(y + 0.5 - b.y, f.h);
        const dist = Math.hypot(dx, dy);
        const sd = b.r - dist;
        if (sd > inside) inside = sd;
        if (sd > 0) {
          // Underside shading: darker towards the bottom of each billow.
          shade = Math.max(shade, 0.4 * smoothstep(0.1, 1, dy / b.r) * smoothstep(0, b.r * 0.5, sd));
        }
      }
      const rim = clamp01(half + 0.5 - Math.abs(inside));
      f.ink[y * f.w + x] = clamp01(Math.max(rim, inside > 0 ? shade : 0));
    }
  return f;
}

/** A scatter of dots and four-point stars of a few sizes. */
function stars(p: ProceduralParams): Field {
  const f = field(p);
  const d = clamp01(p.density);
  const cell = 0.9; // cm per jitter cell
  const nx = Math.max(1, Math.round(p.tileCm / cell));
  const ny = Math.max(1, Math.round(f.h / f.ppc / cell));
  const cw = f.w / nx;
  const ch = f.h / ny;
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      // Every random value is drawn for every cell, so a higher density keeps the stars of a lower one.
      const keep = hash2(p.seed, i, j);
      const x = (i + hash2(p.seed + 1, i, j)) * cw;
      const y = (j + hash2(p.seed + 2, i, j)) * ch;
      const kind = hash2(p.seed + 3, i, j);
      const size = hash2(p.seed + 4, i, j);
      if (keep > 0.25 + 0.75 * d) continue;
      if (kind < 0.62) dot(f, x, y, (0.03 + 0.05 * size) * f.ppc);
      else if (kind < 0.93) sparkle(f, x, y, (0.14 + 0.16 * size) * f.ppc);
      else {
        sparkle(f, x, y, (0.32 + 0.18 * size) * f.ppc);
        dot(f, x, y, 0.06 * f.ppc);
      }
      // A few tiny dust dots around each cell.
      for (let k = 0; k < 2; k++) {
        if (hash2(p.seed + 10 + k, i, j) > 0.35 + 0.5 * d) continue;
        dot(
          f,
          (i + hash2(p.seed + 20 + k, i, j)) * cw,
          (j + hash2(p.seed + 30 + k, i, j)) * ch,
          0.018 * f.ppc,
          0.8,
        );
      }
    }
  return f;
}

/** Dotwork shading in smoky swirls: a jittered dot grid whose dots grow where the smoke is dense. */
function smoke(p: ProceduralParams): Field {
  const f = field(p);
  const d = clamp01(p.density);
  const pitch = 0.2; // cm between dots
  const nx = Math.max(1, Math.round(p.tileCm / pitch));
  const ny = Math.max(1, Math.round(f.h / f.ppc / pitch));
  const cw = f.w / nx;
  const ch = f.h / ny;
  const maxR = 0.075 * f.ppc;
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const x = (i + 0.2 + 0.6 * hash2(p.seed + 1, i, j)) * cw;
      const y = (j + 0.2 + 0.6 * hash2(p.seed + 2, i, j)) * ch;
      // Domain-warped noise gives the drifting, smoky shapes.
      const wx = periodicFbm(p.seed + 7, x, y, f.w, f.h, 3, 3) - 0.5;
      const wy = periodicFbm(p.seed + 9, x, y, f.w, f.h, 3, 3) - 0.5;
      const v = periodicFbm(
        p.seed,
        mod(x + wx * f.w * 0.3, f.w),
        mod(y + wy * f.h * 0.3, f.h),
        f.w,
        f.h,
        3,
        4,
      );
      const shade = smoothstep(0.62 - 0.3 * d, 0.85, v);
      if (shade <= 0.02 || hash2(p.seed + 3, i, j) > 0.35 + 0.65 * shade) continue;
      dot(f, x, y, Math.max(0.35, maxR * Math.sqrt(shade)));
    }
  return f;
}

/** Flowing wave lines, close together, with a slow swell. */
function waves(p: ProceduralParams): Field {
  const f = field(p);
  const d = clamp01(p.density);
  const spacing = (0.9 - 0.5 * d) * f.ppc;
  const rows = Math.max(2, Math.round(f.h / spacing));
  const gap = f.h / rows;
  const half = Math.max(0.6, 0.04 * f.ppc);
  const amp = gap * 0.9;
  for (let x = 0; x < f.w; x++) {
    const tx = x / f.w;
    for (let r = 0; r < rows; r++) {
      // Two whole waves and a ripple per tile width: periodic in x by construction.
      const ph = hash2(p.seed, r, 0) * Math.PI * 2;
      const yc =
        (r + 0.5) * gap +
        amp * 0.6 * Math.sin(2 * Math.PI * 2 * tx + ph) +
        amp * 0.25 * Math.sin(2 * Math.PI * 5 * tx + ph * 1.7) +
        amp * 0.5 * (periodicFbm(p.seed + r, x, 0, f.w, 1, 2, 2) - 0.5);
      // Slope-corrected half width, so steep parts are not thinner.
      const dy =
        amp * 0.6 * 2 * Math.PI * 2 * Math.cos(2 * Math.PI * 2 * tx + ph) +
        amp * 0.25 * 2 * Math.PI * 5 * Math.cos(2 * Math.PI * 5 * tx + ph * 1.7);
      const hw = half * Math.sqrt(1 + (dy / f.w) ** 2);
      for (let y = Math.floor(yc - hw - 1); y <= Math.ceil(yc + hw + 1); y++) {
        const a = clamp01(hw + 0.5 - Math.abs(y + 0.5 - yc));
        const k = mod(y, f.h) * f.w + x;
        f.ink[k] = Math.max(f.ink[k]!, a);
      }
    }
  }
  return f;
}

/** A triangle lattice of thin lines with dots at the crossings (sacred-geometry dotwork). */
function geometric(p: ProceduralParams): Field {
  // The tile holds whole lattice cells: n across (a = width / n) and an even number of rows of height
  // about a·√3/2, so odd rows (shifted by half a cell) repeat too.
  const n = Math.max(2, Math.round(p.tileCm / 1.5));
  const rowsN = Math.max(2, 2 * Math.round((n * 0.866) / 2));
  const f = field(p, (rowsN * 0.866) / n);
  const a = f.w / n;
  const rh = f.h / rowsN;
  const d = clamp01(p.density);
  const half = Math.max(0.5, (0.015 + 0.02 * d) * f.ppc);
  for (let y = 0; y < f.h; y++)
    for (let x = 0; x < f.w; x++) {
      // Distance to the horizontal lines and the two diagonals of the lattice, in px.
      const ry = y + 0.5;
      const rx = x + 0.5;
      const row = ry / rh;
      const dh = Math.abs(row - Math.round(row)) * rh;
      // Diagonals through the lattice points: x ∓ (a/2)(y/rh) is a multiple of a.
      const t1 = (rx - (a / 2) * row) / a;
      const t2 = (rx + (a / 2) * row) / a;
      const s = Math.hypot(a / 2, rh) / rh; // diagonal distance scale
      const d1 = (Math.abs(t1 - Math.round(t1)) * a) / s;
      const d2 = (Math.abs(t2 - Math.round(t2)) * a) / s;
      const line = clamp01(half + 0.5 - Math.min(dh, d1, d2)) * (0.55 + 0.35 * d);
      f.ink[y * f.w + x] = line;
    }
  // Dots at the lattice points (odd rows shifted by half a cell).
  for (let r = 0; r < rowsN; r++)
    for (let i = 0; i < n; i++) dot(f, (i + (r % 2) * 0.5) * a, r * rh, (0.06 + 0.06 * d) * f.ppc);
  return f;
}

const GENERATORS: Record<string, (p: ProceduralParams) => Field> = {
  clouds,
  stars,
  smoke,
  waves,
  geometric,
};

export const PROCEDURAL_NAMES = Object.keys(GENERATORS);

export function isProcedural(name: string): boolean {
  return Object.hasOwn(GENERATORS, name);
}

/** The tile of a procedural background, or null for an unknown name. */
export function proceduralTile(name: string, p: ProceduralParams): Tile | null {
  const g = GENERATORS[name];
  if (!g) return null;
  const f = g(p);
  return inkTile(f.w, f.h, f.ink, p.ink);
}
