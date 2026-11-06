// A body region's profile along its axis: where each circumference sits, interpolated in between
// (docs/adr/0002, generalised to every region in docs/adr/0011). s is the distance from the region's
// start along its straight axis in cm (arm: 0 = wrist crease, length = shoulder point).
import { ellipsePerimeter } from "./ellipse.ts";
import { monotoneCubic, type Knot } from "./interpolate.ts";
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

/** What the mesh builder needs: a loft, the kind (its u = 0 line and end caps) and its u direction. */
export type LoftShape = Loft & { kind: RegionKind; mirrored: boolean };

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
  /**
   * Neutral lofts that continue the torso below the waist (the pelvis, to just below the hip crease)
   * and above the neck base (the neck), built from the same curves as the torso, so the surface runs on
   * through the region's ends without a step in slope (docs/adr/0022). Only with a `TorsoSurround`.
   */
  pelvis?: LoftShape;
  neck?: LoftShape;
};

export type RegionProfile = ArmProfile | LegProfile | TorsoProfile;

/** Circumference and aspect knots beyond a loft's ends: they shape the slopes at the ends only. */
export type OutsideKnots = { circumference?: Knot[]; aspect?: Knot[] };

/**
 * A smooth curve through the knots, evaluated on [from, to] (docs/adr/0022). Where no knot sits at or
 * beyond an end, the value stays constant from the outermost knot to that end and the curve arrives
 * there flat, so the surface has no kink at that station.
 */
function curve(knots: Knot[], from: number, to: number): (s: number) => number {
  const pts = [...knots]
    .sort((p, q) => p.x - q.x)
    // Equal positions would make the interpolation divide by zero: keep the first.
    .filter((k, i, all) => i === 0 || k.x > all[i - 1]!.x + 1e-6);
  const first = pts[0]!.x;
  const last = pts[pts.length - 1]!.x;
  const f = monotoneCubic(pts, {
    startSlope: first > from + 1e-6 ? 0 : undefined,
    endSlope: last < to - 1e-6 ? 0 : undefined,
  });
  return (s) => f(Math.min(Math.max(s, from), to));
}

/** A loft over [0, length] from plain knots, which may reach beyond the ends. */
function loftFromKnots(length: number, circumference: Knot[], aspect: Knot[]) {
  const circumferenceAt = curve(circumference, 0, length);
  const aspectAt = curve(aspect, 0, length);
  // The curve never overshoots its knots, so its largest value inside is at a knot or at an end.
  let maxCircumference = Math.max(circumferenceAt(0), circumferenceAt(length));
  for (const k of circumference)
    if (k.x >= 0 && k.x <= length) maxCircumference = Math.max(maxCircumference, k.y);
  return { length, maxCircumference, circumferenceAt, aspectAt };
}

/**
 * Builds the loft from stations and aspect knots. Stations whose positions overlap are reported in
 * `warnings`, then sorted, so the mesh never folds over. `outside` knots lie beyond the region's ends
 * (the pelvis below the torso, the neck above it) and only shape the curves' slopes at the ends.
 */
export function buildLoft(
  length: number,
  raw: Station[],
  aspect: AspectKnot[],
  outside: OutsideKnots = {},
): Loft {
  const warnings: string[] = [];
  for (let i = 1; i < raw.length; i++) {
    if (raw[i]!.s <= raw[i - 1]!.s) warnings.push(`${raw[i]!.label} sits at or below ${raw[i - 1]!.label}`);
  }
  const stations = raw
    .map((st) => ({ ...st, s: Math.min(Math.max(st.s, 0), length) }))
    .sort((p, q) => p.s - q.s)
    // Equal positions would make the interpolation divide by zero: keep the first.
    .filter((st, i, all) => i === 0 || st.s > all[i - 1]!.s + 1e-6);
  const beyond = (k: Knot) => k.x < -1e-6 || k.x > length + 1e-6;
  const circumference = [
    ...stations.map((st) => ({ x: st.s, y: st.circumference })),
    ...(outside.circumference ?? []).filter(beyond),
  ];
  const aspectKnots = [
    ...aspect.map((k) => ({ x: Math.min(Math.max(k.s, 0), length), y: k.k })),
    ...(outside.aspect ?? []).filter(beyond),
  ];
  return { ...loftFromKnots(length, circumference, aspectKnots), stations, warnings };
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
 * The neutral body around the torso (docs/adr/0022), from the body parameters: the hips' widest section
 * below the waist and the neck above the neck base.
 */
export type TorsoSurround = {
  /** Waist line down to the hip crease (where the legs start), cm. */
  pelvisHeight: number;
  /** Widest width and depth of the hips and buttocks, cm. */
  hipWidth: number;
  hipDepth: number;
  /** Neck base up to the head, cm. */
  neckHeight: number;
};

/** Where the hips are widest below the waist line, as a fraction of the pelvis height. */
const HIP_WIDEST = 0.55;
/** The pelvis ends this far below the hip crease (fraction of the pelvis height), then rounds off. */
const PELVIS_BELOW_CREASE = 0.15;
/** Circumference at the bottom of the pelvis (of the hips') and at the top of the neck (of the base). */
const PELVIS_BOTTOM = 0.8;
const NECK_TOP = 0.9;
/** The neck reaches this far into the head, cm. */
const NECK_INTO_HEAD = 2;

/**
 * The torso from the waist line (navel height) to the base of the neck. Its cross-section is much wider
 * than deep, flattest at the shoulder line, where it carries the arms. The aspect values are inputs
 * (the sample bodies set them, docs/adr/0011), since they differ more between bodies than an arm's.
 * Its u convention (0 right flank, 0.25 front) turns the other way round than the left arm's, so it is
 * always `mirrored`. With a `surround`, its curves run on into a neutral pelvis and neck.
 */
export function buildTorsoProfile(m: TorsoInputs, surround?: TorsoSurround): TorsoProfile {
  const length = m.waist_to_neck;
  const ribsAt = m.waist_to_ribs;
  const chestAt = m.waist_to_chest;
  const shoulderAt = length - m.shoulder_line_below_neck;
  const stations: Station[] = [
    { label: "waist", s: 0, circumference: m.waist },
    { label: "ribs", s: ribsAt, circumference: m.ribs },
    { label: "chest", s: chestAt, circumference: m.chest },
    { label: "shoulder_line", s: shoulderAt, circumference: m.shoulder_line },
    { label: "neck_base", s: length, circumference: m.neck_base },
  ];
  const aspect: AspectKnot[] = [
    { s: 0, k: m.waist_aspect },
    { s: chestAt, k: m.chest_aspect },
    { s: shoulderAt, k: m.shoulder_aspect },
    { s: length, k: NECK_ASPECT },
  ];
  if (!surround) {
    return { ...buildLoft(length, stations, aspect), kind: "torso", mirrored: true, ribsAt, chestAt };
  }

  const hipAt = -HIP_WIDEST * surround.pelvisHeight;
  const bottomAt = -(1 + PELVIS_BELOW_CREASE) * surround.pelvisHeight;
  const hipCircumference = ellipsePerimeter(surround.hipWidth / 2, surround.hipDepth / 2);
  const hipAspect = surround.hipWidth / surround.hipDepth;
  const neckTopAt = length + surround.neckHeight + NECK_INTO_HEAD;
  const outside = {
    circumference: [
      { x: bottomAt, y: PELVIS_BOTTOM * hipCircumference },
      { x: hipAt, y: hipCircumference },
      { x: neckTopAt, y: NECK_TOP * m.neck_base },
    ],
    aspect: [
      { x: bottomAt, y: hipAspect },
      { x: hipAt, y: hipAspect },
      { x: neckTopAt, y: NECK_ASPECT },
    ],
  };
  const loft = buildLoft(length, stations, aspect, outside);
  // Pelvis and neck run through every knot (the torso's own among them), shifted into their own frame,
  // so their curves are the torso's curves continued.
  const neutral = (len: number, shift: number): LoftShape => {
    const circumference = [
      ...loft.stations.map((st) => ({ x: st.s + shift, y: st.circumference })),
      ...outside.circumference.map((k) => ({ x: k.x + shift, y: k.y })),
    ];
    const k = [
      ...aspect.map((a) => ({ x: a.s + shift, y: a.k })),
      ...outside.aspect.map((a) => ({ x: a.x + shift, y: a.y })),
    ];
    return {
      ...loftFromKnots(len, circumference, k),
      stations: [],
      warnings: [],
      kind: "torso",
      mirrored: true,
    };
  };
  return {
    ...loft,
    kind: "torso",
    mirrored: true,
    ribsAt,
    chestAt,
    pelvis: neutral(-bottomAt, -bottomAt),
    neck: neutral(neckTopAt - length, -length),
  };
}
