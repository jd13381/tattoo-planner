// The four fixed views (PROJECT_BRIEF.md §10.1 F2), in a region's local axes (src/body/geometry.ts).
// The four names are slots: on the torso "medial" and "lateral" are its left and right side.
import { surfacePoint } from "../body/geometry.ts";
import type { RegionProfile } from "../body/profile.ts";

export type ViewName = "front" | "back" | "medial" | "lateral";

export type ViewDef = {
  name: ViewName;
  label: string;
  hint: string;
  /** The skin side seen, for the view buttons: "Front (inner)". */
  side?: string;
  dir: [number, number, number];
};

/** The left arm's views (the original four). */
export const VIEWS: ViewDef[] = [
  { name: "front", label: "Front", hint: "inner side, palm up", side: "inner", dir: [0, 0, 1] },
  { name: "back", label: "Back", hint: "outer side, back of the arm", side: "outer", dir: [0, 0, -1] },
  { name: "medial", label: "Medial", hint: "side towards the body", dir: [-1, 0, 0] },
  { name: "lateral", label: "Lateral", hint: "thumb side", dir: [1, 0, 0] },
];

const LEG_VIEWS: ViewDef[] = [
  { name: "front", label: "Front", hint: "shin and front of the thigh", side: "shin", dir: [0, 0, 1] },
  { name: "back", label: "Back", hint: "calf and back of the thigh", side: "calf", dir: [0, 0, -1] },
  { name: "medial", label: "Medial", hint: "inner side, towards the other leg", dir: [-1, 0, 0] },
  { name: "lateral", label: "Lateral", hint: "outer side", dir: [1, 0, 0] },
];

const TORSO_VIEWS: ViewDef[] = [
  { name: "front", label: "Front", hint: "chest and stomach", dir: [0, 0, 1] },
  { name: "back", label: "Back", hint: "upper and lower back", dir: [0, 0, -1] },
  { name: "medial", label: "Left", hint: "left flank", dir: [1, 0, 0] },
  { name: "lateral", label: "Right", hint: "right flank", dir: [-1, 0, 0] },
];

/**
 * The views of a region. Limbs: medial looks from the body's middle, lateral from outside, so on the
 * right side (mirrored) they swap X.
 */
export function viewsFor(profile: Pick<RegionProfile, "kind" | "mirrored">): ViewDef[] {
  if (profile.kind === "torso") return TORSO_VIEWS;
  const base = profile.kind === "arm" ? VIEWS : LEG_VIEWS;
  // The right arm and the left leg are mirrored, but only the right side swaps medial and lateral.
  const right = profile.kind === "arm" ? profile.mirrored : !profile.mirrored;
  return right ? base.map((v) => ({ ...v, dir: [-v.dir[0], v.dir[1], v.dir[2]] })) : base;
}

/** The u of the centre line each view looks at straight on. */
export function viewU(profile: RegionProfile): Record<ViewName, number> {
  const s = profile.length / 2;
  return Object.fromEntries(
    viewsFor(profile).map((v) => {
      let best = 0;
      let bestDot = -Infinity;
      for (const u of [0, 0.25, 0.5, 0.75]) {
        const n = surfacePoint(profile, u, s).normal;
        const d = n[0] * v.dir[0] + n[1] * v.dir[1] + n[2] * v.dir[2];
        if (d > bestDot) [best, bestDot] = [u, d];
      }
      return [v.name, best];
    }),
  ) as Record<ViewName, number>;
}

export const CAMERA_FOV = 30;

type Vec3 = [number, number, number];
/** Axis-aligned box around the (bent) arm mesh. */
export type Bounds = { min: Vec3; max: Vec3 };

/**
 * Camera position and target that frame the whole arm for a fixed view. Without `bounds` the arm is
 * straight; with them (a bent arm) the camera frames that box instead.
 */
export function viewCamera(
  profile: RegionProfile,
  view: ViewName,
  aspect = 1,
  margin = 1.25,
  bounds?: Bounds,
) {
  const dir = viewsFor(profile).find((v) => v.name === view)!.dir;
  if (bounds) return boundsCamera(bounds, dir, aspect, margin);
  const target: [number, number, number] = [0, profile.length / 2, 0];
  // Fit the arm's length (plus the rounded ends) into the vertical field of view, with margin.
  // The torso is short and wide, and the page's floating panels cover the canvas edges: more room.
  const height = profile.length * margin * (profile.kind === "torso" ? 1.5 : 1);
  const vFov = (CAMERA_FOV * Math.PI) / 180;
  const fitHeight = height / 2 / Math.tan(vFov / 2);
  const fitWidth = ((profile.maxCircumference / Math.PI) * 1.6) / 2 / (Math.tan(vFov / 2) * aspect);
  const distance = Math.max(fitHeight, fitWidth);
  const position: [number, number, number] = [
    target[0] + dir[0] * distance,
    target[1] + dir[1] * distance,
    target[2] + dir[2] * distance,
  ];
  return { position, target };
}

function boundsCamera(b: Bounds, dir: Vec3, aspect: number, margin: number) {
  const target: Vec3 = [0, 1, 2].map((a) => (b.min[a]! + b.max[a]!) / 2) as Vec3;
  const size = [0, 1, 2].map((a) => b.max[a]! - b.min[a]!);
  // Looking along z (front/back) the screen shows x; along x (medial/lateral) it shows z.
  const across = dir[2] !== 0 ? size[0]! : size[2]!;
  const depth = dir[2] !== 0 ? size[2]! : size[0]!;
  const tan = Math.tan((CAMERA_FOV * Math.PI) / 360);
  const fitHeight = (size[1]! * margin) / 2 / tan;
  const fitWidth = (across * margin) / 2 / (tan * aspect);
  const distance = Math.max(fitHeight, fitWidth) + depth / 2;
  const position: Vec3 = [
    target[0] + dir[0] * distance,
    target[1] + dir[1] * distance,
    target[2] + dir[2] * distance,
  ];
  return { position, target };
}

/** Camera presets of the full-body view (docs/adr/0011), in the body frame (+Z front, +X the body's left). */
export type BodyViewName = "front" | "back" | "left" | "right";
export const BODY_VIEWS: { name: BodyViewName; label: string; dir: Vec3 }[] = [
  { name: "front", label: "Front", dir: [0, 0, 1] },
  { name: "back", label: "Back", dir: [0, 0, -1] },
  { name: "left", label: "Left", dir: [1, 0, 0] },
  { name: "right", label: "Right", dir: [-1, 0, 0] },
];

/** Camera position and target that frame the whole body from one side. */
export function bodyCamera(bounds: Bounds, view: BodyViewName, aspect = 1, margin = 1.15) {
  return boundsCamera(bounds, BODY_VIEWS.find((v) => v.name === view)!.dir, aspect, margin);
}

/** A rectangle in canvas pixels (x to the right, y down). */
export type Rect = { x: number; y: number; w: number; h: number };
/** Pixels of the canvas covered at each edge. */
export type Insets = { top: number; right: number; bottom: number; left: number };

/**
 * The part of a canvas that floating panels leave free, as insets. Panels are cut away one at a time
 * (largest first), each by the side that keeps the most room for content of `contentAspect`
 * (width / height); a panel that would leave less than `minShare` of the canvas is ignored.
 */
export function freeInsets(
  width: number,
  height: number,
  panels: Rect[],
  contentAspect: number,
  gap = 8,
  minShare = 0.15,
): Insets {
  let r: Rect = { x: 0, y: 0, w: width, h: height };
  const fit = (q: Rect) => Math.min(q.w / Math.max(contentAspect, 1e-6), q.h);
  for (const p of [...panels].sort((a, b) => b.w * b.h - a.w * a.h)) {
    const x0 = p.x - gap;
    const y0 = p.y - gap;
    const x1 = p.x + p.w + gap;
    const y1 = p.y + p.h + gap;
    if (x1 <= r.x || x0 >= r.x + r.w || y1 <= r.y || y0 >= r.y + r.h) continue;
    const options: Rect[] = [
      { x: r.x, y: r.y, w: x0 - r.x, h: r.h },
      { x: x1, y: r.y, w: r.x + r.w - x1, h: r.h },
      { x: r.x, y: r.y, w: r.w, h: y0 - r.y },
      { x: r.x, y: y1, w: r.w, h: r.y + r.h - y1 },
    ].filter((q) => q.w >= width * minShare && q.h >= height * minShare);
    if (options.length === 0) continue;
    r = options.reduce((best, q) => (fit(q) > fit(best) ? q : best));
  }
  return { top: r.y, left: r.x, right: width - r.x - r.w, bottom: height - r.y - r.h };
}

/** What a fixed view of a region shows across the screen and in depth (world units). */
function screenExtent(b: Bounds, dir: Vec3) {
  const size = [0, 1, 2].map((a) => b.max[a]! - b.min[a]!);
  return {
    across: dir[2] !== 0 ? size[0]! : size[2]!,
    up: size[1]!,
    depth: dir[2] !== 0 ? size[2]! : size[0]!,
  };
}

/** Width / height of a region on screen for a view (to pick the free part of the canvas). */
export function boundsAspect(b: Bounds, dir: Vec3, margin = 1.2): number {
  const e = screenExtent(b, dir);
  return (e.across * margin) / Math.max(e.up * margin, 1e-6);
}

/**
 * Camera for a fixed view that fits the bounds, with margin, into the free part of the canvas. The
 * camera keeps looking at the centre of the bounds (so orbiting turns the region about itself); the
 * returned view offset shifts the picture into the free part (PerspectiveCamera.setViewOffset).
 */
export function fitCamera(
  b: Bounds,
  dir: Vec3,
  width: number,
  height: number,
  insets: Insets = { top: 0, right: 0, bottom: 0, left: 0 },
  margin = 1.2,
) {
  const target: Vec3 = [0, 1, 2].map((a) => (b.min[a]! + b.max[a]!) / 2) as Vec3;
  const e = screenExtent(b, dir);
  const freeW = Math.max(width - insets.left - insets.right, 1);
  const freeH = Math.max(height - insets.top - insets.bottom, 1);
  const tan = Math.tan((CAMERA_FOV * Math.PI) / 360);
  const aspect = width / Math.max(height, 1);
  const fitHeight = ((e.up * margin) / 2 / tan) * (height / freeH);
  const fitWidth = ((e.across * margin) / 2 / (tan * aspect)) * (width / freeW);
  const distance = Math.max(fitHeight, fitWidth) + e.depth / 2;
  const position: Vec3 = [
    target[0] + dir[0] * distance,
    target[1] + dir[1] * distance,
    target[2] + dir[2] * distance,
  ];
  // Moving the sub-window by (x, y) moves the picture by (−x, −y): centre it in the free part.
  const offset: [number, number] = [(insets.right - insets.left) / 2, (insets.bottom - insets.top) / 2];
  return { position, target, offset };
}

/** The fixed-view direction of a region view. */
export function viewDir(profile: Pick<RegionProfile, "kind" | "mirrored">, view: ViewName): Vec3 {
  return viewsFor(profile).find((v) => v.name === view)!.dir;
}
