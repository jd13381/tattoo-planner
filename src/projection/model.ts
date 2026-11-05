// Forward model of a photo of the forearm (docs/adr/0006-anubis-projection.md).
//
// Locally the forearm is the planner's elliptical cross-section at that height (circumference and
// aspect from the profile, points placed by arc length as in src/body/geometry.ts), seen
// orthographically (photos from about 1 m). A photo is calibrated by
//   - its two silhouette edges (straight lines), which fix where each cross-section lies across the arm,
//   - two points at known distances along the arm (e.g. wrist crease and top of the tattoo), which fix
//     where the wrist crease is and the scale along the arm,
//   - u_view, the u whose surface normal points at the camera, at the wrist and at the elbow.
// For a skin point (u, s) the model gives the photo point and the cosine between the skin normal and
// the view direction (visibility; ≤ 0 = facing away). The patch is built in this direction, skin pixel
// → photo pixel, so it has no holes.
import { arcLengthInverse, semiAxes } from "../body/ellipse.ts";
import type { ArmProfile } from "../body/profile.ts";
import { wrapU } from "../body/uv.ts";
import type { PhotoCalibration, PhotoPoint } from "./schema.ts";

/** Parametric angle of the outer centre line (-Z), as in src/body/geometry.ts. */
const OUTER_ANGLE = -Math.PI / 2;

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
 * Image right is the arm's Y × N (wrist down, shoulder up in the photo): seen from the inner side,
 * lateral is on the right, as in the unwrap.
 */
export type SectionView = { at(u: number): { t: number; cos: number } };

export function sectionView(circumference: number, aspect: number, uView: number): SectionView {
  const { a, b } = semiAxes(circumference, aspect);
  const angleAt = arcLengthInverse(a, b, OUTER_ANGLE, 360);
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
  /** Wrist crease reference, px. */
  wrist: Vec;
  /** Unit vector along the arm towards the elbow, px space. */
  axis: Vec;
  /** Pixels per cm along the arm. */
  pxPerCm: number;
  left: [Vec, Vec];
  right: [Vec, Vec];
  /** u facing the camera at s cm from the wrist crease. */
  uViewAt(s: number): number;
};

const px = (p: PhotoPoint, w: number, h: number): Vec => ({ x: p.x * w, y: p.y * h });

export function photoFrame(
  photo: PhotoCalibration,
  width: number,
  height: number,
  elbowAt: number,
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
      const t = Math.min(1, Math.max(0, s / elbowAt));
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
  profile: ArmProfile,
  u: number,
  s: number,
): { x: number; y: number; cos: number } | null {
  const sil = silhouetteAt(frame, s);
  if (!sil) return null;
  const view = sectionView(profile.circumferenceAt(s), profile.aspectAt(s), frame.uViewAt(s));
  const { t, cos } = view.at(u);
  return { ...acrossSilhouette(sil, t), cos };
}

/** Distance along the arm (cm from the wrist crease) of a photo point, px. */
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
 * every `uStep` (inner, lateral and medial lines marked) and of equal distance from the wrist crease
 * every `sStep` cm up to `sMax`, only where they face the camera.
 */
export function modelGrid(
  frame: PhotoFrame,
  profile: ArmProfile,
  opts: { uStep?: number; sStep?: number; sMax?: number } = {},
): GridLine[] {
  const uStep = opts.uStep ?? 0.05;
  const sStep = opts.sStep ?? 2;
  const sMax = opts.sMax ?? profile.elbowAt;
  const lines: GridLine[] = [];
  const visible = (u: number, s: number) => {
    const q = projectPoint(frame, profile, u, s);
    return q && q.cos > 0 ? { x: q.x, y: q.y } : null;
  };
  const steps = Math.round(1 / uStep);
  for (let k = 0; k < steps; k++) {
    const u = k / steps;
    const pts: Vec[] = [];
    for (let s = 0; s <= sMax + 1e-9; s += 0.5) {
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
  for (let s = 0; s <= sMax + 1e-9; s += sStep) {
    const pts: Vec[] = [];
    for (let u = 0; u <= 1 + 1e-9; u += 0.01) {
      const p = visible(u, s);
      if (p) pts.push(p);
    }
    if (pts.length > 1) lines.push({ kind: Math.round(s) % 10 === 0 ? "s10" : "s", pts });
  }
  return lines;
}
