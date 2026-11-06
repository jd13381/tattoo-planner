// The editable body regions (docs/adr/0011): which loft kind each one is, which way its u turns, and the
// names of its centre lines and views. Plain data; geometry lives in profile.ts / geometry.ts and the
// placement in the body in placement.ts.
import type { RegionKind } from "./profile.ts";

/**
 * The two opposite centre lines (u) each kind of region is mainly looked at along: the texture centre
 * and the seam side on limbs, front and back on the torso (whose texture centre is a flank). The 2D
 * editor centres on them and the cm grid measures its lengthwise lines from them (src/render/cmGrid.ts).
 */
export const MAIN_LINES: Record<RegionKind, readonly [number, number]> = {
  arm: [0, 0.5],
  leg: [0, 0.5],
  torso: [0.25, 0.75],
};

export const REGION_IDS = ["arm-left", "arm-right", "leg-left", "leg-right", "torso"] as const;
export type RegionId = (typeof REGION_IDS)[number];

/** Where a layout without a `region` key belongs (every layout written before regions existed). */
export const DEFAULT_REGION: RegionId = "arm-left";

export type Side = "left" | "right" | null;

/** Names of the four centre lines at u = 0, 0.25, 0.5, 0.75, long and short. */
export type CentreLines = [string, string, string, string];

export type RegionDef = {
  id: RegionId;
  kind: RegionKind;
  side: Side;
  label: string;
  /**
   * Whether u grows to the right on the unwrap seen from outside (see RegionProfile.mirrored). It
   * follows from the u convention below: true when the line at u = 0.25 lies to the right of the
   * line at u = 0 for someone looking at the skin.
   */
  mirrored: boolean;
  /** Centre lines at u = 0, 0.25, 0.5 (the seam), 0.75. */
  lines: CentreLines;
  short: CentreLines;
  /** What the start (v = 0) and the end (v = 1) of the region are. */
  ends: [string, string];
};

const ARM_LINES: CentreLines = ["outer", "lateral", "inner", "medial"];
const LEG_LINES: CentreLines = ["front", "lateral", "back", "medial"];
const LIMB_SHORT: CentreLines = ["out", "lat", "in", "med"];

export const REGIONS: Record<RegionId, RegionDef> = {
  "arm-left": {
    id: "arm-left",
    kind: "arm",
    side: "left",
    label: "Left arm",
    mirrored: false,
    lines: ARM_LINES,
    short: LIMB_SHORT,
    ends: ["wrist", "shoulder"],
  },
  "arm-right": {
    id: "arm-right",
    kind: "arm",
    side: "right",
    label: "Right arm",
    mirrored: true,
    lines: ARM_LINES,
    short: LIMB_SHORT,
    ends: ["wrist", "shoulder"],
  },
  "leg-left": {
    id: "leg-left",
    kind: "leg",
    side: "left",
    label: "Left leg",
    mirrored: true,
    lines: LEG_LINES,
    short: ["fr", "lat", "bk", "med"],
    ends: ["ankle", "hip"],
  },
  "leg-right": {
    id: "leg-right",
    kind: "leg",
    side: "right",
    label: "Right leg",
    mirrored: false,
    lines: LEG_LINES,
    short: ["fr", "lat", "bk", "med"],
    ends: ["ankle", "hip"],
  },
  torso: {
    id: "torso",
    kind: "torso",
    side: null,
    label: "Torso",
    mirrored: true,
    lines: ["right flank", "front", "left flank", "back"],
    short: ["R", "fr", "L", "bk"],
    ends: ["waist", "neck"],
  },
};

export function isRegionId(x: unknown): x is RegionId {
  return typeof x === "string" && (REGION_IDS as readonly string[]).includes(x);
}

/** The region a layout belongs to. */
export function regionOf(layout: { region?: RegionId }): RegionId {
  return layout.region ?? DEFAULT_REGION;
}

/**
 * The lines the 2D editor can centre on: the texture centre (u = 0) and the seam side (u = 0.5) for
 * limbs; front and back for the torso, whose texture centre is a flank.
 */
export function editorCentres(id: RegionId): { u: number; label: string; title: string }[] {
  const def = REGIONS[id];
  return MAIN_LINES[def.kind].map((u) => {
    const i = Math.round(u * 4);
    return {
      u,
      label: cap(def.lines[i]!),
      title: `Centre the 2D editor on the ${def.lines[i]} line`,
    };
  });
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
