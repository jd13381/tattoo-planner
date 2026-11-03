// Monotone cubic interpolation (Fritsch–Carlson): smooth like a spline, but never overshoots
// between two measured circumferences, so the arm cannot bulge where nobody measured a bulge.

export type Knot = { x: number; y: number };

export function monotoneCubic(knots: Knot[]): (x: number) => number {
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
  const m: number[] = new Array<number>(n);
  m[0] = delta[0]!;
  m[n - 1] = delta[n - 2]!;
  for (let i = 1; i < n - 1; i++) {
    m[i] = delta[i - 1]! * delta[i]! <= 0 ? 0 : (delta[i - 1]! + delta[i]!) / 2;
  }
  for (let i = 0; i < n - 1; i++) {
    const d = delta[i]!;
    if (d === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i]! / d;
    const b = m[i + 1]! / d;
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * d;
      m[i + 1] = t * b * d;
    }
  }
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
