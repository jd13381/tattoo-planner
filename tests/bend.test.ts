import { describe, expect, it } from "vitest";
import {
  bendArmMesh,
  BEND_DEFAULTS,
  bounds,
  elbowBend,
  regionBendDeg,
  supportsBend,
} from "../src/body/bend.ts";
import { semiAxes } from "../src/body/ellipse.ts";
import { buildArmMesh } from "../src/body/geometry.ts";
import { PLACEHOLDERS } from "../src/body/inputs.ts";
import { buildProfile } from "../src/body/profile.ts";

const profile = buildProfile(PLACEHOLDERS);
const SEGMENTS = 96;
const mesh = buildArmMesh(profile, { segments: SEGMENTS });
const stride = SEGMENTS + 1;
const rings = Math.round(mesh.skinIndices.length / 6 / SEGMENTS) + 1;
const h = BEND_DEFAULTS.zoneHalfCm;
const e = profile.elbowAt;

type P = [number, number, number];
const at = (pos: Float32Array, i: number): P => [pos[i * 3]!, pos[i * 3 + 1]!, pos[i * 3 + 2]!];
const dist = (a: P, b: P) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
/** Skin vertices of one column (0 = inner centre line, SEGMENTS / 2 = outer), wrist to shoulder. */
const column = (pos: Float32Array, j: number) =>
  Array.from({ length: rings }, (_, i) => at(pos, i * stride + j));
const length = (pts: P[]) => pts.slice(1).reduce((sum, p, i) => sum + dist(p, pts[i]!), 0);
const OUTER = SEGMENTS / 2;
const INNER = 0;

/** Whether two segments in the (y, z) plane cross. */
function crosses(a: P, b: P, c: P, d: P): boolean {
  const o = (p: P, q: P, r: P) => (q[1] - p[1]) * (r[2] - p[2]) - (q[2] - p[2]) * (r[1] - p[1]);
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}

describe("elbow bend", () => {
  it("leaves the straight arm unchanged at 0°", () => {
    expect(bendArmMesh(mesh, profile, 0)).toBe(mesh);
    const b = elbowBend(profile, 0);
    expect(b.point(1, 20, -3)).toEqual([1, 20, -3]);
  });

  it("keeps the upper arm in place and moves the forearm rigidly", () => {
    const bent = bendArmMesh(mesh, profile, 90);
    expect(bent.uvs).toBe(mesh.uvs);
    expect(bent.skinIndices).toBe(mesh.skinIndices);
    const n = mesh.positions.length / 3;
    const forearm: number[] = [];
    for (let i = 0; i < n; i++) {
      const y = mesh.positions[i * 3 + 1]!;
      if (y > e + h + 0.01) expect(at(bent.positions, i)).toEqual(at(mesh.positions, i));
      if (y < e - h - 0.01 && i % 37 === 0) forearm.push(i);
    }
    expect(forearm.length).toBeGreaterThan(20);
    for (let k = 1; k < forearm.length; k++) {
      const [i, j] = [forearm[k - 1]!, forearm[k]!];
      expect(dist(at(bent.positions, i), at(bent.positions, j))).toBeCloseTo(
        dist(at(mesh.positions, i), at(mesh.positions, j)),
        3,
      );
    }
  });

  it("turns the forearm towards the palm side by the flexion angle", () => {
    for (const deg of [45, 90, 120]) {
      const b = elbowBend(profile, deg);
      const wrist = b.point(0, 0, 0);
      const below = b.point(0, e - h - 1, 0);
      const dir = [wrist[1] - below[1], wrist[2] - below[2]];
      const angle = (Math.atan2(dir[1]!, -dir[0]!) * 180) / Math.PI;
      expect(angle).toBeCloseTo(deg, 6);
      expect(b.phi(0)).toBeCloseTo((deg * Math.PI) / 180, 9);
      expect(b.phi(profile.length)).toBe(0);
    }
  });

  it("roughly preserves the length of the outer line", () => {
    const straight = length(column(mesh.positions, OUTER));
    const { b } = semiAxes(profile.circumferenceAt(e), profile.aspectAt(e));
    const offset = BEND_DEFAULTS.neutralDepth * 2 * b; // outer skin to neutral line at the elbow
    for (const deg of [45, 90, 120]) {
      const bent = length(column(bendArmMesh(mesh, profile, deg).positions, OUTER));
      // Outer skin stretches by angle × its distance from the neutral line: 1.3 cm at 45°, 3.6 cm at 120°.
      expect(bent - straight).toBeCloseTo(((deg * Math.PI) / 180) * offset, 0);
      expect(bent / straight).toBeLessThan(deg <= 90 ? 1.05 : 1.07);
    }
  });

  it("never folds the outer side through itself at 90°", () => {
    const pts = column(bendArmMesh(mesh, profile, 90).positions, OUTER);
    for (let i = 0; i + 1 < pts.length; i++)
      for (let j = i + 2; j + 1 < pts.length; j++)
        expect(crosses(pts[i]!, pts[i + 1]!, pts[j]!, pts[j + 1]!)).toBe(false);
    // Consecutive steps never turn back on each other.
    for (let i = 0; i + 2 < pts.length; i++) {
      const u = [pts[i + 1]![1] - pts[i]![1], pts[i + 1]![2] - pts[i]![2]];
      const v = [pts[i + 2]![1] - pts[i + 1]![1], pts[i + 2]![2] - pts[i + 1]![2]];
      expect(u[0]! * v[0]! + u[1]! * v[1]!).toBeGreaterThan(0);
    }
  });

  it("compresses the inner crease without turning the skin inside out, even at 120°", () => {
    for (const deg of [90, 120]) {
      const straight = column(mesh.positions, INNER);
      const pts = column(bendArmMesh(mesh, profile, deg).positions, INNER);
      expect(length(pts)).toBeLessThan(length(straight));
      const b = elbowBend(profile, deg);
      for (let i = 0; i + 1 < pts.length; i++) {
        // Each step still runs in the arm's local direction (towards the shoulder).
        const p = b.phi((straight[i]![1] + straight[i + 1]![1]) / 2);
        const step = [pts[i + 1]![1] - pts[i]![1], pts[i + 1]![2] - pts[i]![2]];
        expect(step[0]! * Math.cos(p) - step[1]! * Math.sin(p)).toBeGreaterThan(0);
      }
    }
  });

  it("keeps normals unit length and bounds the bent arm", () => {
    const bent = bendArmMesh(mesh, profile, 90);
    for (let i = 0; i < bent.normals.length; i += 3 * 101)
      expect(Math.hypot(bent.normals[i]!, bent.normals[i + 1]!, bent.normals[i + 2]!)).toBeCloseTo(1, 5);
    const box = bounds(bent.positions);
    const straightBox = bounds(mesh.positions);
    expect(box.max[2]).toBeGreaterThan(e - 5); // the wrist sticks out towards the palm side
    expect(box.min[1]).toBeGreaterThan(straightBox.min[1] + e / 2);
  });
});

describe("supportsBend / regionBendDeg", () => {
  it("offers the elbow pose on arms only", () => {
    expect(supportsBend("arm")).toBe(true);
    expect(supportsBend("leg")).toBe(false);
    expect(supportsBend("torso")).toBe(false);
  });

  it("keeps a bend set on an arm out of the torso and legs", () => {
    expect(regionBendDeg("arm", 90)).toBe(90);
    expect(regionBendDeg("torso", 90)).toBe(0);
    expect(regionBendDeg("leg", 45)).toBe(0);
    expect(regionBendDeg("arm", -10)).toBe(0);
  });
});
