// "Where was the camera?" in the projection workspace (docs/adr/0014, simplified in docs/adr/0023): the
// four sides of a body part in plain words, and where each lies on a small picture of the person seen
// from above. No DOM; SidePicker.tsx draws the picture and the choices.
//
// The picture shows the person from above, facing the viewer (front at the bottom), so their left is on
// the right of the picture, as with someone standing in front of you. Arms hang with the palms forward,
// so the arm's inner side faces the front, its thumb side points away from the body.
import { REGIONS, type RegionId } from "../body/regions.ts";
import { wrapU } from "../body/uv.ts";

/** Body directions on the picture, as angles in degrees (0 = right, 90 = down = the person's front). */
type Direction = "front" | "back" | "left" | "right" | "out" | "in";

/** Which way each centre line (u = 0, 0.25, 0.5, 0.75) of a region kind points on the body. */
const LINE_DIRECTIONS = {
  arm: ["back", "out", "front", "in"],
  leg: ["front", "out", "back", "in"],
  torso: ["right", "front", "left", "back"],
} as const satisfies Record<string, readonly [Direction, Direction, Direction, Direction]>;

/** Plain names of the four sides, in the order of the centre lines. */
const SIDE_LABELS: Record<"arm" | "leg" | "torso", readonly [SideText, SideText, SideText, SideText]> = {
  arm: [
    { label: "Outer side", hint: "back of the hand" },
    { label: "Thumb side", hint: "away from the body" },
    { label: "Inner side", hint: "palm side" },
    { label: "Little-finger side", hint: "towards the body" },
  ],
  leg: [
    { label: "Front", hint: "shin and knee" },
    { label: "Outer side", hint: "away from the other leg" },
    { label: "Back", hint: "calf and back of the knee" },
    { label: "Inner side", hint: "towards the other leg" },
  ],
  torso: [
    { label: "Right side", hint: "right flank" },
    { label: "Front", hint: "chest and belly" },
    { label: "Left side", hint: "left flank" },
    { label: "Back", hint: "" },
  ],
};

type SideText = { label: string; hint: string };

export type SideChoice = SideText & {
  /** The u facing the camera when the photo shows this side straight on. */
  u: number;
  /** Where the camera stands on the picture, degrees (0 = right, 90 = down). */
  angle: number;
};

function directionAngle(dir: Direction, region: RegionId): number {
  const side = REGIONS[region].side;
  // Out: away from the middle of the body, which is on the right of the picture for the left side.
  const outAngle = side === "right" ? 180 : 0;
  switch (dir) {
    case "front":
      return 90;
    case "back":
      return 270;
    case "left":
      return 0;
    case "right":
      return 180;
    case "out":
      return outAngle;
    case "in":
      return (outAngle + 180) % 360;
  }
}

/** The four sides of the region with their u and their place on the picture. */
export function sideChoices(region: RegionId): SideChoice[] {
  const kind = REGIONS[region].kind;
  return LINE_DIRECTIONS[kind].map((dir, k) => ({
    ...SIDE_LABELS[kind][k]!,
    u: k / 4,
    angle: directionAngle(dir, region),
  }));
}

/** +1 when the picture angle grows with u, -1 when it shrinks (the centre lines are a quarter apart). */
function turnSense(region: RegionId): 1 | -1 {
  const [a, b] = sideChoices(region);
  const d = ((((b!.angle - a!.angle) % 360) + 540) % 360) - 180;
  return d > 0 ? 1 : -1;
}

/** Where the camera stands on the picture for a facing u, degrees 0..360. */
export function cameraAngle(region: RegionId, u: number): number {
  const a0 = sideChoices(region)[0]!.angle;
  const deg = a0 + turnSense(region) * wrapU(u) * 360;
  return ((deg % 360) + 360) % 360;
}

/** The facing u for a camera standing at `angle` degrees on the picture (0..1). */
export function facingAtAngle(region: RegionId, angle: number): number {
  const a0 = sideChoices(region)[0]!.angle;
  const u = (turnSense(region) * (angle - a0)) / 360;
  return round4(wrapU(u));
}

/**
 * A facing as the nearest of the four sides plus a small turn: `offset` is in quarter turns' units of
 * u (-0.125 … 0.125), positive towards the next side in u.
 */
export function splitFacing(u: number): { main: number; offset: number } {
  const w = wrapU(u);
  const main = wrapU(Math.round(w * 4) / 4);
  let offset = w - main;
  if (offset > 0.5) offset -= 1;
  if (offset < -0.5) offset += 1;
  return { main, offset: round4(offset) };
}

/** Facing from a side and a turn (`splitFacing`'s inverse). */
export function joinFacing(main: number, offset: number): number {
  return round4(wrapU(main + offset));
}

/** The side whose camera position is within `snapDeg` of `angle`, else the free angle's facing. */
export function snapFacing(region: RegionId, angle: number, snapDeg = 6): number {
  for (const s of sideChoices(region)) {
    const d = Math.abs(((((angle - s.angle) % 360) + 540) % 360) - 180);
    if (d <= snapDeg) return s.u;
  }
  return facingAtAngle(region, angle);
}

/** The side a facing is closest to, and how far (in degrees) the camera is turned from it. */
export function describeFacing(region: RegionId, u: number): { side: SideChoice; turnDeg: number } {
  const { main, offset } = splitFacing(u);
  const side = sideChoices(region).find((s) => Math.abs(s.u - main) < 1e-9)!;
  return { side, turnDeg: Math.round(offset * 360) };
}

/** The two neighbours of a side, in the order of decreasing and increasing u. */
export function neighbours(region: RegionId, main: number): [SideChoice, SideChoice] {
  const sides = sideChoices(region);
  const k = Math.round(wrapU(main) * 4) % 4;
  return [sides[(k + 3) % 4]!, sides[(k + 1) % 4]!];
}

const round4 = (x: number) => Math.round(x * 10000) / 10000;
