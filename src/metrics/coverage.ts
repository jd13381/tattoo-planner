// Coverage metrics (PROJECT_BRIEF.md §10.1 F7): share of skin per element type and zone.
import type { ArmProfile } from "../arm/profile.ts";
import { wrapU } from "../arm/uv.ts";
import type { ElementType } from "../layout/schema.ts";
import { OUTSIDE, type Classification } from "../layout/shapes.ts";

export type ZoneId = "forearm-inner" | "forearm-outer" | "elbow" | "upper-inner" | "upper-outer" | "shoulder";

export const ZONES: { id: ZoneId; label: string }[] = [
  { id: "forearm-inner", label: "Forearm inner" },
  { id: "forearm-outer", label: "Forearm outer" },
  { id: "elbow", label: "Elbow" },
  { id: "upper-inner", label: "Upper arm inner" },
  { id: "upper-outer", label: "Upper arm outer" },
  { id: "shoulder", label: "Shoulder" },
];

/** Zone borders along the arm, relative to the elbow tip and the shoulder point (cm). */
export const ELBOW_BELOW_CM = 4;
export const ELBOW_ABOVE_CM = 6;
export const SHOULDER_ZONE_CM = 8;

/** Inner half = u in [0.25, 0.75), the half around the palm-side centre line. */
export function zoneOf(profile: ArmProfile, u: number, y: number): ZoneId {
  const inner = wrapU(u) >= 0.25 && wrapU(u) < 0.75;
  if (y >= profile.length - SHOULDER_ZONE_CM) return "shoulder";
  if (y >= profile.elbowAt - ELBOW_BELOW_CM && y < profile.elbowAt + ELBOW_ABOVE_CM) return "elbow";
  if (y < profile.elbowAt) return inner ? "forearm-inner" : "forearm-outer";
  return inner ? "upper-inner" : "upper-outer";
}

export type Category = ElementType | "open";
export const CATEGORIES: Category[] = ["figure", "existing", "filler", "band", "line", "open"];

export type ZoneCoverage = { area: number; byCategory: Record<Category, number> };
export type Coverage = { total: ZoneCoverage; zones: Record<ZoneId, ZoneCoverage> };

const empty = (): ZoneCoverage => ({
  area: 0,
  byCategory: { figure: 0, existing: 0, filler: 0, band: 0, line: 0, open: 0 },
});

/** Areas in cm² of the topmost category, per zone and in total. */
export function coverage(cls: Classification, profile: ArmProfile): Coverage {
  const zones = Object.fromEntries(ZONES.map((z) => [z.id, empty()])) as Record<ZoneId, ZoneCoverage>;
  const total = empty();
  const cell = 1 / (cls.pxPerCm * cls.pxPerCm);
  for (let j = 0; j < cls.height; j++) {
    const y = profile.length - (j + 0.5) / cls.pxPerCm;
    const c = profile.circumferenceAt(y);
    for (let i = 0; i < cls.width; i++) {
      const value = cls.cells[j * cls.width + i]!;
      if (value === OUTSIDE) continue;
      const x = -((i + 0.5) / cls.pxPerCm - profile.maxCircumference / 2);
      const cat: Category = value === 0 ? "open" : cls.resolved[value - 1]!.element.type;
      const zone = zones[zoneOf(profile, cls.centerU + x / c, y)];
      zone.area += cell;
      zone.byCategory[cat] += cell;
      total.area += cell;
      total.byCategory[cat] += cell;
    }
  }
  return { total, zones };
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
  const pick = (c: Coverage, k: ZoneKey) => (k === "total" ? c.total : c.zones[k]);
  const keys: ZoneKey[] = [...ZONES.map((z) => z.id), "total"];
  return Object.fromEntries(
    keys.map((k) => [
      k,
      Object.fromEntries(
        CATEGORIES.map((c) => [c, sharePct(pick(other, k), c) - sharePct(pick(self, k), c)]),
      ),
    ]),
  ) as CoverageDelta;
}
