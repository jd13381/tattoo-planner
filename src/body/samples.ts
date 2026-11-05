// Sample bodies (docs/adr/0011): a female and a male adult as parameter sets, no meshes. Values are
// rounded, approximate adult averages chosen for plausible proportions (about 165 cm and 178 cm body
// height), not anthropometric truth. Own measurements override them per value; every value nobody
// measured keeps the sample's, scaled by body height when one is given (src/body/body.ts).
import { PLACEHOLDERS, type ArmInputs, type LegInputs, type TorsoInputs } from "./inputs.ts";

export const BODY_IDS = ["female", "male"] as const;
export type BodyId = (typeof BODY_IDS)[number];
/** The sample used when measurements.yaml names none (a later step moves the choice to project.yaml). */
export const DEFAULT_BODY: BodyId = "male";

/** Body-frame parameters, cm unless noted; they place the regions and size the parts nobody edits. */
export type BodyParams = {
  height: number;
  /** Floor to the start of the legs (just above the ankle bones). */
  ankle_height: number;
  /** Hip crease (top of the legs) up to the waist line (navel, start of the torso). */
  pelvis_height: number;
  /** Between the two shoulder points (where the arms end). */
  shoulder_width: number;
  /** Between the axes of the two legs at the hip crease. */
  hip_spacing: number;
  /** Widest width and depth of the hips and buttocks (drawn in neutral skin). */
  hip_width: number;
  hip_depth: number;
  /** Base of the neck up to the head. */
  neck_height: number;
  head_height: number;
  head_width: number;
  head_depth: number;
  hand_length: number;
  hand_width: number;
  foot_length: number;
  foot_width: number;
  /** A-pose: arms this far away from the body, legs slightly apart (degrees, not scaled). */
  arm_abduction_deg: number;
  leg_abduction_deg: number;
};

export type SampleBody = {
  id: BodyId;
  label: string;
  params: BodyParams;
  /** One set per region kind; left and right are the same (the right side is the mirror image). */
  arm: ArmInputs;
  leg: LegInputs;
  torso: TorsoInputs;
};

export const SAMPLES: Record<BodyId, SampleBody> = {
  female: {
    id: "female",
    label: "Female sample (≈165 cm)",
    params: {
      height: 165,
      ankle_height: 7,
      pelvis_height: 17,
      shoulder_width: 36,
      hip_spacing: 19,
      hip_width: 37,
      hip_depth: 25,
      neck_height: 7,
      head_height: 21,
      head_width: 14.5,
      head_depth: 18,
      hand_length: 17.5,
      hand_width: 7.5,
      foot_length: 24,
      foot_width: 9,
      arm_abduction_deg: 15,
      leg_abduction_deg: 3,
    },
    arm: {
      shoulder_to_elbow: 31,
      elbow_to_wrist: 24,
      wrist: 15,
      forearm_mid: 22,
      forearm_max: 24,
      elbow: 24,
      above_elbow: 25.5,
      biceps_mid: 28,
      armpit_level: 30,
      shoulder: 33,
      forearm_max_below_elbow: 5.5,
      armpit_level_below_shoulder: 10,
      shoulder_below_shoulder: 4,
    },
    leg: {
      ankle_to_knee: 39,
      knee_to_hip: 37,
      ankle: 21,
      calf_max: 36,
      below_knee: 34.5,
      knee: 36,
      above_knee: 40,
      thigh_mid: 52,
      thigh_top: 58,
      calf_max_below_knee: 11,
      thigh_top_below_hip: 4,
    },
    torso: {
      waist_to_neck: 37,
      waist: 74,
      ribs: 76,
      chest: 90,
      shoulder_line: 80,
      neck_base: 36,
      waist_to_ribs: 11,
      waist_to_chest: 23,
      shoulder_line_below_neck: 4,
      waist_aspect: 1.4,
      chest_aspect: 1.45,
      shoulder_aspect: 2.0,
    },
  },
  male: {
    id: "male",
    label: "Male sample (≈178 cm)",
    params: {
      height: 178,
      ankle_height: 7.5,
      pelvis_height: 17,
      shoulder_width: 40,
      hip_spacing: 18,
      hip_width: 35,
      hip_depth: 24,
      neck_height: 7,
      head_height: 23,
      head_width: 15.5,
      head_depth: 19.5,
      hand_length: 19,
      hand_width: 8.5,
      foot_length: 26,
      foot_width: 10,
      arm_abduction_deg: 15,
      leg_abduction_deg: 3,
    },
    // The arm placeholders the planner has always used, so an unmeasured arm looks as it did.
    arm: PLACEHOLDERS,
    leg: {
      ankle_to_knee: 42,
      knee_to_hip: 40,
      ankle: 23,
      calf_max: 38,
      below_knee: 36.5,
      knee: 38,
      above_knee: 41,
      thigh_mid: 52,
      thigh_top: 58,
      calf_max_below_knee: 12,
      thigh_top_below_hip: 4,
    },
    torso: {
      waist_to_neck: 41.5,
      waist: 86,
      ribs: 92,
      chest: 100,
      shoulder_line: 88,
      neck_base: 42,
      waist_to_ribs: 12,
      waist_to_chest: 26,
      shoulder_line_below_neck: 4,
      waist_aspect: 1.35,
      chest_aspect: 1.4,
      shoulder_aspect: 2.0,
    },
  },
};

/** Inputs that are shape ratios, not lengths: height scaling leaves them alone. */
export const UNSCALED_INPUTS: ReadonlySet<string> = new Set([
  "waist_aspect",
  "chest_aspect",
  "shoulder_aspect",
]);
/** Body parameters that are angles: height scaling leaves them alone. */
export const UNSCALED_PARAMS: ReadonlySet<keyof BodyParams> = new Set([
  "arm_abduction_deg",
  "leg_abduction_deg",
]);

/** Every length of a record times `factor`, except the keys in `keep`. */
export function scaleValues<T extends Record<string, number>>(
  values: T,
  factor: number,
  keep: ReadonlySet<string>,
): T {
  return Object.fromEntries(Object.entries(values).map(([k, v]) => [k, keep.has(k) ? v : v * factor])) as T;
}
