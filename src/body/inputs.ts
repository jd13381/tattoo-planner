// Flat, fully resolved region inputs: measurements.yaml values, or sample-body values where nobody has
// measured (docs/adr/0011). Every region kind has its own keys, grouped into the sections of
// measurements.yaml (lengths, circumferences, positions, and for the torso its shape).
import type { RegionKind } from "./profile.ts";

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

export type LegInputs = {
  /** Ankle (just above the ankle bones) to the knee centre. */
  ankle_to_knee: number;
  /** Knee centre to the hip crease (front of the hip, where the thigh meets the body). */
  knee_to_hip: number;
  ankle: number;
  calf_max: number;
  below_knee: number;
  knee: number;
  above_knee: number;
  thigh_mid: number;
  thigh_top: number;
  calf_max_below_knee: number;
  thigh_top_below_hip: number;
};

export type TorsoInputs = {
  /** Waist line (navel height) to the base of the neck, along the body. */
  waist_to_neck: number;
  waist: number;
  /** Around the lowest ribs (below the chest or bust). */
  ribs: number;
  /** Around the chest at the armpits. */
  chest: number;
  /** Around the torso at the height of the shoulder points, without the arms (estimated, not taped). */
  shoulder_line: number;
  neck_base: number;
  waist_to_ribs: number;
  waist_to_chest: number;
  shoulder_line_below_neck: number;
  /** Cross-section width / depth at the waist, the chest line and the shoulder line. */
  waist_aspect: number;
  chest_aspect: number;
  shoulder_aspect: number;
};

export type InputsOf = { arm: ArmInputs; leg: LegInputs; torso: TorsoInputs };
export type InputKeyOf<K extends RegionKind> = keyof InputsOf[K] & string;
/** A region's inputs as a plain record (the generic form the resolver works on). */
export type InputValues = Record<string, number>;

/** Sections of a region block in measurements.yaml, in file order. */
export type InputSection = "lengths" | "circumferences" | "positions" | "shape";

/** Keys per kind and section, in file order: the single source for schema, UI and resolver. */
export const INPUT_SECTIONS: { [K in RegionKind]: { section: InputSection; keys: InputKeyOf<K>[] }[] } = {
  arm: [
    { section: "lengths", keys: ["shoulder_to_elbow", "elbow_to_wrist"] },
    {
      section: "circumferences",
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
      section: "positions",
      keys: ["forearm_max_below_elbow", "armpit_level_below_shoulder", "shoulder_below_shoulder"],
    },
  ],
  leg: [
    { section: "lengths", keys: ["ankle_to_knee", "knee_to_hip"] },
    {
      section: "circumferences",
      keys: ["ankle", "calf_max", "below_knee", "knee", "above_knee", "thigh_mid", "thigh_top"],
    },
    { section: "positions", keys: ["calf_max_below_knee", "thigh_top_below_hip"] },
  ],
  torso: [
    { section: "lengths", keys: ["waist_to_neck"] },
    { section: "circumferences", keys: ["waist", "ribs", "chest", "shoulder_line", "neck_base"] },
    { section: "positions", keys: ["waist_to_ribs", "waist_to_chest", "shoulder_line_below_neck"] },
    { section: "shape", keys: ["waist_aspect", "chest_aspect", "shoulder_aspect"] },
  ],
};

/** Every input key of a kind, in file order. */
export function inputKeys<K extends RegionKind>(kind: K): InputKeyOf<K>[] {
  return (INPUT_SECTIONS[kind] as { keys: InputKeyOf<K>[] }[]).flatMap((s) => s.keys);
}

/**
 * Placeholder values (cm) for an adult arm, used until Jan's measurements arrive. They are also the
 * male sample body's arms (src/body/samples.ts), so an unmeasured arm looks as it always did.
 * The UI flags every field that still uses one.
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

const SECTION_TITLES: Record<InputSection, string> = {
  lengths: "Lengths",
  circumferences: "Circumferences",
  positions: "Positions",
  shape: "Shape",
};

/** Field order and grouping for the UI. */
export function inputGroups<K extends RegionKind>(kind: K): { title: string; keys: InputKeyOf<K>[] }[] {
  return (INPUT_SECTIONS[kind] as { section: InputSection; keys: InputKeyOf<K>[] }[]).map((s) => ({
    title: SECTION_TITLES[s.section],
    keys: s.keys,
  }));
}

/** The arm's field order and grouping (the Arm & measurements panel). */
export const INPUT_GROUPS: { title: string; keys: ArmInputKey[] }[] = inputGroups("arm");

/** The arm's measured values from the YAML's top-level blocks, flattened; null where not measured. */
export function measuredValues(m: {
  lengths?: Partial<Record<string, number | null>>;
  circumferences?: Partial<Record<string, number | null>>;
  positions?: Partial<Record<string, number | null>>;
}): Record<ArmInputKey, number | null> {
  const flat: Partial<Record<string, number | null>> = { ...m.lengths, ...m.circumferences, ...m.positions };
  return Object.fromEntries(inputKeys("arm").map((k) => [k, flat[k] ?? null])) as Record<
    ArmInputKey,
    number | null
  >;
}

/**
 * Fills every null with its fallback and reports which fields use one. `fallback` defaults to the arm
 * placeholders; the body resolver passes the (scaled) sample values of any region kind.
 */
export function resolveInputs(values: Record<ArmInputKey, number | null>): {
  inputs: ArmInputs;
  placeholders: ArmInputKey[];
};
export function resolveInputs<T extends InputValues>(
  values: Partial<Record<keyof T, number | null>>,
  fallback: T,
): { inputs: T; placeholders: (keyof T & string)[] };
export function resolveInputs(
  values: Partial<Record<string, number | null>>,
  fallback: InputValues = PLACEHOLDERS,
): { inputs: InputValues; placeholders: string[] } {
  const inputs: InputValues = { ...fallback };
  const placeholders: string[] = [];
  for (const key of Object.keys(fallback)) {
    const v = values[key];
    if (v === null || v === undefined) placeholders.push(key);
    else inputs[key] = v;
  }
  return { inputs, placeholders };
}
