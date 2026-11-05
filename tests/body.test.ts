import { describe, expect, it } from "vitest";
import { arcLengthInverse, ellipsePerimeter, semiAxes } from "../src/body/ellipse.ts";
import { buildArmMesh } from "../src/body/geometry.ts";
import { PLACEHOLDERS, resolveInputs } from "../src/body/inputs.ts";
import { monotoneCubic } from "../src/body/interpolate.ts";
import { buildProfile } from "../src/body/profile.ts";
import { layoutToTexture, uToCm } from "../src/body/uv.ts";

const profile = buildProfile(PLACEHOLDERS);

describe("monotoneCubic", () => {
  it("passes through the knots and never overshoots between them", () => {
    const f = monotoneCubic([
      { x: 0, y: 17 },
      { x: 10, y: 26 },
      { x: 20, y: 29 },
      { x: 27, y: 27 },
    ]);
    expect(f(0)).toBeCloseTo(17);
    expect(f(20)).toBeCloseTo(29);
    for (let x = 0; x <= 27; x += 0.25) expect(f(x)).toBeLessThanOrEqual(29 + 1e-9);
    for (let x = 0; x <= 10; x += 0.25) expect(f(x + 0.25)).toBeGreaterThanOrEqual(f(x) - 1e-9);
  });

  it("clamps outside the knots", () => {
    const f = monotoneCubic([
      { x: 1, y: 2 },
      { x: 3, y: 4 },
    ]);
    expect(f(-5)).toBe(2);
    expect(f(10)).toBe(4);
  });
});

describe("ellipse", () => {
  it("perimeter of a circle is 2πr", () => {
    expect(ellipsePerimeter(5, 5)).toBeCloseTo(2 * Math.PI * 5, 9);
  });

  it("semi-axes reproduce the circumference and aspect ratio", () => {
    const { a, b } = semiAxes(17, 1.4);
    expect(a / b).toBeCloseTo(1.4);
    expect(ellipsePerimeter(a, b)).toBeCloseTo(17, 9);
  });

  it("places quarter fractions on the axes", () => {
    const at = arcLengthInverse(4, 2.5, -Math.PI / 2);
    expect(at(0)).toBeCloseTo(-Math.PI / 2, 3);
    expect(at(0.25)).toBeCloseTo(0, 3);
    expect(at(0.5)).toBeCloseTo(Math.PI / 2, 3);
  });
});

describe("profile", () => {
  it("hits every measured circumference at its station", () => {
    expect(profile.length).toBe(60);
    for (const st of profile.stations) expect(profile.circumferenceAt(st.s)).toBeCloseTo(st.circumference, 6);
    expect(profile.maxCircumference).toBeCloseTo(38, 1);
    expect(profile.warnings).toEqual([]);
  });

  it("reports overlapping positions instead of folding the arm", () => {
    const p = buildProfile({ ...PLACEHOLDERS, armpit_level_below_shoulder: 20 }); // above biceps_mid
    expect(p.warnings.length).toBeGreaterThan(0);
    const s = p.stations.map((st) => st.s);
    expect([...s].sort((x, y) => x - y)).toEqual(s);
  });

  it("flags placeholders for unmeasured values only", () => {
    const values = Object.fromEntries(Object.keys(PLACEHOLDERS).map((k) => [k, null])) as never;
    const r = resolveInputs({ ...(values as object), wrist: 16.5 } as never);
    expect(r.inputs.wrist).toBe(16.5);
    expect(r.placeholders).not.toContain("wrist");
    expect(r.placeholders).toHaveLength(Object.keys(PLACEHOLDERS).length - 1);
  });
});

describe("unwrap coordinates", () => {
  it("measures u as a fraction of the local circumference from the outer line", () => {
    const c = profile.circumferenceAt(0);
    expect(uToCm(profile, 0, 0)).toBeCloseTo(0);
    expect(uToCm(profile, 0.25, 0)).toBeCloseTo(c / 4);
    expect(uToCm(profile, 0.75, 0)).toBeCloseTo(-c / 4);
    expect(uToCm(profile, -0.25, 0)).toBeCloseTo(-c / 4);
  });

  it("puts the outer line in the texture centre and the shoulder at the top", () => {
    expect(layoutToTexture(profile, 0, 0.3).x).toBeCloseTo(0.5);
    expect(layoutToTexture(profile, 0, 1).y).toBe(1);
  });
});

describe("arm mesh", () => {
  const mesh = buildArmMesh(profile, { ringSpacingCm: 1, segments: 64 });
  const P = mesh.positions;
  const vertex = (i: number) => [P[3 * i]!, P[3 * i + 1]!, P[3 * i + 2]!] as const;

  it("matches the circumference at every ring and keeps the length", () => {
    const stride = 65;
    const rings = mesh.skinIndices.length / (6 * 64) + 1;
    for (let r = 0; r < rings; r += 5) {
      let perimeter = 0;
      for (let j = 0; j < 64; j++) {
        const [x0, , z0] = vertex(r * stride + j);
        const [x1, , z1] = vertex(r * stride + j + 1);
        perimeter += Math.hypot(x1 - x0, z1 - z0);
      }
      const s = vertex(r * stride)[1];
      expect(perimeter).toBeCloseTo(profile.circumferenceAt(s), 0);
    }
    expect(vertex((rings - 1) * stride)[1]).toBeCloseTo(60);
  });

  it("spaces vertices evenly around the ring, so 1 cm of texture is 1 cm of skin", () => {
    const steps: number[] = [];
    for (let j = 0; j < 64; j++) {
      const [x0, , z0] = vertex(j);
      const [x1, , z1] = vertex(j + 1);
      steps.push(Math.hypot(x1 - x0, z1 - z0));
    }
    const mean = steps.reduce((a, b) => a + b) / steps.length;
    for (const st of steps) expect(Math.abs(st - mean) / mean).toBeLessThan(0.02);
  });

  it("orients the sides as in the palm-forward pose", () => {
    // Column 0 = inner (+Z), 16 = medial (-X), 32 = outer (-Z), 48 = lateral (+X).
    const ring = 10 * 65;
    expect(vertex(ring)[2]).toBeGreaterThan(0);
    expect(vertex(ring + 16)[0]).toBeLessThan(0);
    expect(vertex(ring + 32)[2]).toBeLessThan(0);
    expect(vertex(ring + 48)[0]).toBeGreaterThan(0);
  });

  it("maps the seam to the texture edges and the outer line to the centre", () => {
    const uv = (i: number) => [mesh.uvs[2 * i]!, mesh.uvs[2 * i + 1]!] as const;
    const ring = 10 * 65;
    expect(uv(ring + 32)[0]).toBeCloseTo(0.5);
    expect(uv(ring)[0]).toBeGreaterThan(uv(ring + 64)[0]);
    // Lateral (column 48) lies left of the centre, as seen from outside.
    expect(uv(ring + 48)[0]).toBeLessThan(0.5);
    expect(layoutToTexture(profile, 0.25, 10 / 60).x).toBeLessThan(0.5);
    expect(uv(ring)[0] + uv(ring + 64)[0]).toBeCloseTo(1);
  });

  it("winds every triangle outwards", () => {
    const check = (indices: Uint32Array) => {
      let bad = 0;
      for (let t = 0; t < indices.length; t += 3) {
        const [a, b, c] = [vertex(indices[t]!), vertex(indices[t + 1]!), vertex(indices[t + 2]!)];
        const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        const n = [
          e1[1]! * e2[2]! - e1[2]! * e2[1]!,
          e1[2]! * e2[0]! - e1[0]! * e2[2]!,
          e1[0]! * e2[1]! - e1[1]! * e2[0]!,
        ];
        const cy = (a[1] + b[1] + c[1]) / 3;
        const centre = [0, Math.min(Math.max(cy, 1), 59), 0];
        const out = [
          (a[0] + b[0] + c[0]) / 3 - centre[0]!,
          cy - centre[1]!,
          (a[2] + b[2] + c[2]) / 3 - centre[2]!,
        ];
        const dot = n[0]! * out[0]! + n[1]! * out[1]! + n[2]! * out[2]!;
        const area = Math.hypot(n[0]!, n[1]!, n[2]!);
        if (area > 1e-9 && dot <= 0) bad++;
      }
      return bad;
    };
    expect(check(mesh.skinIndices)).toBe(0);
    expect(check(mesh.capIndices)).toBe(0);
  });

  it("points normals outwards", () => {
    for (let i = 0; i < P.length / 3; i += 37) {
      const [x, , z] = vertex(i);
      const n = [mesh.normals[3 * i]!, mesh.normals[3 * i + 1]!, mesh.normals[3 * i + 2]!];
      if (Math.hypot(x, z) > 1e-6) expect(n[0]! * x + n[2]! * z).toBeGreaterThanOrEqual(-1e-9);
    }
  });
});
