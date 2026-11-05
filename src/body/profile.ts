// A body region's profile along its axis: where each circumference sits, interpolated in between
// (docs/adr/0002, generalised to every region in docs/adr/0011). s is the distance from the region's
// start along its straight axis in cm (arm: 0 = wrist crease, length = shoulder point).
import { monotoneCubic } from "./interpolate.ts";
import type { ArmInputs, LegInputs, TorsoInputs } from "./inputs.ts";

export type Station = { label: string; s: number; circumference: number };

/** Kinds of region; every kind is a loft with its own stations, landmarks and conventions. */
export type RegionKind = "arm" | "leg" | "torso";

/** A cross-section aspect knot: width across / depth front to back at `s`. */
export type AspectKnot = { s: number; k: number };

/** The generic loft every region is built from: circumference and aspect along a straight axis. */
export type Loft = {
  /** Start to end of the region along its axis, cm. */
  length: number;
  stations: Station[];
  /** Largest circumference along the region; sets the width of the unwrap. */
  maxCircumference: number;
  circumferenceAt(s: number): number;
  /** Cross-section aspect ratio (width across / depth front to back) at s. */
  aspectAt(s: number): number;
  /** Station labels that had to be reordered because their positions overlap. */
  warnings: string[];
};

type ProfileBase = Loft & {
  /**
   * Whether u grows to the right on the unwrap seen from outside the skin (docs/adr/0011). False for
   * the left arm, whose unwrap puts lateral (u = 0.25) on the left; true for its mirror image, the
   * right arm, and for every region whose u convention turns the other way round (torso, left leg).
   */
  mirrored: boolean;
};

export type ArmProfile = ProfileBase & {
  kind: "arm";
  /** Distance of the elbow tip from the wrist crease, cm. */
  elbowAt: number;
};

export type LegProfile = ProfileBase & {
  kind: "leg";
  /** Distance of the knee centre (middle of the kneecap) from the ankle, cm. */
  kneeAt: number;
};

export type TorsoProfile = ProfileBase & {
  kind: "torso";
  /** Height of the lowest ribs (below the chest) above the waist line, cm. */
  ribsAt: number;
  /** Height of the chest line (at the armpits) above the waist line, cm. */
  chestAt: number;
};

export type RegionProfile = ArmProfile | LegProfile | TorsoProfile;

/**
 * Builds the loft from stations and aspect knots. Stations whose positions overlap are reported in
 * `warnings`, then sorted, so the mesh never folds over.
 */
export function buildLoft(length: number, raw: Station[], aspect: AspectKnot[]): Loft {
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
  const knots = aspect
    .map((k) => ({ x: Math.min(Math.max(k.s, 0), length), y: k.k }))
    .sort((p, q) => p.x - q.x)
    .filter((k, i, all) => i === 0 || k.x > all[i - 1]!.x + 1e-6);
  const aspectAt = monotoneCubic(knots);

  let maxCircumference = 0;
  for (let i = 0; i <= 200; i++)
    maxCircumference = Math.max(maxCircumference, circumferenceAt((length * i) / 200));

  return { length, stations, maxCircumference, circumferenceAt, aspectAt, warnings };
}

/** Above the elbow the tape is laid at a fixed distance (docs/measuring.md). */
export const ABOVE_ELBOW_CM = 5;

/**
 * Arm cross-section shape assumption: the wrist is clearly flatter than round, the upper arm nearly round.
 * Values are typical anatomy, not measured; refine if Jan's photos show otherwise.
 */
const ARM_ASPECT = { wrist: 1.4, forearm_mid: 1.2, elbow: 1.08, shoulder: 1.0 } as const;

/** The arm from wrist crease to shoulder point (docs/adr/0002). `mirrored` builds the right arm. */
export function buildProfile(m: ArmInputs, mirrored = false): ArmProfile {
  const elbowAt = m.elbow_to_wrist;
  const length = m.elbow_to_wrist + m.shoulder_to_elbow;
  const loft = buildLoft(
    length,
    [
      { label: "wrist", s: 0, circumference: m.wrist },
      { label: "forearm_mid", s: elbowAt / 2, circumference: m.forearm_mid },
      { label: "forearm_max", s: elbowAt - m.forearm_max_below_elbow, circumference: m.forearm_max },
      { label: "elbow", s: elbowAt, circumference: m.elbow },
      { label: "above_elbow", s: elbowAt + ABOVE_ELBOW_CM, circumference: m.above_elbow },
      { label: "biceps_mid", s: elbowAt + m.shoulder_to_elbow / 2, circumference: m.biceps_mid },
      { label: "armpit_level", s: length - m.armpit_level_below_shoulder, circumference: m.armpit_level },
      { label: "shoulder", s: length - m.shoulder_below_shoulder, circumference: m.shoulder },
    ],
    [
      { s: 0, k: ARM_ASPECT.wrist },
      { s: elbowAt / 2, k: ARM_ASPECT.forearm_mid },
      { s: elbowAt, k: ARM_ASPECT.elbow },
      { s: length, k: ARM_ASPECT.shoulder },
    ],
  );
  return { ...loft, kind: "arm", mirrored, elbowAt };
}

/** Below and above the knee the tape is laid at fixed distances from the knee centre. */
export const BELOW_KNEE_CM = 8;
export const ABOVE_KNEE_CM = 8;

/**
 * Leg cross-section shape assumption (typical anatomy, not measured): the ankle a little wider than
 * deep, calf and knee nearly round, the thigh round.
 */
const LEG_ASPECT = { ankle: 1.25, calf: 1.08, knee: 1.05, thigh: 1.0 } as const;

/** A leg from the ankle (just above the ankle bones) to the hip crease. `mirrored` for the left leg. */
export function buildLegProfile(m: LegInputs, mirrored = false): LegProfile {
  const kneeAt = m.ankle_to_knee;
  const length = m.ankle_to_knee + m.knee_to_hip;
  const calfAt = kneeAt - m.calf_max_below_knee;
  const loft = buildLoft(
    length,
    [
      { label: "ankle", s: 0, circumference: m.ankle },
      { label: "calf_max", s: calfAt, circumference: m.calf_max },
      { label: "below_knee", s: kneeAt - BELOW_KNEE_CM, circumference: m.below_knee },
      { label: "knee", s: kneeAt, circumference: m.knee },
      { label: "above_knee", s: kneeAt + ABOVE_KNEE_CM, circumference: m.above_knee },
      { label: "thigh_mid", s: kneeAt + m.knee_to_hip / 2, circumference: m.thigh_mid },
      { label: "thigh_top", s: length - m.thigh_top_below_hip, circumference: m.thigh_top },
    ],
    [
      { s: 0, k: LEG_ASPECT.ankle },
      { s: calfAt, k: LEG_ASPECT.calf },
      { s: kneeAt, k: LEG_ASPECT.knee },
      { s: length, k: LEG_ASPECT.thigh },
    ],
  );
  return { ...loft, kind: "leg", mirrored, kneeAt };
}

/** The neck is nearly round. */
const NECK_ASPECT = 1.1;

/**
 * The torso from the waist line (navel height) to the base of the neck. Its cross-section is much wider
 * than deep, flattest at the shoulder line, where it carries the arms. The aspect values are inputs
 * (the sample bodies set them, docs/adr/0011), since they differ more between bodies than an arm's.
 * Its u convention (0 right flank, 0.25 front) turns the other way round than the left arm's, so it is
 * always `mirrored`.
 */
export function buildTorsoProfile(m: TorsoInputs): TorsoProfile {
  const length = m.waist_to_neck;
  const ribsAt = m.waist_to_ribs;
  const chestAt = m.waist_to_chest;
  const shoulderAt = length - m.shoulder_line_below_neck;
  const loft = buildLoft(
    length,
    [
      { label: "waist", s: 0, circumference: m.waist },
      { label: "ribs", s: ribsAt, circumference: m.ribs },
      { label: "chest", s: chestAt, circumference: m.chest },
      { label: "shoulder_line", s: shoulderAt, circumference: m.shoulder_line },
      { label: "neck_base", s: length, circumference: m.neck_base },
    ],
    [
      { s: 0, k: m.waist_aspect },
      { s: chestAt, k: m.chest_aspect },
      { s: shoulderAt, k: m.shoulder_aspect },
      { s: length, k: NECK_ASPECT },
    ],
  );
  return { ...loft, kind: "torso", mirrored: true, ribsAt, chestAt };
}
