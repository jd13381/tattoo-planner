// Where the regions sit in the body (docs/adr/0011): a relaxed A-pose, palms forward, and the parts
// nobody edits (head, neck, hands, feet, hips, shoulder joints) as simple neutral shapes.
//
// Body frame, cm: +Y up from the floor, +Z to the front (the body faces +Z), +X to the body's left.
// Region meshes are built in their own local frame (src/body/geometry.ts): +Y along the region from
// its start, X and Z already in the body's directions, so placing a region is a turn about Z (arms
// and legs spread away from the body) and a shift.
import type { LoftShape, RegionProfile } from "./profile.ts";
import { semiAxes } from "./ellipse.ts";
import type { RegionId } from "./regions.ts";
import type { BodyParams } from "./samples.ts";

export type Vec3 = [number, number, number];

/** Local → body: turn by `rotZ` (radians, counter-clockwise seen from the front) about Z, then shift. */
export type Placement = { origin: Vec3; rotZ: number };

export function applyPlacement(pl: Placement, p: Vec3): Vec3 {
  const c = Math.cos(pl.rotZ);
  const s = Math.sin(pl.rotZ);
  return [pl.origin[0] + p[0] * c - p[1] * s, pl.origin[1] + p[0] * s + p[1] * c, pl.origin[2] + p[2]];
}

/** Directions turn without the shift. */
export function applyRotation(pl: Placement, d: Vec3): Vec3 {
  const c = Math.cos(pl.rotZ);
  const s = Math.sin(pl.rotZ);
  return [d[0] * c - d[1] * s, d[0] * s + d[1] * c, d[2]];
}

/** A neutral shape: an ellipsoid with radii along its own axes, turned about Z like a region. */
export type NeutralPart = { name: string; centre: Vec3; radii: Vec3; rotZ: number };

/** A neutral loft (pelvis, neck) that continues a region's surface smoothly (docs/adr/0022). */
export type NeutralLoft = { name: string; shape: LoftShape; placement: Placement };

export type BodyLayout = {
  placements: Record<RegionId, Placement>;
  parts: NeutralPart[];
  /** Drawn in neutral skin like `parts`; their ends sit inside the neighbouring shapes. */
  lofts: NeutralLoft[];
  /** Axis-aligned bounds of the whole figure, for framing the camera. */
  bounds: { min: Vec3; max: Vec3 };
};

const DEG = Math.PI / 180;

/**
 * Places every region: legs stand on the floor, the pelvis sits on them, the torso on the pelvis; the
 * arms hang from the shoulder points, the head sits on the neck.
 */
export function layoutBody(params: BodyParams, regions: Record<RegionId, RegionProfile>): BodyLayout {
  const legLength = Math.max(regions["leg-left"].length, regions["leg-right"].length);
  // The legs spread a little, so they reach the floor a little lower than their length.
  const hipY = params.ankle_height + legLength * Math.cos(params.leg_abduction_deg * DEG);
  const waistY = hipY + params.pelvis_height;
  const torso = regions.torso;
  const neckY = waistY + torso.length;
  const shoulderY = waistY + (torso.stations.find((s) => s.label === "shoulder_line")?.s ?? torso.length);

  const arm = (id: "arm-left" | "arm-right", side: 1 | -1): Placement => {
    const p = regions[id];
    const rotZ = side * params.arm_abduction_deg * DEG;
    // The arm's end (the shoulder point) hangs a little inside the torso's outline, so the rounded end
    // reads as the shoulder; the joint sits half the upper arm's depth below the shoulder line.
    const top = semiAxes(p.circumferenceAt(p.length), p.aspectAt(p.length));
    const joint: Vec3 = [side * (params.shoulder_width / 2 - top.a * 0.35), shoulderY - top.b * 0.25, 0];
    return hangFrom(joint, p.length, rotZ);
  };
  const leg = (id: "leg-left" | "leg-right", side: 1 | -1): Placement => {
    const p = regions[id];
    const rotZ = side * params.leg_abduction_deg * DEG;
    return hangFrom([(side * params.hip_spacing) / 2, hipY, 0], p.length, rotZ);
  };

  const placements: Record<RegionId, Placement> = {
    "arm-left": arm("arm-left", 1),
    "arm-right": arm("arm-right", -1),
    "leg-left": leg("leg-left", 1),
    "leg-right": leg("leg-right", -1),
    torso: { origin: [0, waistY, 0], rotZ: 0 },
  };

  const parts: NeutralPart[] = [];
  const lofts: NeutralLoft[] = [];
  // Head and neck.
  const headY = neckY + params.neck_height + params.head_height / 2;
  parts.push({
    name: "head",
    centre: [0, headY, 0.5],
    radii: [params.head_width / 2, params.head_height / 2, params.head_depth / 2],
    rotZ: 0,
  });
  if (torso.kind === "torso" && torso.neck) {
    // The torso's surface continued above the neck base, into the head.
    lofts.push({ name: "neck", shape: torso.neck, placement: { origin: [0, neckY, 0], rotZ: 0 } });
  } else {
    const neck = semiAxes(torso.circumferenceAt(torso.length), torso.aspectAt(torso.length));
    parts.push({
      name: "neck",
      centre: [0, neckY + params.neck_height / 2 + 1, -0.5],
      radii: [neck.a * 0.85, params.neck_height / 2 + 3, neck.b * 0.85],
      rotZ: 0,
    });
  }
  // Hips and buttocks between the legs and the waist line.
  if (torso.kind === "torso" && torso.pelvis) {
    // The torso's surface continued below the waist line, down past the hip crease into the legs.
    const pelvis = torso.pelvis;
    lofts.push({
      name: "pelvis",
      shape: pelvis,
      placement: { origin: [0, waistY - pelvis.length, 0], rotZ: 0 },
    });
  } else {
    parts.push({
      name: "hips",
      // Reaches a few cm up into the torso, so no gap opens at the waist line.
      centre: [0, hipY + params.pelvis_height * 0.45, -0.8],
      radii: [params.hip_width / 2, params.pelvis_height * 0.85, params.hip_depth / 2],
      rotZ: 0,
    });
  }
  // Hands below the wrists, flat towards the front (palms forward); feet forward from the ankles.
  for (const [id, side] of [
    ["arm-left", 1],
    ["arm-right", -1],
  ] as const) {
    const pl = placements[id];
    const p = regions[id];
    const w = semiAxes(p.circumferenceAt(0), p.aspectAt(0));
    parts.push({
      name: `hand-${side > 0 ? "left" : "right"}`,
      centre: applyPlacement(pl, [0, -params.hand_length / 2 + 1, 0]),
      radii: [Math.max(params.hand_width / 2, w.a), params.hand_length / 2, w.b * 0.75],
      rotZ: pl.rotZ,
    });
    // The shoulder joint: fills the corner between the arm's rounded end and the torso.
    const top = semiAxes(p.circumferenceAt(p.length), p.aspectAt(p.length));
    parts.push({
      name: `shoulder-${side > 0 ? "left" : "right"}`,
      centre: applyPlacement(pl, [-side * top.a * 0.35, p.length - top.b * 0.3, 0]),
      radii: [top.a * 1.05, top.b * 1.1, top.b * 1.05],
      rotZ: pl.rotZ,
    });
  }
  for (const [id, side] of [
    ["leg-left", 1],
    ["leg-right", -1],
  ] as const) {
    const pl = placements[id];
    const ankle = applyPlacement(pl, [0, 0, 0]);
    parts.push({
      name: `foot-${side > 0 ? "left" : "right"}`,
      centre: [ankle[0], params.ankle_height * 0.55, params.foot_length * 0.28],
      radii: [params.foot_width / 2, params.ankle_height * 0.6, params.foot_length / 2],
      rotZ: 0,
    });
  }

  const min: Vec3 = [Infinity, 0, Infinity];
  const max: Vec3 = [-Infinity, headY + params.head_height / 2, -Infinity];
  const grow = (p: Vec3, r: number) => {
    for (const a of [0, 2] as const) {
      min[a] = Math.min(min[a], p[a] - r);
      max[a] = Math.max(max[a], p[a] + r);
    }
  };
  for (const id of Object.keys(placements) as RegionId[]) {
    const p = regions[id];
    const r = p.maxCircumference / Math.PI;
    grow(applyPlacement(placements[id], [0, 0, 0]), r);
    grow(applyPlacement(placements[id], [0, p.length, 0]), r);
  }
  for (const part of parts) grow(part.centre, Math.max(...part.radii));
  for (const loft of lofts) {
    const r = loft.shape.maxCircumference / Math.PI;
    grow(applyPlacement(loft.placement, [0, 0, 0]), r);
    grow(applyPlacement(loft.placement, [0, loft.shape.length, 0]), r);
  }
  return { placements, parts, lofts, bounds: { min, max } };
}

/** Places a region so that its end (local y = length) sits at `joint` and its start hangs below. */
function hangFrom(joint: Vec3, length: number, rotZ: number): Placement {
  // origin = joint − R(0, length, 0)
  return { origin: [joint[0] + length * Math.sin(rotZ), joint[1] - length * Math.cos(rotZ), joint[2]], rotZ };
}
