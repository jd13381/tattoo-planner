// The arm's profile along its length: where each circumference sits, interpolated in between.
// s is the distance from the wrist crease along the arm axis in cm (0 = wrist, length = shoulder point).
import { monotoneCubic } from "./interpolate.ts";
import type { ArmInputs } from "./inputs.ts";

export type Station = { label: string; s: number; circumference: number };

export type ArmProfile = {
  /** Wrist crease to shoulder point, cm. */
  length: number;
  /** Distance of the elbow tip from the wrist crease, cm. */
  elbowAt: number;
  stations: Station[];
  /** Largest circumference along the arm; sets the width of the unwrap. */
  maxCircumference: number;
  circumferenceAt(s: number): number;
  /** Cross-section aspect ratio (width across / depth front to back) at s. */
  aspectAt(s: number): number;
  /** Station labels that had to be reordered because their positions overlap. */
  warnings: string[];
};

/** Above the elbow the tape is laid at a fixed distance (docs/measuring.md). */
export const ABOVE_ELBOW_CM = 5;

/**
 * Cross-section shape assumption: the wrist is clearly flatter than round, the upper arm nearly round.
 * Values are typical anatomy, not measured; refine if Jan's photos show otherwise.
 */
const ASPECT_KNOTS = [
  { at: "wrist", k: 1.4 },
  { at: "forearm_mid", k: 1.2 },
  { at: "elbow", k: 1.08 },
  { at: "shoulder", k: 1.0 },
] as const;

export function buildProfile(m: ArmInputs): ArmProfile {
  const elbowAt = m.elbow_to_wrist;
  const length = m.elbow_to_wrist + m.shoulder_to_elbow;
  const raw: Station[] = [
    { label: "wrist", s: 0, circumference: m.wrist },
    { label: "forearm_mid", s: elbowAt / 2, circumference: m.forearm_mid },
    { label: "forearm_max", s: elbowAt - m.forearm_max_below_elbow, circumference: m.forearm_max },
    { label: "elbow", s: elbowAt, circumference: m.elbow },
    { label: "above_elbow", s: elbowAt + ABOVE_ELBOW_CM, circumference: m.above_elbow },
    { label: "biceps_mid", s: elbowAt + m.shoulder_to_elbow / 2, circumference: m.biceps_mid },
    { label: "armpit_level", s: length - m.armpit_level_below_shoulder, circumference: m.armpit_level },
    { label: "shoulder", s: length - m.shoulder_below_shoulder, circumference: m.shoulder },
  ];
  const warnings: string[] = [];
  for (let i = 1; i < raw.length; i++) {
    if (raw[i]!.s <= raw[i - 1]!.s) warnings.push(`${raw[i]!.label} sits at or below ${raw[i - 1]!.label}`);
  }
  const stations = raw
    .map((st) => ({ ...st, s: Math.min(Math.max(st.s, 0), length) }))
    .sort((p, q) => p.s - q.s)
    // Equal positions would make the interpolation divide by zero: keep the first.
    .filter((st, i, all) => i === 0 || st.s > all[i - 1]!.s + 1e-6);

  const circumferenceAt = monotoneCubic(stations.map((st) => ({ x: st.s, y: st.circumference })));
  const aspectS: Record<(typeof ASPECT_KNOTS)[number]["at"], number> = {
    wrist: 0,
    forearm_mid: elbowAt / 2,
    elbow: elbowAt,
    shoulder: length,
  };
  const aspectAt = monotoneCubic(ASPECT_KNOTS.map((k) => ({ x: aspectS[k.at], y: k.k })));

  let maxCircumference = 0;
  for (let i = 0; i <= 200; i++)
    maxCircumference = Math.max(maxCircumference, circumferenceAt((length * i) / 200));

  return { length, elbowAt, stations, maxCircumference, circumferenceAt, aspectAt, warnings };
}
