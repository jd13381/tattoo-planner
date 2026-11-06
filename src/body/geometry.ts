// Builds a region's loft mesh as plain typed arrays (no three.js dependency, so it is unit-testable).
// Local axes, in cm: +Y along the region from its start (y = 0) to its end (y = length), and the body's
// directions across it: +Z = front, -Z = back, +X = the body's left, -X = its right (docs/adr/0011). For
// the left arm in the palm-forward pose that is +Z = inner (palm side), -Z = outer, +X = lateral,
// -X = medial (docs/adr/0002). placement.ts puts the region into the body.
import { arcLengthInverse, semiAxes } from "./ellipse.ts";
import type { LoftShape, RegionKind } from "./profile.ts";
import { wrapU } from "./uv.ts";

export type ArmMesh = {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  /** Triangles of the skin surface (textured). */
  skinIndices: Uint32Array;
  /** Triangles of the rounded ends (not part of the unwrap). */
  capIndices: Uint32Array;
};
export type LoftMesh = ArmMesh;

export type MeshOptions = { ringSpacingCm?: number; segments?: number; capRings?: number };

/**
 * Parametric angle (x = a cos φ, z = b sin φ) of the line u = 0: the outer line (-Z) on arms, the front
 * (+Z) on legs, the right flank (-X) on the torso.
 */
export const U0_ANGLE: Record<RegionKind, number> = { arm: -Math.PI / 2, leg: Math.PI / 2, torso: Math.PI };

/** Rounded end depths as a fraction of the smaller semi-axis: start (wrist, ankle, waist) and end. */
const CAP_DEPTH: Record<RegionKind, [number, number]> = {
  arm: [0.35, 0.6],
  leg: [0.35, 0.5],
  torso: [0.3, 0.3],
};

/**
 * Turns a perimeter fraction u into the parametric angle at a cross-section with semi-axes a, b. u grows
 * with the angle unless the region is mirrored; the ellipse is symmetric about the axis through
 * U0_ANGLE, so the mirrored lookup is the reflection of the plain one.
 */
export function ringAngles(profile: LoftShape, a: number, b: number): (u: number) => number {
  const start = U0_ANGLE[profile.kind];
  const at = arcLengthInverse(a, b, start);
  return profile.mirrored ? (u) => 2 * start - at(u) : at;
}

/** Point and outward normal (in the plane of the cross-section) of the skin at (u, s), local frame. */
export function surfacePoint(
  profile: LoftShape,
  u: number,
  s: number,
): { position: [number, number, number]; normal: [number, number, number] } {
  const { a, b } = semiAxes(profile.circumferenceAt(s), profile.aspectAt(s));
  const phi = ringAngles(profile, a, b)(wrapU(u));
  const c = Math.cos(phi);
  const sn = Math.sin(phi);
  const len = Math.hypot(b * c, a * sn) || 1;
  return { position: [a * c, s, b * sn], normal: [(b * c) / len, 0, (a * sn) / len] };
}

export function buildLoftMesh(profile: LoftShape, opts: MeshOptions = {}): LoftMesh {
  const segments = opts.segments ?? 96;
  const ringCount = Math.max(2, Math.ceil(profile.length / (opts.ringSpacingCm ?? 0.5)) + 1);
  const capRings = opts.capRings ?? 6;
  const stride = segments + 1; // the seam column is duplicated so the texture can wrap
  // Texture x grows against u (lateral on the left) unless the region is mirrored.
  const screen = profile.mirrored ? 1 : -1;

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];

  const axesAt = (s: number) => semiAxes(profile.circumferenceAt(s), profile.aspectAt(s));
  const eps = 0.05;

  for (let i = 0; i < ringCount; i++) {
    const s = (profile.length * i) / (ringCount - 1);
    const v = s / profile.length;
    const { a, b } = axesAt(s);
    const lo = axesAt(Math.max(0, s - eps));
    const hi = axesAt(Math.min(profile.length, s + eps));
    const ds = Math.min(profile.length, s + eps) - Math.max(0, s - eps);
    const da = (hi.a - lo.a) / ds;
    const db = (hi.b - lo.b) / ds;
    const angleAt = ringAngles(profile, a, b);
    const halfWidth = profile.circumferenceAt(s) / profile.maxCircumference / 2;
    for (let j = 0; j <= segments; j++) {
      // Columns run from the seam (u = 0.5) round through u = 0 back to the seam; column 0 and the
      // last one are the seam.
      const w = j / segments;
      const phi = angleAt(wrapU(w + 0.5)); // perimeter fraction counted from the u = 0 line
      const c = Math.cos(phi);
      const sn = Math.sin(phi);
      positions.push(a * c, s, b * sn);
      // Outward normal = dP/ds × dP/dphi.
      const nx = b * c;
      const ny = -(da * c * b * c + db * sn * a * sn);
      const nz = a * sn;
      const len = Math.hypot(nx, ny, nz) || 1;
      normals.push(nx / len, ny / len, nz / len);
      // The unwrap reads as seen from outside: on the left arm, looking at the back, lateral is on the left.
      uvs.push(0.5 + screen * (w - 0.5) * 2 * halfWidth, v);
    }
  }

  // Columns turn with the angle unless mirrored; mirrored rings run the other way, so their quads
  // are wound the other way round to keep facing outwards.
  const flip = profile.mirrored;
  const quad = (out: number[], p: number, q: number, outwards: boolean) => {
    if (outwards !== flip) out.push(p, q, p + 1, p + 1, q, q + 1);
    else out.push(q, p, q + 1, q + 1, p, p + 1);
  };

  const skin: number[] = [];
  for (let i = 0; i < ringCount - 1; i++) {
    for (let j = 0; j < segments; j++) {
      const p = i * stride + j;
      quad(skin, p, p + stride, true);
    }
  }

  // Rounded ends: rings shrinking towards a pole, continuing the outermost skin ring.
  const caps: number[] = [];
  const addCap = (ring: number, dir: 1 | -1, depthFactor: number) => {
    const s = ring === 0 ? 0 : profile.length;
    const { a, b } = axesAt(s);
    const depth = depthFactor * Math.min(a, b);
    let prev = ring * stride;
    for (let r = 1; r <= capRings; r++) {
      const t = (r / capRings) * (Math.PI / 2);
      const scale = Math.cos(t);
      const y = s + dir * depth * Math.sin(t);
      const start = positions.length / 3;
      for (let j = 0; j <= segments; j++) {
        const idx = (ring * stride + j) * 3;
        const px = positions[idx]!;
        const pz = positions[idx + 2]!;
        positions.push(px * scale, y, pz * scale);
        const nx = (px / (a * a)) * scale;
        const nz = (pz / (b * b)) * scale;
        const ny = (dir * Math.sin(t)) / Math.max(depth, 1e-6);
        const len = Math.hypot(nx, ny, nz) || 1;
        normals.push(nx / len, ny / len, nz / len);
        uvs.push(0, 0);
      }
      for (let j = 0; j < segments; j++) {
        // Winding mirrors the skin quads: towards the end (dir 1) the cap continues upwards.
        quad(caps, prev + j, start + j, dir === 1);
      }
      prev = start;
    }
  };
  const [startDepth, endDepth] = CAP_DEPTH[profile.kind];
  addCap(0, -1, startDepth);
  addCap(ringCount - 1, 1, endDepth);

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    uvs: new Float32Array(uvs),
    skinIndices: new Uint32Array(skin),
    capIndices: new Uint32Array(caps),
  };
}

/** The arm mesh (docs/adr/0002); the same loft as every region. */
export const buildArmMesh = buildLoftMesh;
