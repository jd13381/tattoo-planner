// Smooth, monotone interpolation of measured values along a region (docs/adr/0022).
//
// A cubic spline (C2: no step in slope or curvature at a station) whose slopes are then limited by
// Hyman's monotonicity filter: at a station that is a local maximum or minimum the slope is 0, and no
// slope exceeds three times the neighbouring secants; every limited slope is then held and the spline
// solved again for the others. The result passes through every station, never overshoots between two
// of them (the arm cannot bulge where nobody measured a bulge) and is C1 everywhere; it stays C2 at
// every station whose slope the filter leaves alone. The ends take the slope of their first stretch,
// as the Fritsch–Carlson interpolation used before did, so the shape near a region's ends stays.

export type Knot = { x: number; y: number };

export type CubicOptions = {
  /** Slope at the first knot instead of the first stretch's. */
  startSlope?: number;
  /** Slope at the last knot instead of the last stretch's. */
  endSlope?: number;
};

/** Spline slopes at the knots: C2 at every inner knot whose slope is not fixed; both ends are fixed. */
function splineSlopes(h: number[], delta: number[], fixed: (number | undefined)[]): number[] {
  const n = h.length + 1;
  // Tridiagonal system lower[i] m[i-1] + diag[i] m[i] + upper[i] m[i+1] = rhs[i] (Thomas algorithm).
  const lower = new Array<number>(n).fill(0);
  const diag = new Array<number>(n).fill(0);
  const upper = new Array<number>(n).fill(0);
  const rhs = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    if (fixed[i] !== undefined) {
      diag[i] = 1;
      rhs[i] = fixed[i]!;
    } else {
      lower[i] = h[i]!;
      diag[i] = 2 * (h[i - 1]! + h[i]!);
      upper[i] = h[i - 1]!;
      rhs[i] = 3 * (h[i]! * delta[i - 1]! + h[i - 1]! * delta[i]!);
    }
  }
  for (let i = 1; i < n; i++) {
    const w = lower[i]! / diag[i - 1]!;
    diag[i] = diag[i]! - w * upper[i - 1]!;
    rhs[i] = rhs[i]! - w * rhs[i - 1]!;
  }
  const m = new Array<number>(n);
  m[n - 1] = rhs[n - 1]! / diag[n - 1]!;
  for (let i = n - 2; i >= 0; i--) m[i] = (rhs[i]! - upper[i]! * m[i + 1]!) / diag[i]!;
  return m;
}

/** Hyman's filter: limits a slope so that the cubic on both sides stays monotone. */
function limit(m: number, left: number | undefined, right: number | undefined): number {
  const secants = [left, right].filter((d): d is number => d !== undefined);
  // A station between a rise and a fall (or next to a flat stretch) is an extremum: flat there.
  if (secants.some((d) => d === 0) || (secants.length === 2 && secants[0]! * secants[1]! < 0)) return 0;
  const sign = Math.sign(secants[0]!);
  const bound = 3 * Math.min(...secants.map(Math.abs));
  return sign * Math.min(Math.max(sign * m, 0), bound);
}

export function monotoneCubic(knots: Knot[], opts: CubicOptions = {}): (x: number) => number {
  const pts = [...knots].sort((p, q) => p.x - q.x);
  const n = pts.length;
  if (n === 0) throw new Error("monotoneCubic needs at least one knot");
  if (n === 1) {
    const y = pts[0]!.y;
    return () => y;
  }
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const h: number[] = [];
  const delta: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    h.push(xs[i + 1]! - xs[i]!);
    delta.push((ys[i + 1]! - ys[i]!) / h[i]!);
  }
  // Solve the spline, fix every slope the filter had to limit at its limited value and solve again,
  // until no slope needs limiting: every other knot then stays C2 with its neighbours. The fixed set
  // only grows, so this ends after at most n rounds.
  const fixed: (number | undefined)[] = new Array<number | undefined>(n).fill(undefined);
  fixed[0] = limit(opts.startSlope ?? delta[0]!, undefined, delta[0]);
  fixed[n - 1] = limit(opts.endSlope ?? delta[n - 2]!, delta[n - 2], undefined);
  let m = splineSlopes(h, delta, fixed);
  for (let round = 0; round < n; round++) {
    let changed = false;
    for (let i = 0; i < n; i++) {
      const limited = limit(m[i]!, delta[i - 1], delta[i]);
      if (fixed[i] === undefined && Math.abs(limited - m[i]!) > 1e-12) {
        fixed[i] = limited;
        changed = true;
      }
    }
    if (!changed) break;
    m = splineSlopes(h, delta, fixed);
  }
  m = m.map((s, i) => limit(s, delta[i - 1], delta[i]));

  return (x: number) => {
    if (x <= xs[0]!) return ys[0]!;
    if (x >= xs[n - 1]!) return ys[n - 1]!;
    let i = 0;
    while (x > xs[i + 1]!) i++;
    const hi = h[i]!;
    const t = (x - xs[i]!) / hi;
    const t2 = t * t;
    const t3 = t2 * t;
    return (
      (2 * t3 - 3 * t2 + 1) * ys[i]! +
      (t3 - 2 * t2 + t) * hi * m[i]! +
      (-2 * t3 + 3 * t2) * ys[i + 1]! +
      (t3 - t2) * hi * m[i + 1]!
    );
  };
}
