// Elbow flexion (PROJECT_BRIEF.md §10.1 F2 "elbow-bent view", §14 Phase 6). Pure geometry on the
// typed arrays of src/body/geometry.ts: vertices move, UVs and triangles stay, so the same texture
// (and the same unwrap) bends with the arm. Model and limits: docs/adr/0005-elbow-bend.md.
//
// The upper arm stays put; the forearm swings towards the palm side (+Z) about an axis parallel to X
// (lateral–medial). The bend is spread over a zone around the elbow tip: a neutral line runs through
// the zone close to the outer (back) skin, curving with a raised-cosine curvature, and every vertex
// keeps its distance from that line, measured along the line's normal. Skin on the outer side stretches
// a little (by angle × its distance from the neutral line), skin on the inner side is pulled into a
// crease and never folds through itself.
import { semiAxes } from "./ellipse.ts";
import type { ArmMesh } from "./geometry.ts";
import type { ArmProfile, RegionKind } from "./profile.ts";

/**
 * Whether a region's geometry can bend: only the arms have an elbow model (docs/adr/0005). Legs and
 * the torso stay straight, so the pose control is offered for arms only.
 */
export function supportsBend(kind: RegionKind): boolean {
  return kind === "arm";
}

/** The flexion a region actually shows: the shared pose on arms, 0 everywhere else. */
export function regionBendDeg(kind: RegionKind, bendDeg: number): number {
  return supportsBend(kind) ? Math.max(0, bendDeg) : 0;
}

/** Largest flexion offered in the UI (a fully bent elbow is about 140–150°). */
export const MAX_FLEXION_DEG = 120;

export type BendOptions = {
  /** Half the length of the bending zone, centred on the elbow tip, cm. */
  zoneHalfCm?: number;
  /** Position of the neutral line as a fraction of the elbow's depth, from the outer skin (0) to the inner (1). */
  neutralDepth?: number;
};

export const BEND_DEFAULTS: Required<BendOptions> = { zoneHalfCm: 6, neutralDepth: 0.2 };

export type Vec3 = [number, number, number];

export type ElbowBend = {
  /** Flexion in radians. */
  angle: number;
  /** Rotation of the arm's cross-section at s (0 above the zone, `angle` below it). */
  phi(s: number): number;
  /** Curvature of the neutral line at s (1/cm). */
  kappa(s: number): number;
  /** Where a point of the straight arm ends up. */
  point(x: number, y: number, z: number): Vec3;
  /** The normal at a point of the straight arm at height y, turned with the arm. */
  normal(nx: number, ny: number, nz: number, y: number): Vec3;
};

/** Smooth limit for the crease: identity for small x, never reaching 1 (so the skin never folds over). */
function crease(x: number): number {
  return x / Math.pow(1 + x ** 4, 0.25);
}

export function elbowBend(profile: ArmProfile, angleDeg: number, opts: BendOptions = {}): ElbowBend {
  const { zoneHalfCm: h, neutralDepth } = { ...BEND_DEFAULTS, ...opts };
  const angle = (Math.max(0, angleDeg) * Math.PI) / 180;
  const e = profile.elbowAt;
  const top = e + h;
  const bottom = e - h;
  const { b } = semiAxes(profile.circumferenceAt(e), profile.aspectAt(e));
  // Neutral line: z of the straight arm, measured from the outer skin (-b) towards the inner (+b).
  const zn = -b + neutralDepth * 2 * b;

  const tOf = (s: number) => Math.min(1, Math.max(-1, (s - e) / h));
  // Raised cosine: the bend starts and ends gently; its integral over the zone is `angle`.
  const kappa = (s: number) =>
    Math.abs(s - e) < h ? (angle * (1 + Math.cos(Math.PI * tOf(s)))) / (2 * h) : 0;
  const phi = (s: number) => {
    if (s >= top) return 0;
    if (s <= bottom) return angle;
    const t = tOf(s);
    return angle * ((1 - t) / 2 - Math.sin(Math.PI * t) / (2 * Math.PI));
  };

  // The neutral line through the zone, integrated from the top (fixed upper arm) downwards.
  // Directions in the (y, z) plane: along the arm towards the shoulder T(φ) = (cos φ, −sin φ),
  // towards the inner side M(φ) = (sin φ, cos φ). Straight arm: T = (1, 0), M = (0, 1).
  const steps = 600;
  const ny = new Float64Array(steps + 1);
  const nz = new Float64Array(steps + 1);
  const ds = (top - bottom) / steps;
  ny[steps] = top;
  nz[steps] = zn;
  for (let k = steps - 1; k >= 0; k--) {
    const s0 = bottom + (k + 1) * ds;
    const s1 = bottom + k * ds;
    const p0 = phi(s0);
    const p1 = phi(s1);
    const pm = phi((s0 + s1) / 2);
    // Simpson's rule on the step.
    ny[k] = ny[k + 1]! - (ds * (Math.cos(p0) + 4 * Math.cos(pm) + Math.cos(p1))) / 6;
    nz[k] = nz[k + 1]! + (ds * (Math.sin(p0) + 4 * Math.sin(pm) + Math.sin(p1))) / 6;
  }
  const neutral = (s: number): [number, number] => {
    if (s >= top) return [s, zn];
    if (s <= bottom) {
      // Straight on below the zone, in the forearm's direction.
      const d = bottom - s;
      return [ny[0]! - d * Math.cos(angle), nz[0]! + d * Math.sin(angle)];
    }
    const f = (s - bottom) / ds;
    const k = Math.min(steps - 1, Math.floor(f));
    const t = f - k;
    return [ny[k]! + (ny[k + 1]! - ny[k]!) * t, nz[k]! + (nz[k + 1]! - nz[k]!) * t];
  };

  return {
    angle,
    phi,
    kappa,
    point(x, y, z) {
      if (angle === 0 || y >= top) return [x, y, z];
      const p = phi(y);
      const k = kappa(y);
      let d = z - zn;
      // Inner side inside the zone: pulled into the crease instead of folding through itself.
      if (d > 0 && k > 0) d = crease(d * k) / k;
      const [cy, cz] = neutral(y);
      return [x, cy + d * Math.sin(p), cz + d * Math.cos(p)];
    },
    normal(nx, nyv, nzv, y) {
      const p = phi(y);
      const c = Math.cos(p);
      const s = Math.sin(p);
      return [nx, nyv * c + nzv * s, -nyv * s + nzv * c];
    },
  };
}

/** The arm mesh bent at the elbow; UVs and triangles are shared with the straight mesh. */
export function bendArmMesh(
  mesh: ArmMesh,
  profile: ArmProfile,
  angleDeg: number,
  opts?: BendOptions,
): ArmMesh {
  if (angleDeg <= 0) return mesh;
  const bend = elbowBend(profile, angleDeg, opts);
  const n = mesh.positions.length / 3;
  const positions = new Float32Array(mesh.positions.length);
  const normals = new Float32Array(mesh.normals.length);
  for (let i = 0; i < n; i++) {
    const o = i * 3;
    const x = mesh.positions[o]!;
    const y = mesh.positions[o + 1]!;
    const z = mesh.positions[o + 2]!;
    positions.set(bend.point(x, y, z), o);
    const nv = bend.normal(mesh.normals[o]!, mesh.normals[o + 1]!, mesh.normals[o + 2]!, y);
    const len = Math.hypot(nv[0], nv[1], nv[2]) || 1;
    normals.set([nv[0] / len, nv[1] / len, nv[2] / len], o);
  }
  return { ...mesh, positions, normals };
}

/** Axis-aligned bounds of a position array, for framing the camera on a bent arm. */
export function bounds(positions: Float32Array): { min: Vec3; max: Vec3 } {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      const v = positions[i + a]!;
      if (v < min[a]!) min[a] = v;
      if (v > max[a]!) max[a] = v;
    }
  }
  return { min, max };
}
