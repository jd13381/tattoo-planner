// The guided "Measure yourself" wizard and the labels of the measurements form: for every region kind
// the values in measuring order, a short instruction (where the tape goes, which landmark, relaxed or
// not) and a schematic of the line to draw. The arm follows docs/measuring.md; leg and torso use the
// analogous landmarks of src/body/profile.ts. Plain data, framework-free.
import { inputKeys, type InputSection } from "./inputs.ts";
import { ABOVE_ELBOW_CM, ABOVE_KNEE_CM, BELOW_KNEE_CM, type RegionKind } from "./profile.ts";
import { REGIONS, type RegionId } from "./regions.ts";

/** Field names in the form and the wizard. */
export const INPUT_LABELS: Record<string, string> = {
  // arm
  shoulder_to_elbow: "Shoulder → elbow",
  elbow_to_wrist: "Elbow → wrist",
  wrist: "Wrist",
  forearm_mid: "Forearm mid",
  forearm_max: "Forearm max",
  elbow: "Elbow",
  above_elbow: `Above elbow (+${ABOVE_ELBOW_CM} cm)`,
  biceps_mid: "Biceps mid",
  armpit_level: "Armpit level",
  shoulder: "Shoulder",
  forearm_max_below_elbow: "Forearm max, below elbow",
  armpit_level_below_shoulder: "Armpit level, below shoulder",
  shoulder_below_shoulder: "Shoulder tape, below shoulder",
  // leg
  ankle_to_knee: "Ankle → knee",
  knee_to_hip: "Knee → hip crease",
  ankle: "Ankle",
  calf_max: "Calf max",
  below_knee: `Below knee (−${BELOW_KNEE_CM} cm)`,
  knee: "Knee",
  above_knee: `Above knee (+${ABOVE_KNEE_CM} cm)`,
  thigh_mid: "Thigh mid",
  thigh_top: "Thigh top",
  calf_max_below_knee: "Calf max, below knee",
  thigh_top_below_hip: "Thigh top, below hip crease",
  // torso
  waist_to_neck: "Waist → neck base",
  waist: "Waist",
  ribs: "Lowest ribs",
  chest: "Chest",
  shoulder_line: "Shoulder line (estimate)",
  neck_base: "Neck base",
  waist_to_ribs: "Ribs, above waist",
  waist_to_chest: "Chest, above waist",
  shoulder_line_below_neck: "Shoulder line, below neck",
  waist_aspect: "Waist width / depth",
  chest_aspect: "Chest width / depth",
  shoulder_aspect: "Shoulder width / depth",
};

/** Values that are ratios, not cm (the torso's cross-section shape). */
export function isRatio(key: string): boolean {
  return key.endsWith("_aspect");
}

export const SECTION_TITLES: Record<InputSection, string> = {
  lengths: "Lengths",
  circumferences: "Circumferences",
  positions: "Positions",
  shape: "Shape",
};

/**
 * The line a step measures, in a schematic of the region drawn upright (t = 0 the region's start at
 * the bottom: wrist, ankle, waist; t = 1 its end at the top: shoulder point, hip crease, neck base).
 * A girth goes round the region at t; a length runs along it from t `from` to t `to`.
 */
export type Diagram =
  { kind: "girth"; at: number } | { kind: "length"; from: number; to: number } | { kind: "height" };

/** Landmarks marked in the schematic of a region kind, at their t. */
export const LANDMARKS: Record<RegionKind, { t: number; label: string }[]> = {
  arm: [
    { t: 0, label: "wrist crease" },
    { t: 0.45, label: "elbow tip" },
    { t: 1, label: "shoulder point" },
  ],
  leg: [
    { t: 0, label: "ankle" },
    { t: 0.51, label: "knee centre" },
    { t: 1, label: "hip crease" },
  ],
  torso: [
    { t: 0, label: "navel" },
    { t: 1, label: "neck base" },
  ],
};

/** Where each value sits in the schematic (t as in Diagram). */
const STATION_T: Record<string, number> = {
  wrist: 0.02,
  forearm_mid: 0.225,
  forearm_max: 0.36,
  elbow: 0.45,
  above_elbow: 0.53,
  biceps_mid: 0.72,
  armpit_level: 0.82,
  shoulder: 0.93,
  ankle: 0.02,
  calf_max: 0.36,
  below_knee: 0.42,
  knee: 0.51,
  above_knee: 0.6,
  thigh_mid: 0.75,
  thigh_top: 0.95,
  waist: 0.02,
  ribs: 0.29,
  chest: 0.63,
  shoulder_line: 0.9,
  neck_base: 0.99,
};

export type WizardStep = {
  /** An input key of the region, or "height_cm" for the optional body height. */
  key: string;
  label: string;
  instruction: string;
  diagram: Diagram;
};

const HEIGHT_STEP: WizardStep = {
  key: "height_cm",
  label: "Body height (optional)",
  instruction:
    "Stand barefoot against a wall, heels together, looking straight ahead. Mark the top of the head with a flat object held level and measure from the floor. Every value you skip is scaled to this height.",
  diagram: { kind: "height" },
};

type StepText = { key: string; instruction: string; diagram: Diagram };

const ARM_STEPS: StepText[] = [
  {
    key: "shoulder_to_elbow",
    instruction:
      "Arm hanging relaxed and straight, palm forward. Lay the tape along the outside of the arm from the shoulder point (the bony tip where the collarbone ends) to the elbow tip (the bony point at the back of the elbow). Tape on the skin, not pulled tight.",
    diagram: { kind: "length", from: 0.45, to: 1 },
  },
  {
    key: "elbow_to_wrist",
    instruction:
      "From the elbow tip along the outer edge of the forearm to the wrist crease (the skin fold between hand and forearm on the palm side).",
    diagram: { kind: "length", from: 0, to: 0.45 },
  },
  {
    key: "wrist",
    instruction:
      "Around the wrist at the wrist crease. Tape at right angles to the arm, snug on the skin without pressing in.",
    diagram: { kind: "girth", at: STATION_T.wrist! },
  },
  {
    key: "forearm_mid",
    instruction: "Around the forearm halfway between the wrist crease and the elbow tip.",
    diagram: { kind: "girth", at: STATION_T.forearm_mid! },
  },
  {
    key: "forearm_max",
    instruction: "Around the thickest part of the forearm, a few cm below the elbow. Muscles relaxed.",
    diagram: { kind: "girth", at: STATION_T.forearm_max! },
  },
  {
    key: "forearm_max_below_elbow",
    instruction: "Leave the tape from the last step in place: measure from the elbow tip down to it.",
    diagram: { kind: "length", from: STATION_T.forearm_max!, to: 0.45 },
  },
  {
    key: "elbow",
    instruction: "Around the elbow over the elbow tip, arm straight.",
    diagram: { kind: "girth", at: STATION_T.elbow! },
  },
  {
    key: "above_elbow",
    instruction: `Around the upper arm ${ABOVE_ELBOW_CM} cm above the elbow tip.`,
    diagram: { kind: "girth", at: STATION_T.above_elbow! },
  },
  {
    key: "biceps_mid",
    instruction:
      "Around the upper arm halfway between the elbow tip and the shoulder point. Relaxed, do not flex.",
    diagram: { kind: "girth", at: STATION_T.biceps_mid! },
  },
  {
    key: "armpit_level",
    instruction: "Around the upper arm at the height of the armpit fold.",
    diagram: { kind: "girth", at: STATION_T.armpit_level! },
  },
  {
    key: "armpit_level_below_shoulder",
    instruction: "From the shoulder point down the outside of the arm to the armpit-level tape.",
    diagram: { kind: "length", from: STATION_T.armpit_level!, to: 1 },
  },
  {
    key: "shoulder",
    instruction:
      "Around the deltoid, as high as the tape still sits level. Around the arm only, not the torso.",
    diagram: { kind: "girth", at: STATION_T.shoulder! },
  },
  {
    key: "shoulder_below_shoulder",
    instruction: "From the shoulder point down to the shoulder tape.",
    diagram: { kind: "length", from: STATION_T.shoulder!, to: 1 },
  },
];

const LEG_STEPS: StepText[] = [
  {
    key: "ankle_to_knee",
    instruction:
      "Stand straight, weight on both feet. Along the outside of the leg from just above the ankle bone to the knee centre (level with the middle of the kneecap). Tape on the skin, not pulled tight.",
    diagram: { kind: "length", from: 0, to: 0.51 },
  },
  {
    key: "knee_to_hip",
    instruction:
      "From the knee centre up the front of the thigh to the hip crease (the fold where the thigh meets the body at the front).",
    diagram: { kind: "length", from: 0.51, to: 1 },
  },
  {
    key: "ankle",
    instruction: "Around the leg just above the ankle bones, the narrowest point. Tape level and snug.",
    diagram: { kind: "girth", at: STATION_T.ankle! },
  },
  {
    key: "calf_max",
    instruction: "Around the thickest part of the calf. Relaxed, weight on both feet.",
    diagram: { kind: "girth", at: STATION_T.calf_max! },
  },
  {
    key: "calf_max_below_knee",
    instruction: "Leave the tape from the last step in place: measure from the knee centre down to it.",
    diagram: { kind: "length", from: STATION_T.calf_max!, to: 0.51 },
  },
  {
    key: "below_knee",
    instruction: `Around the leg ${BELOW_KNEE_CM} cm below the knee centre.`,
    diagram: { kind: "girth", at: STATION_T.below_knee! },
  },
  {
    key: "knee",
    instruction: "Around the knee over the middle of the kneecap, leg straight and relaxed.",
    diagram: { kind: "girth", at: STATION_T.knee! },
  },
  {
    key: "above_knee",
    instruction: `Around the thigh ${ABOVE_KNEE_CM} cm above the knee centre.`,
    diagram: { kind: "girth", at: STATION_T.above_knee! },
  },
  {
    key: "thigh_mid",
    instruction: "Around the thigh halfway between the knee centre and the hip crease. Relaxed.",
    diagram: { kind: "girth", at: STATION_T.thigh_mid! },
  },
  {
    key: "thigh_top",
    instruction: "Around the top of the thigh, as high as the tape still sits level below the crotch.",
    diagram: { kind: "girth", at: STATION_T.thigh_top! },
  },
  {
    key: "thigh_top_below_hip",
    instruction: "From the hip crease down the front of the thigh to the thigh-top tape.",
    diagram: { kind: "length", from: STATION_T.thigh_top!, to: 1 },
  },
];

const TORSO_STEPS: StepText[] = [
  {
    key: "waist_to_neck",
    instruction:
      "Stand straight, looking ahead. Down the front of the body from the base of the neck (the notch above the breastbone) to the waist line at navel height.",
    diagram: { kind: "length", from: 0, to: 1 },
  },
  {
    key: "waist",
    instruction: "Around the waist at navel height. Breathe out normally; do not pull the belly in.",
    diagram: { kind: "girth", at: STATION_T.waist! },
  },
  {
    key: "ribs",
    instruction: "Around the lowest ribs, just below the chest or bust. Breathe out normally.",
    diagram: { kind: "girth", at: STATION_T.ribs! },
  },
  {
    key: "waist_to_ribs",
    instruction: "At the front, from the waist line up to the rib tape.",
    diagram: { kind: "length", from: 0, to: STATION_T.ribs! },
  },
  {
    key: "chest",
    instruction:
      "Around the chest at the height of the armpits, arms hanging (lift them to place the tape, then lower them). Breathe normally.",
    diagram: { kind: "girth", at: STATION_T.chest! },
  },
  {
    key: "waist_to_chest",
    instruction: "At the front, from the waist line up to the chest tape.",
    diagram: { kind: "length", from: 0, to: STATION_T.chest! },
  },
  {
    key: "neck_base",
    instruction:
      "Around the base of the neck, where it meets the shoulders, over the notch above the breastbone.",
    diagram: { kind: "girth", at: STATION_T.neck_base! },
  },
  {
    key: "shoulder_line_below_neck",
    instruction:
      "How far the shoulder points (the bony tips where the collarbones end) sit below the neck base, measured straight down the front.",
    diagram: { kind: "length", from: STATION_T.shoulder_line!, to: 1 },
  },
];

const STEPS: Record<RegionKind, StepText[]> = { arm: ARM_STEPS, leg: LEG_STEPS, torso: TORSO_STEPS };

/**
 * Values the wizard leaves out because no tape gives them: the torso's shoulder line (the torso without
 * the arms) and its cross-section shape. They keep the sample's value unless edited in the form.
 */
export function untapedKeys(kind: RegionKind): string[] {
  const taped = new Set(STEPS[kind].map((s) => s.key));
  return inputKeys(kind).filter((k) => !taped.has(k));
}

/** The wizard's steps for a region: the optional body height, then its values in measuring order. */
export function wizardSteps(id: RegionId): WizardStep[] {
  const def = REGIONS[id];
  const side = def.side ? `${def.side} ` : "";
  const steps = STEPS[def.kind].map((s) => ({
    key: s.key,
    label: INPUT_LABELS[s.key] ?? s.key,
    // "the arm" → "the left arm" in the first mention, so it is clear which side to measure.
    instruction: side ? s.instruction.replace(/\bthe (arm|leg)\b/, `the ${side}$1`) : s.instruction,
    diagram: s.diagram,
  }));
  return [HEIGHT_STEP, ...steps];
}

/** General tips shown on the wizard's first step. */
export const WIZARD_TIPS = [
  "A soft tailor's tape and a second person help: most values cannot be taken one-handed.",
  "Circumferences: tape level, at right angles to the limb, snug without pressing in. Measure twice; if the two differ by more than 0.5 cm, measure a third time and take the middle value.",
  "Muscles relaxed throughout. Every step can be skipped; skipped values keep the sample body's.",
];
