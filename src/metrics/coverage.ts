// Coverage metrics (PROJECT_BRIEF.md §10.1 F7): share of skin per element type and zone.
import type { RegionKind, RegionProfile } from "../body/profile.ts";
import { screenSign, wrapU } from "../body/uv.ts";
import type { ElementType } from "../layout/schema.ts";
import { BACKGROUND, OUTSIDE, type Classification } from "../layout/shapes.ts";

export type ArmZoneId =
  "forearm-inner" | "forearm-outer" | "elbow" | "upper-inner" | "upper-outer" | "shoulder";
export type LegZoneId = "shin" | "calf" | "knee" | "thigh-front" | "thigh-back";
export type TorsoZoneId = "chest" | "stomach" | "back-upper" | "back-lower" | "flanks";
export type ZoneId = ArmZoneId | LegZoneId | TorsoZoneId;

/** Zones per region kind (docs/adr/0011), in table order. */
export const ZONES_BY_KIND: { [K in RegionKind]: { id: ZoneId; label: string }[] } = {
  arm: [
    { id: "forearm-inner", label: "Forearm inner" },
    { id: "forearm-outer", label: "Forearm outer" },
    { id: "elbow", label: "Elbow" },
    { id: "upper-inner", label: "Upper arm inner" },
    { id: "upper-outer", label: "Upper arm outer" },
    { id: "shoulder", label: "Shoulder" },
  ],
  leg: [
    { id: "shin", label: "Shin" },
    { id: "calf", label: "Calf" },
    { id: "knee", label: "Knee" },
    { id: "thigh-front", label: "Thigh front" },
    { id: "thigh-back", label: "Thigh back" },
  ],
  torso: [
    { id: "chest", label: "Chest" },
    { id: "stomach", label: "Stomach" },
    { id: "back-upper", label: "Upper back" },
    { id: "back-lower", label: "Lower back" },
    { id: "flanks", label: "Flanks" },
  ],
};

/** The arm's zones (the zones every layout had before regions). */
export const ZONES = ZONES_BY_KIND.arm;

/** Zone borders along the arm, relative to the elbow tip and the shoulder point (cm). */
export const ELBOW_BELOW_CM = 4;
export const ELBOW_ABOVE_CM = 6;
export const SHOULDER_ZONE_CM = 8;
/** The knee zone, relative to the knee centre (cm). */
export const KNEE_BELOW_CM = 5;
export const KNEE_ABOVE_CM = 6;
/** Flanks: this share of the circumference either side of each flank line (about 7 cm on 100 cm). */
export const FLANK_HALF_U = 0.07;

/**
 * Arms: inner half = u in [0.25, 0.75), the half around the palm-side centre line. Legs: front half
 * = the half around the shin line (u = 0). Torso: front around u = 0.25, back around 0.75, the flanks
 * around 0 and 0.5; chest and upper back above the lowest ribs.
 */
export function zoneOf(profile: RegionProfile, u: number, y: number): ZoneId {
  const w = wrapU(u);
  switch (profile.kind) {
    case "arm": {
      const inner = w >= 0.25 && w < 0.75;
      if (y >= profile.length - SHOULDER_ZONE_CM) return "shoulder";
      if (y >= profile.elbowAt - ELBOW_BELOW_CM && y < profile.elbowAt + ELBOW_ABOVE_CM) return "elbow";
      if (y < profile.elbowAt) return inner ? "forearm-inner" : "forearm-outer";
      return inner ? "upper-inner" : "upper-outer";
    }
    case "leg": {
      const back = w >= 0.25 && w < 0.75;
      if (y >= profile.kneeAt - KNEE_BELOW_CM && y < profile.kneeAt + KNEE_ABOVE_CM) return "knee";
      if (y < profile.kneeAt) return back ? "calf" : "shin";
      return back ? "thigh-back" : "thigh-front";
    }
    case "torso": {
      const toFlank = Math.min(w, Math.abs(w - 0.5), 1 - w);
      if (toFlank < FLANK_HALF_U) return "flanks";
      const front = w < 0.5;
      const high = y >= profile.ribsAt;
      return front ? (high ? "chest" : "stomach") : high ? "back-upper" : "back-lower";
    }
  }
}

/** "background": skin covered only by a background layer (docs/adr/0019; fillers before). */
export type Category = ElementType | "background" | "open";
export const CATEGORIES: Category[] = ["figure", "existing", "background", "band", "line", "open"];

export type ZoneCoverage = { area: number; byCategory: Record<Category, number> };
export type Coverage = {
  kind: RegionKind;
  total: ZoneCoverage;
  /** Every zone of the region kind (ZONES_BY_KIND[kind]). */
  zones: Partial<Record<ZoneId, ZoneCoverage>>;
};

/** A zone's coverage; empty for a zone the region does not have. */
export function zoneCoverage(c: Coverage, id: ZoneId): ZoneCoverage {
  return c.zones[id] ?? empty();
}

const empty = (): ZoneCoverage => ({
  area: 0,
  byCategory: { figure: 0, existing: 0, background: 0, band: 0, line: 0, open: 0 },
});

/** Areas in cm² of the topmost category, per zone and in total. */
export function coverage(cls: Classification, profile: RegionProfile): Coverage {
  const zones = Object.fromEntries(ZONES_BY_KIND[profile.kind].map((z) => [z.id, empty()])) as Record<
    ZoneId,
    ZoneCoverage
  >;
  const sign = screenSign(profile);
  const total = empty();
  const cell = 1 / (cls.pxPerCm * cls.pxPerCm);
  for (let j = 0; j < cls.height; j++) {
    const y = profile.length - (j + 0.5) / cls.pxPerCm;
    const c = profile.circumferenceAt(y);
    for (let i = 0; i < cls.width; i++) {
      const value = cls.cells[j * cls.width + i]!;
      if (value === OUTSIDE) continue;
      // Screen x from the centre line, turned into the direction u grows.
      const x = sign * ((i + 0.5) / cls.pxPerCm - profile.maxCircumference / 2);
      const cat: Category =
        value === 0 ? "open" : value === BACKGROUND ? "background" : cls.resolved[value - 1]!.element.type;
      const zone = zones[zoneOf(profile, cls.centerU + x / c, y)];
      zone.area += cell;
      zone.byCategory[cat] += cell;
      total.area += cell;
      total.byCategory[cat] += cell;
    }
  }
  return { kind: profile.kind, total, zones };
}

/** Share of a zone's skin taken by a category, in whole percent (as the coverage table shows it). */
export function sharePct(z: ZoneCoverage, c: Category): number {
  return z.area > 0 ? Math.round((100 * z.byCategory[c]) / z.area) : 0;
}

/** Percentage points from which the comparison highlights a difference. */
export const DIFF_THRESHOLD_PCT = 2;

export type ZoneKey = ZoneId | "total";
export type CoverageDelta = Record<ZoneKey, Record<Category, number>>;

/** Per zone and category: other − this, in whole percentage points (both rounded first, as shown). */
export function coverageDelta(self: Coverage, other: Coverage): CoverageDelta {
  const pick = (c: Coverage, k: ZoneKey) => (k === "total" ? c.total : zoneCoverage(c, k));
  const keys: ZoneKey[] = [...ZONES_BY_KIND[self.kind].map((z) => z.id), "total"];
  return Object.fromEntries(
    keys.map((k) => [
      k,
      Object.fromEntries(
        CATEGORIES.map((c) => [c, sharePct(pick(other, k), c) - sharePct(pick(self, k), c)]),
      ),
    ]),
  ) as CoverageDelta;
}
