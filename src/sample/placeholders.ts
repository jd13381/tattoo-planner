// Placeholder motifs of the sample project (docs/adr/0012-project-folder.md, "Sample project"): simple
// line drawings computed pixel by pixel from signed distance functions, so the repository holds no
// image file and no third-party art. Pure and deterministic: the same motif and size always give the
// same pixels. The server encodes them as PNG (server/png.ts); framework-free.

/** A point in motif space: 0..1 across, 0..1 down. */
type Vec = readonly [number, number];
/** Signed distance from a point to a shape, in motif units (negative inside). */
type Sdf = (x: number, y: number) => number;

export const MOTIFS = ["compass", "moon", "wave", "fern", "mandala", "mountains", "sun", "swallow"] as const;
export type MotifId = (typeof MOTIFS)[number];

export function isMotif(x: string): x is MotifId {
  return (MOTIFS as readonly string[]).includes(x);
}

/** Default edge length of a rendered placeholder, in pixels. */
export const PLACEHOLDER_SIZE = 512;

const INK: readonly [number, number, number] = [28, 26, 32];
const ACCENT: readonly [number, number, number] = [178, 58, 46];

// --- Signed distance primitives ---

/** Length of (x, y); Math.hypot is several times slower and this runs for every pixel. */
function len(x: number, y: number): number {
  return Math.sqrt(x * x + y * y);
}

const disc =
  (c: Vec, r: number): Sdf =>
  (x, y) =>
    len(x - c[0], y - c[1]) - r;

const ring =
  (c: Vec, r: number, w: number): Sdf =>
  (x, y) =>
    Math.abs(len(x - c[0], y - c[1]) - r) - w / 2;

function segDist(x: number, y: number, a: Vec, b: Vec): number {
  const [ax, ay] = a;
  const dx = b[0] - ax;
  const dy = b[1] - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2));
  return len(x - (ax + t * dx), y - (ay + t * dy));
}

/** Beyond this distance from a shape's bounding box, the box distance stands in for the exact one. */
const FAR = 0.02;

/**
 * Wraps an exact but costly distance with a cheap lower bound far from the shape: the distance to its
 * bounding box (grown by `pad`). Coverage only needs exact values within a pixel of an edge.
 */
function bounded(points: readonly Vec[], pad: number, exact: Sdf): Sdf {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const x0 = Math.min(...xs) - pad;
  const x1 = Math.max(...xs) + pad;
  const y0 = Math.min(...ys) - pad;
  const y1 = Math.max(...ys) + pad;
  return (x, y) => {
    const box = len(Math.max(x0 - x, 0, x - x1), Math.max(y0 - y, 0, y - y1));
    return box > FAR ? box : exact(x, y);
  };
}

/** A stroke along a polyline with round caps. */
const stroke = (points: readonly Vec[], w: number): Sdf =>
  bounded(points, w / 2, (x, y) => {
    let d = Infinity;
    for (let i = 1; i < points.length; i++) d = Math.min(d, segDist(x, y, points[i - 1]!, points[i]!));
    return d - w / 2;
  });

/** A filled polygon (even-odd rule), exact distance to its edges. */
const polygon = (points: readonly Vec[]): Sdf =>
  bounded(points, 0, (x, y) => {
    let d = Infinity;
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const a = points[j]!;
      const b = points[i]!;
      d = Math.min(d, segDist(x, y, a, b));
      if (a[1] > y !== b[1] > y && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
    return inside ? -d : d;
  });

/** The outline of a shape as a stroke of width w. */
const outline =
  (shape: Sdf, w: number): Sdf =>
  (x, y) =>
    Math.abs(shape(x, y)) - w / 2;

const union =
  (...shapes: Sdf[]): Sdf =>
  (x, y) => {
    let d = Infinity;
    for (const s of shapes) d = Math.min(d, s(x, y));
    return d;
  };

const subtract =
  (a: Sdf, b: Sdf): Sdf =>
  (x, y) =>
    Math.max(a(x, y), -b(x, y));

/** Points on a circle, starting at the top and going clockwise. */
function around(c: Vec, r: number, n: number, offset = 0): Vec[] {
  return Array.from({ length: n }, (_, i) => {
    const a = ((i + offset) / n) * Math.PI * 2 - Math.PI / 2;
    return [c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)] as Vec;
  });
}

/** A star polygon with n points between radii outer and inner. */
function star(c: Vec, n: number, outer: number, inner: number): Vec[] {
  const outerPts = around(c, outer, n);
  const innerPts = around(c, inner, n, 0.5);
  return outerPts.flatMap((p, i) => [p, innerPts[i]!]);
}

// --- Motifs: an ink layer drawn over an accent layer ---

type Motif = { ink: Sdf; accent?: Sdf };

const C: Vec = [0.5, 0.5];
const LINE = 0.014;

function compass(): Motif {
  const big = polygon(star(C, 4, 0.42, 0.08));
  const small = polygon(
    star(C, 4, 0.27, 0.06).map(([x, y]) => {
      // The small star turned by 45 degrees.
      const a = Math.PI / 4;
      const dx = x - 0.5;
      const dy = y - 0.5;
      return [0.5 + dx * Math.cos(a) - dy * Math.sin(a), 0.5 + dx * Math.sin(a) + dy * Math.cos(a)] as Vec;
    }),
  );
  return {
    ink: union(outline(big, LINE), outline(small, LINE), ring(C, 0.33, LINE), ring(C, 0.36, LINE / 2)),
    accent: polygon(star(C, 4, 0.42, 0.08).slice(0, 3).concat([C])),
  };
}

function moon(): Motif {
  const crescent = subtract(disc([0.5, 0.5], 0.36), disc([0.63, 0.43], 0.3));
  const stars = around([0.5, 0.5], 0.43, 5, 0.3)
    .slice(0, 3)
    .map((p) => polygon(star(p, 4, 0.04, 0.01)));
  return { ink: union(outline(crescent, LINE), ...stars), accent: crescent };
}

function wave(): Motif {
  const lines: Sdf[] = [];
  for (let k = 0; k < 5; k++) {
    const pts: Vec[] = [];
    for (let i = 0; i <= 48; i++) {
      const x = 0.1 + (0.8 * i) / 48;
      pts.push([x, 0.3 + k * 0.1 + 0.04 * Math.sin((x * 3 + k * 0.25) * Math.PI * 2)]);
    }
    lines.push(stroke(pts, k === 2 ? LINE * 1.6 : LINE));
  }
  const frame = outline(
    polygon([
      [0.07, 0.2],
      [0.93, 0.2],
      [0.93, 0.8],
      [0.07, 0.8],
    ]),
    LINE,
  );
  return { ink: union(frame, ...lines) };
}

function fern(): Motif {
  const stem: Vec[] = [];
  for (let i = 0; i <= 32; i++) {
    const t = i / 32;
    stem.push([0.5 + 0.06 * Math.sin(t * Math.PI), 0.92 - 0.84 * t]);
  }
  const leaves: Sdf[] = [];
  for (let i = 2; i < 30; i += 3) {
    const [sx, sy] = stem[i]!;
    const len = 0.06 + 0.22 * Math.sin((i / 32) * Math.PI) * (1 - i / 40);
    for (const side of [-1, 1]) {
      const tip: Vec = [sx + side * len, sy - len * 0.45];
      const mid: Vec = [sx + side * len * 0.5, sy - len * 0.32];
      leaves.push(
        outline(polygon([[sx, sy], [mid[0], mid[1] - 0.025], tip, [mid[0], mid[1] + 0.02]]), LINE * 0.8),
      );
    }
  }
  return { ink: union(stroke(stem, LINE * 1.4), ...leaves) };
}

function mandala(): Motif {
  const petals = around(C, 0.27, 12).map((p) => outline(disc(p, 0.075), LINE * 0.8));
  const dots = around(C, 0.41, 24).map((p) => disc(p, 0.012));
  return {
    ink: union(ring(C, 0.1, LINE), ring(C, 0.19, LINE), ring(C, 0.36, LINE), ...petals, ...dots),
    accent: disc(C, 0.06),
  };
}

function mountains(): Motif {
  const frame = ring(C, 0.4, LINE);
  const inCircle = disc(C, 0.4);
  const peaks = polygon([
    [0.05, 0.75],
    [0.32, 0.38],
    [0.45, 0.55],
    [0.6, 0.3],
    [0.95, 0.75],
  ]);
  const snow = polygon([
    [0.6, 0.3],
    [0.68, 0.41],
    [0.62, 0.38],
    [0.57, 0.42],
    [0.53, 0.4],
  ]);
  return {
    ink: union(frame, (x, y) => Math.max(outline(peaks, LINE)(x, y), inCircle(x, y)), outline(snow, LINE)),
    accent: disc([0.33, 0.27], 0.06),
  };
}

function sun(): Motif {
  const rays = around(C, 0, 16).map((_, i) => {
    const a = (i / 16) * Math.PI * 2;
    const r0 = 0.24;
    const r1 = i % 2 === 0 ? 0.44 : 0.36;
    return stroke(
      [
        [0.5 + r0 * Math.cos(a), 0.5 + r0 * Math.sin(a)],
        [0.5 + r1 * Math.cos(a), 0.5 + r1 * Math.sin(a)],
      ],
      LINE,
    );
  });
  return { ink: union(ring(C, 0.19, LINE * 1.4), ring(C, 0.12, LINE / 2), ...rays), accent: disc(C, 0.19) };
}

function swallow(): Motif {
  // A simple bird silhouette: body, two swept wings and a forked tail.
  const body = polygon([
    [0.5, 0.3],
    [0.56, 0.4],
    [0.55, 0.62],
    [0.5, 0.7],
    [0.45, 0.62],
    [0.44, 0.4],
  ]);
  const wingL = polygon([
    [0.45, 0.45],
    [0.08, 0.3],
    [0.2, 0.42],
    [0.45, 0.55],
  ]);
  const wingR = polygon([
    [0.55, 0.45],
    [0.92, 0.3],
    [0.8, 0.42],
    [0.55, 0.55],
  ]);
  const tail = polygon([
    [0.47, 0.66],
    [0.38, 0.9],
    [0.5, 0.75],
    [0.62, 0.9],
    [0.53, 0.66],
  ]);
  const bird = union(body, wingL, wingR, tail);
  return { ink: outline(bird, LINE), accent: disc([0.5, 0.36], 0.03) };
}

const BUILDERS: Record<MotifId, () => Motif> = {
  compass,
  moon,
  wave,
  fern,
  mandala,
  mountains,
  sun,
  swallow,
};

/**
 * Renders a motif as RGBA pixels (row-major, `size × size`), transparent background, dark ink over a
 * muted red accent. Edges are anti-aliased from the distance field (one sample per pixel).
 */
export function renderMotif(id: MotifId, size = PLACEHOLDER_SIZE): Uint8Array {
  const motif = BUILDERS[id]();
  const px = new Uint8Array(size * size * 4);
  const half = 0.5 / size;
  const coverage = (d: number) => Math.max(0, Math.min(1, 0.5 - d * size));
  for (let py = 0; py < size; py++) {
    const y = py / size + half;
    for (let pxi = 0; pxi < size; pxi++) {
      const x = pxi / size + half;
      const ink = coverage(motif.ink(x, y));
      const accent = motif.accent ? coverage(motif.accent(x, y)) * 0.85 : 0;
      // Ink over accent ("source over"), premultiplied, then back to straight alpha.
      const a = ink + accent * (1 - ink);
      if (a <= 0) continue;
      const i = (py * size + pxi) * 4;
      for (let k = 0; k < 3; k++)
        px[i + k] = Math.round((INK[k]! * ink + ACCENT[k]! * accent * (1 - ink)) / a);
      px[i + 3] = Math.round(a * 255);
    }
  }
  return px;
}

/** The motif a sample manifest file stands for: its base name (`images/compass.png` → compass). */
export function motifForFile(file: string): MotifId | null {
  const base = file.split("/").pop() ?? "";
  const m = /^([a-z0-9-]+)\.png$/.exec(base);
  return m && isMotif(m[1]!) ? m[1] : null;
}
