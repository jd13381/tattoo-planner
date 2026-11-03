// Flat, fully resolved arm inputs: measurements.yaml values, or placeholders where Jan has not measured yet.
import type { Measurements } from "../config/measurements.ts";

export type ArmInputs = {
  shoulder_to_elbow: number;
  elbow_to_wrist: number;
  wrist: number;
  forearm_mid: number;
  forearm_max: number;
  elbow: number;
  above_elbow: number;
  biceps_mid: number;
  armpit_level: number;
  shoulder: number;
  forearm_max_below_elbow: number;
  armpit_level_below_shoulder: number;
  shoulder_below_shoulder: number;
};

export type ArmInputKey = keyof ArmInputs;

/**
 * Placeholder values (cm) for an adult arm, used until Jan's measurements arrive.
 * They only make the viewer usable; the UI flags every field that still uses one.
 */
export const PLACEHOLDERS: ArmInputs = {
  shoulder_to_elbow: 33,
  elbow_to_wrist: 27,
  wrist: 17,
  forearm_mid: 26,
  forearm_max: 29,
  elbow: 27,
  above_elbow: 28,
  biceps_mid: 31,
  armpit_level: 34,
  shoulder: 38,
  forearm_max_below_elbow: 6,
  armpit_level_below_shoulder: 11,
  shoulder_below_shoulder: 4,
};

/** Field order and grouping for the UI. */
export const INPUT_GROUPS: { title: string; keys: ArmInputKey[] }[] = [
  { title: "Lengths", keys: ["shoulder_to_elbow", "elbow_to_wrist"] },
  {
    title: "Circumferences",
    keys: [
      "wrist",
      "forearm_mid",
      "forearm_max",
      "elbow",
      "above_elbow",
      "biceps_mid",
      "armpit_level",
      "shoulder",
    ],
  },
  {
    title: "Positions",
    keys: ["forearm_max_below_elbow", "armpit_level_below_shoulder", "shoulder_below_shoulder"],
  },
];

/** The measured values from the YAML, flattened; null where not measured. */
export function measuredValues(m: Measurements): Record<ArmInputKey, number | null> {
  return { ...m.lengths, ...m.circumferences, ...m.positions };
}

/** Fills every null with its placeholder and reports which fields are placeholders. */
export function resolveInputs(values: Record<ArmInputKey, number | null>): {
  inputs: ArmInputs;
  placeholders: ArmInputKey[];
} {
  const inputs = { ...PLACEHOLDERS };
  const placeholders: ArmInputKey[] = [];
  for (const key of Object.keys(PLACEHOLDERS) as ArmInputKey[]) {
    const v = values[key];
    if (v === null || v === undefined) placeholders.push(key);
    else inputs[key] = v;
  }
  return { inputs, placeholders };
}
