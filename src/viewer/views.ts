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

/** Camera position and target that frame the whole arm for a fixed view. */
export function viewCamera(profile: ArmProfile, view: ViewName, aspect = 1) {
  const dir = VIEWS.find((v) => v.name === view)!.dir;
  const target: [number, number, number] = [0, profile.length / 2, 0];
  // Fit the arm's length (plus the rounded ends) into the vertical field of view, with margin.
  const height = profile.length * 1.25;
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
