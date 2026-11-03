// The four fixed views (PROJECT_BRIEF.md §10.1 F2), in the arm's axes (see src/arm/geometry.ts).
import type { ArmProfile } from "../arm/profile.ts";

export type ViewName = "front" | "back" | "medial" | "lateral";

export const VIEWS: { name: ViewName; label: string; hint: string; dir: [number, number, number] }[] = [
  { name: "front", label: "Front", hint: "inner side, palm up", dir: [0, 0, 1] },
  { name: "back", label: "Back", hint: "outer side, back of the arm", dir: [0, 0, -1] },
  { name: "medial", label: "Medial", hint: "side towards the body", dir: [-1, 0, 0] },
  { name: "lateral", label: "Lateral", hint: "thumb side", dir: [1, 0, 0] },
];

export const CAMERA_FOV = 30;

type Vec3 = [number, number, number];
/** Axis-aligned box around the (bent) arm mesh. */
export type Bounds = { min: Vec3; max: Vec3 };

/**
 * Camera position and target that frame the whole arm for a fixed view. Without `bounds` the arm is
 * straight; with them (a bent arm) the camera frames that box instead.
 */
export function viewCamera(profile: ArmProfile, view: ViewName, aspect = 1, margin = 1.25, bounds?: Bounds) {
  const dir = VIEWS.find((v) => v.name === view)!.dir;
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
