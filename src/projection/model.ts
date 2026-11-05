// Forward model of a photo of a body region (docs/adr/0006-anubis-projection.md, generalised to every
// region in docs/adr/0014-guided-projection.md).
//
// Locally the region is the planner's elliptical cross-section at that height (circumference and
// aspect from the profile, points placed by arc length as in src/body/geometry.ts, with the region's
// own u = 0 line and direction), seen orthographically (photos from about 1 m). A photo is calibrated by
//   - its two silhouette edges (straight lines), which fix where each cross-section lies across the limb,
//   - two points at known distances from the region's start along its axis (e.g. wrist crease and top of
//     the tattoo), which fix where the start line is and the scale along the axis,
//   - u_view, the u whose surface normal points at the camera, at the start and at the twist reference
//     (the elbow tip on arms, the knee on legs, the neck on the torso; `twistReach`).
// For a skin point (u, s) the model gives the photo point and the cosine between the skin normal and
// the view direction (visibility; ≤ 0 = facing away). The patch is built in this direction, skin pixel
// → photo pixel, so it has no holes.
import { arcLengthInverse, semiAxes } from "../body/ellipse.ts";
import { U0_ANGLE } from "../body/geometry.ts";
import type { RegionKind, RegionProfile } from "../body/profile.ts";
import { wrapU } from "../body/uv.ts";
import type { PhotoCalibration, PhotoPoint } from "./schema.ts";

/** What the cross-section needs to know about its region: where u = 0 lies and which way u turns. */
export type SectionConvention = { kind: RegionKind; mirrored: boolean };

/** The left arm, the region the projection was first built for (docs/adr/0006). */
const LEFT_ARM: SectionConvention = { kind: "arm", mirrored: false };

/**
 * Distance from the region's start (cm) at which `u_view.elbow` applies; u_view is interpolated
 * linearly from the start up to here and constant beyond. The forearm twists between wrist and elbow,
 * the lower leg between ankle and knee; the torso has no such joint, so its far value applies at the
 * neck.
 */
export function twistReach(profile: RegionProfile): number {
  switch (profile.kind) {
    case "arm":
      return profile.elbowAt;
    case "leg":
      return profile.kneeAt;
    case "torso":
      return profile.length;
  }
}

export type Vec = { x: number; y: number };

const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
const dot = (a: Vec, b: Vec) => a.x * b.x + a.y * b.y;
const norm = (a: Vec): Vec => {
  const l = Math.hypot(a.x, a.y) || 1;
  return { x: a.x / l, y: a.y / l };
};

/**
 * One cross-section seen from the direction of u_view's normal. `at(u)` gives the position across the
 * silhouette, t = -1 (left edge of the photo) … 1 (right edge), and the visibility cosine.
 * Image right is the region's Y × N (its start down, its end up in the photo), a physical direction,
 * so on every region the photo shows the skin as the unwrap does, seen from outside: on the left arm
 * seen from the inner side lateral is on the right; on a mirrored region u grows to the right.
 */
export type SectionView = { at(u: number): { t: number; cos: number } };

export function sectionView(
  circumference: number,
  aspect: number,
  uView: number,
  region: SectionConvention = LEFT_ARM,
): SectionView {
  const { a, b } = semiAxes(circumference, aspect);
  // As ringAngles in src/body/geometry.ts: u grows with the angle unless the region is mirrored.
  const start = U0_ANGLE[region.kind];
  const plain = arcLengthInverse(a, b, start, 360);
  const angleAt = region.mirrored ? (u: number) => 2 * start - plain(u) : plain;
  const pv = angleAt(wrapU(uView));
  // Outward normal at parameter φ of (a cos φ, b sin φ) is ∝ (b cos φ, a sin φ) in (x, z).
  const n = norm({ x: b * Math.cos(pv), y: a * Math.sin(pv) });
  // Image right = Y × N = (N.z, 0, -N.x).
  const r = { x: n.y, y: -n.x };
  const half = Math.hypot(a * r.x, b * r.y);
  return {
    at(u: number) {
      const phi = angleAt(wrapU(u));
      const c = Math.cos(phi);
      const s = Math.sin(phi);
      const p = a * c * r.x + b * s * r.y;
      const nu = norm({ x: b * c, y: a * s });
      return { t: p / half, cos: dot(nu, n) };
    },
  };
}

/** A photo's calibration turned into pixel geometry (turned photo, `width` × `height` px). */
export type PhotoFrame = {
  width: number;
  height: number;
  /** The region's start line (wrist crease on arms) on the axis, px. */
  wrist: Vec;
  /** Unit vector along the axis towards the region's end, px space. */
  axis: Vec;
  /** Pixels per cm along the axis. */
  pxPerCm: number;
  left: [Vec, Vec];
  right: [Vec, Vec];
  /** u facing the camera at s cm from the region's start. */
  uViewAt(s: number): number;
};

const px = (p: PhotoPoint, w: number, h: number): Vec => ({ x: p.x * w, y: p.y * h });

export function photoFrame(
  photo: PhotoCalibration,
  width: number,
  height: number,
  /** Where `u_view.elbow` applies, cm from the start (`twistReach`). */
  reach: number,
): PhotoFrame | null {
  const left: [Vec, Vec] = [px(photo.edges.left[0], width, height), px(photo.edges.left[1], width, height)];
  const right: [Vec, Vec] = [
    px(photo.edges.right[0], width, height),
    px(photo.edges.right[1], width, height),
  ];
  const [m0, m1] = photo.along;
  const p0 = px(m0, width, height);
  const p1 = px(m1, width, height);
  // The arm's direction: the mean of both edges, pointing from the lower towards the higher mark.
  const up = m1.cm >= m0.cm ? sub(p1, p0) : sub(p0, p1);
  const orient = (d: Vec) => (dot(d, up) < 0 ? { x: -d.x, y: -d.y } : d);
  const dl = orient(norm(sub(left[1], left[0])));
  const dr = orient(norm(sub(right[1], right[0])));
  const axis = norm({ x: dl.x + dr.x, y: dl.y + dr.y });
  const span = dot(sub(p1, p0), axis);
  const pxPerCm = span / (m1.cm - m0.cm);
  if (!(pxPerCm > 0) || !Number.isFinite(pxPerCm)) return null;
  // The wrist crease (s = 0) on the line through the first mark.
  const wrist = { x: p0.x - m0.cm * pxPerCm * axis.x, y: p0.y - m0.cm * pxPerCm * axis.y };
  const { wrist: uw, elbow: ue } = photo.u_view;
  return {
    width,
    height,
    wrist,
    axis,
    pxPerCm,
    left,
    right,
    uViewAt(s: number) {
      const t = Math.min(1, Math.max(0, s / reach));
      return uw + (ue - uw) * t;
    },
  };
}

/** Where the cross-line at s (perpendicular to the axis) meets an edge line; null if parallel. */
function edgeAt(frame: PhotoFrame, edge: [Vec, Vec], s: number): Vec | null {
  const d = sub(edge[1], edge[0]);
  const den = dot(d, frame.axis);
  if (Math.abs(den) < 1e-9) return null;
  const lambda = (s * frame.pxPerCm - dot(sub(edge[0], frame.wrist), frame.axis)) / den;
  return { x: edge[0].x + lambda * d.x, y: edge[0].y + lambda * d.y };
}

/** The silhouette points of the cross-section at s, px (left, right). */
export function silhouetteAt(frame: PhotoFrame, s: number): [Vec, Vec] | null {
  const l = edgeAt(frame, frame.left, s);
  const r = edgeAt(frame, frame.right, s);
  return l && r ? [l, r] : null;
}

/** Photo point (px) of position t (-1 left … 1 right) across the silhouette pair. */
export function acrossSilhouette(sil: [Vec, Vec], t: number): Vec {
  const k = (t + 1) / 2;
  return { x: sil[0].x + k * (sil[1].x - sil[0].x), y: sil[0].y + k * (sil[1].y - sil[0].y) };
}

/**
 * Projects a skin point into the photo: pixel position and visibility cosine, or null when the
 * section has no silhouette. Convenience for tests and overlays; the patch builder works row by row.
 */
export function projectPoint(
  frame: PhotoFrame,
  profile: RegionProfile,
  u: number,
  s: number,
): { x: number; y: number; cos: number } | null {
  const sil = silhouetteAt(frame, s);
  if (!sil) return null;
  const view = sectionView(profile.circumferenceAt(s), profile.aspectAt(s), frame.uViewAt(s), profile);
  const { t, cos } = view.at(u);
  return { ...acrossSilhouette(sil, t), cos };
}

/** Distance along the axis (cm from the region's start) of a photo point, px. */
export function alongArm(frame: PhotoFrame, p: Vec): number {
  return dot(sub(p, frame.wrist), frame.axis) / frame.pxPerCm;
}

/** Blend weight of a photo for a skin point: cos^exponent, zero when facing away. */
export function viewWeight(cos: number, exponent: number, weight = 1): number {
  return cos > 0 ? weight * Math.pow(cos, exponent) : 0;
}

/** Where a point of the turned photo (0..1) lies in the stored, EXIF-upright photo (0..1). */
export function turnedToStored(x: number, y: number, turn: 0 | 90 | 180 | 270): Vec {
  switch (turn) {
    case 0:
      return { x, y };
    case 90: // the stored photo was turned clockwise: its left edge became the top
      return { x: y, y: 1 - x };
    case 180:
      return { x: 1 - x, y: 1 - y };
    case 270:
      return { x: 1 - y, y: x };
  }
}

/** Size of the turned photo for a stored photo of the given size. */
export function turnedSize(width: number, height: number, turn: 0 | 90 | 180 | 270) {
  return turn === 90 || turn === 270 ? { width: height, height: width } : { width, height };
}

export type GridLine = { kind: "inner" | "side" | "u" | "s10" | "s"; pts: Vec[] };

/**
 * The model's skin grid as seen in a photo (px), for checking a calibration by eye: lines of equal u
 * every `uStep` (the seam line u = 0.5 as "inner", u = 0.25 and 0.75 as "side") and of equal distance
 * from the region's start every `sStep` cm from `sMin` up to `sMax`, only where they face the camera.
 */
export function modelGrid(
  frame: PhotoFrame,
  profile: RegionProfile,
  opts: { uStep?: number; sStep?: number; sMin?: number; sMax?: number } = {},
): GridLine[] {
  const uStep = opts.uStep ?? 0.05;
  const sStep = opts.sStep ?? 2;
  const sMax = Math.min(profile.length, opts.sMax ?? twistReach(profile));
  const sMin = Math.max(0, Math.ceil((opts.sMin ?? 0) / sStep) * sStep);
  const lines: GridLine[] = [];
  const visible = (u: number, s: number) => {
    const q = projectPoint(frame, profile, u, s);
    return q && q.cos > 0 ? { x: q.x, y: q.y } : null;
  };
  const steps = Math.round(1 / uStep);
  for (let k = 0; k < steps; k++) {
    const u = k / steps;
    const pts: Vec[] = [];
    for (let s = sMin; s <= sMax + 1e-9; s += 0.5) {
      const p = visible(u, s);
      if (p) pts.push(p);
    }
    const kind =
      Math.abs(u - 0.5) < 1e-9
        ? "inner"
        : Math.abs(u - 0.25) < 1e-9 || Math.abs(u - 0.75) < 1e-9
          ? "side"
          : "u";
    if (pts.length > 1) lines.push({ kind, pts });
  }
  for (let s = sMin; s <= sMax + 1e-9; s += sStep) {
    const pts: Vec[] = [];
    for (let u = 0; u <= 1 + 1e-9; u += 0.01) {
      const p = visible(u, s);
      if (p) pts.push(p);
    }
    if (pts.length > 1) lines.push({ kind: Math.round(s) % 10 === 0 ? "s10" : "s", pts });
  }
  return lines;
}
