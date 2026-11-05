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
  const height = profile.length * margin;
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
