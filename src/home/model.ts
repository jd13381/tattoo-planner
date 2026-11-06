// What Home shows (docs/adr/0018-home.md): for the current person, each region's active layout
// variant with a few numbers. Framework-free; the page (HomePage.tsx) only draws it.
import type { RegionProfile } from "../body/profile.ts";
import { REGION_IDS, type RegionId } from "../body/regions.ts";
import type { Layout } from "../layout/schema.ts";
import { classify, type ExistingSize } from "../layout/shapes.ts";
import { layoutRegion, parseLayout } from "../layout/yamlDoc.ts";
import { coverage, sharePct } from "../metrics/coverage.ts";
import { activeVariant, type ActiveMap } from "../project/persons.ts";

/** Coarse raster for the cards: whole percents only need a few pixels per cm. */
const STATS_PX_PER_CM = 2;

export type RegionStats = {
  /** Skin covered by anything (figures, existing tattoos, fillers, bands, lines), whole percent. */
  coveragePct: number;
  /** Figures and existing tattoos. */
  motifs: number;
  elements: number;
};

export type HomeRegion = {
  id: RegionId;
  /** The active variant's name, null when the region has no layout. */
  variant: string | null;
  /** How many variants the region has. */
  variants: number;
  /** Whether the active variant was marked (false: the first variant, by default). */
  marked: boolean;
  /** The parsed layout; null without one or when the file has errors (`error`). */
  layout: Layout | null;
  error: string | null;
};

/** Each region's active variant from the person's layout files. */
export function homeRegions(
  files: readonly { name: string; text: string }[],
  active: ActiveMap,
): HomeRegion[] {
  const variants = files.map((f) => ({ name: f.name, region: layoutRegion(f.text), text: f.text }));
  return REGION_IDS.map((id) => {
    const name = activeVariant(id, variants, active);
    const file = variants.find((v) => v.name === name);
    const parsed = file ? parseLayout(file.text) : null;
    return {
      id,
      variant: name,
      variants: variants.filter((v) => v.region === id).length,
      marked: name !== null && active[id] === name,
      layout: parsed?.ok ? parsed.layout : null,
      error: parsed && !parsed.ok ? parsed.error : null,
    };
  });
}

/** Coverage and counts of one layout on its region (images at their default aspect). */
export function regionStats(layout: Layout, profile: RegionProfile, existing?: ExistingSize): RegionStats {
  const c = coverage(classify(layout, profile, STATS_PX_PER_CM, existing), profile);
  return {
    coveragePct: c.total.area > 0 ? 100 - sharePct(c.total, "open") : 0,
    motifs: layout.elements.filter((e) => e.type === "figure" || e.type === "existing").length,
    elements: layout.elements.length,
  };
}

/** A line under the person's name: "3 of 5 regions planned". */
export function plannedSummary(regions: readonly HomeRegion[]): string {
  const planned = regions.filter((r) => r.layout && r.layout.elements.length > 0).length;
  if (planned === 0) return "Nothing planned yet";
  return `${planned} of ${regions.length} regions planned`;
}
