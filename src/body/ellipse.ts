// Elliptical cross-sections: sizing from a circumference and placing points by arc length,
// so that a fraction of the perimeter is the same fraction of skin all the way around.

/** Ramanujan's second approximation of an ellipse perimeter (error < 1e-9 relative for our aspect ratios). */
export function ellipsePerimeter(a: number, b: number): number {
  const h = ((a - b) / (a + b)) ** 2;
  return Math.PI * (a + b) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
}

/** Semi-axes for a given circumference and aspect ratio k = a / b (a across the arm, b front to back). */
export function semiAxes(circumference: number, k: number): { a: number; b: number } {
  const b = circumference / ellipsePerimeter(k, 1);
  return { a: k * b, b };
}

/**
 * Builds a lookup from perimeter fraction f (0…1, counted from parameter angle `start`,
 * increasing angle) to the parametric angle of that point.
 */
export function arcLengthInverse(a: number, b: number, start: number, samples = 720): (f: number) => number {
  const cum = new Float64Array(samples + 1);
  let prevX = a * Math.cos(start);
  let prevZ = b * Math.sin(start);
  for (let i = 1; i <= samples; i++) {
    const phi = start + (2 * Math.PI * i) / samples;
    const x = a * Math.cos(phi);
    const z = b * Math.sin(phi);
    cum[i] = cum[i - 1]! + Math.hypot(x - prevX, z - prevZ);
    prevX = x;
    prevZ = z;
  }
  const total = cum[samples]!;
  return (f: number) => {
    const target = Math.min(Math.max(f, 0), 1) * total;
    let lo = 0;
    let hi = samples;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cum[mid]! < target) lo = mid;
      else hi = mid;
    }
    const span = cum[hi]! - cum[lo]!;
    const t = span > 0 ? (target - cum[lo]!) / span : 0;
    return start + (2 * Math.PI * (lo + t)) / samples;
  };
}
