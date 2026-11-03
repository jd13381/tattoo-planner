// Builds the arm mesh as plain typed arrays (no three.js dependency, so it is unit-testable).
// Axes, in cm: +Y from wrist (y = 0) to shoulder point (y = length); palm-forward pose seen from the front:
// +Z = inner (palm side, faces the viewer in the front view), -Z = outer (back), +X = lateral, -X = medial.
import { arcLengthInverse, semiAxes } from "./ellipse.ts";
import type { ArmProfile } from "./profile.ts";
import { wrapU } from "./uv.ts";

export type ArmMesh = {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  /** Triangles of the skin surface (textured). */
  skinIndices: Uint32Array;
  /** Triangles of the rounded wrist and shoulder ends (not part of the unwrap). */
  capIndices: Uint32Array;
};

export type MeshOptions = { ringSpacingCm?: number; segments?: number; capRings?: number };

/** Parametric angle of the outer centre line (-Z). */
const OUTER_ANGLE = -Math.PI / 2;

export function buildArmMesh(profile: ArmProfile, opts: MeshOptions = {}): ArmMesh {
  const segments = opts.segments ?? 96;
  const ringCount = Math.max(2, Math.ceil(profile.length / (opts.ringSpacingCm ?? 0.5)) + 1);
  const capRings = opts.capRings ?? 6;
  const stride = segments + 1; // the seam column is duplicated so the texture can wrap

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
    const angleAt = arcLengthInverse(a, b, OUTER_ANGLE);
    const halfWidth = profile.circumferenceAt(s) / profile.maxCircumference / 2;
    for (let j = 0; j <= segments; j++) {
      // Columns run inner → medial → outer → lateral → inner; column 0 and the last one are the seam.
      const w = j / segments;
      const phi = angleAt(wrapU(w + 0.5)); // perimeter fraction counted from the outer line
      const c = Math.cos(phi);
      const sn = Math.sin(phi);
      positions.push(a * c, s, b * sn);
      // Outward normal = dP/ds × dP/dphi.
      const nx = b * c;
      const ny = -(da * c * b * c + db * sn * a * sn);
      const nz = a * sn;
      const len = Math.hypot(nx, ny, nz) || 1;
      normals.push(nx / len, ny / len, nz / len);
      // Mirrored so the unwrap reads as seen from outside the arm: looking at the back, lateral is on the left.
      uvs.push(0.5 - (w - 0.5) * 2 * halfWidth, v);
    }
  }

  const skin: number[] = [];
  for (let i = 0; i < ringCount - 1; i++) {
    for (let j = 0; j < segments; j++) {
      const p = i * stride + j;
      const q = p + stride;
      skin.push(p, q, p + 1, p + 1, q, q + 1);
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
        const p = prev + j;
        const q = start + j;
        // Winding mirrors the skin quads: towards the shoulder (dir 1) the cap continues upwards.
        if (dir === 1) caps.push(p, q, p + 1, p + 1, q, q + 1);
        else caps.push(q, p, q + 1, q + 1, p, p + 1);
      }
      prev = start;
    }
  };
  addCap(0, -1, 0.35);
  addCap(ringCount - 1, 1, 0.6);

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    uvs: new Float32Array(uvs),
    skinIndices: new Uint32Array(skin),
    capIndices: new Uint32Array(caps),
  };
}
