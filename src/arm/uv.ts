// Coordinates on the skin.
//
// Layout coordinates (config/layouts/*.yaml, PROJECT_BRIEF.md §13.2):
//   u = position around the arm as a fraction of the local circumference.
//       0 = outer centre line (back of the arm in the palm-forward pose), 0.25 = lateral (thumb side),
//       0.5 = inner centre line (palm side), 0.75 = medial (towards the body).
//   v = position along the arm, 0 = wrist crease, 1 = shoulder point.
//
// Texture: a "vase" unwrap. Each row is as wide as the local circumference in cm, centred on the
// outer centre line and seen from outside the arm (lateral on the left, medial on the right), so 1 cm of skin is 1 cm of texture in both directions and a cm grid stays
// even on the 3D arm. The seam sits on the inner centre line (texture edges), as the brief asks.
// Rows are scaled to the widest circumference; the canvas top is the shoulder.
import type { ArmProfile } from "./profile.ts";

/** Wraps u into 0…1. */
export function wrapU(u: number): number {
  return ((u % 1) + 1) % 1;
}

/** Signed distance in cm from the outer centre line, going lateral for positive values. */
export function uToCm(profile: ArmProfile, u: number, v: number): number {
  const w = wrapU(u + 0.5) - 0.5;
  return w * profile.circumferenceAt(v * profile.length);
}

/** Texture coordinates (0…1, origin bottom left as in three.js) of a layout point. */
export function layoutToTexture(profile: ArmProfile, u: number, v: number): { x: number; y: number } {
  return { x: 0.5 - uToCm(profile, u, v) / profile.maxCircumference, y: v };
}

/** Size of the unwrap in cm: width = widest circumference, height = arm length. */
export function unwrapSizeCm(profile: ArmProfile): { width: number; height: number } {
  return { width: profile.maxCircumference, height: profile.length };
}
