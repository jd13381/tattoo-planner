// Filtering for the asset browsers: by kind, tag and free text over id, notes and source; the
// sidebar sections of the Assets tab; what the image pickers offer (docs/adr/0020-asset-structure.md).
import { sectionCategories, type AssetCategory, type SectionId } from "./category.ts";
import { isInUse, type UsageMap } from "./references.ts";
import type { AssetInfo } from "./types.ts";

export type AssetFilter = { kind: string; tag: string; text: string };

export const NO_FILTER: AssetFilter = { kind: "", tag: "", text: "" };

export function filterAssets(assets: readonly AssetInfo[], f: AssetFilter): AssetInfo[] {
  const words = f.text.toLowerCase().split(/\s+/).filter(Boolean);
  return assets.filter((a) => {
    if (f.kind && a.kind !== f.kind) return false;
    if (f.tag && !a.tags.includes(f.tag)) return false;
    const hay = [a.id, a.notes ?? "", a.source ?? "", a.file, ...a.tags].join(" ").toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

/** Distinct values with counts, most frequent first, for the kind and tag pickers. */
export function facets(values: readonly string[]): { value: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

/** Assets offered for picking: hidden ones are left out, except the one in use (`keep`). */
export function pickableAssets(assets: readonly AssetInfo[], keep?: string): AssetInfo[] {
  return assets.filter((a) => !a.hidden || a.id === keep);
}

/** What decides which images a sidebar section of the Assets tab shows. */
export type SectionContext = {
  /** Null while the usage is loading: Unused is empty then. */
  usage: UsageMap | null;
  /** The current person: the person sections show only their photos. */
  person: string;
  showHidden: boolean;
};

export const SECTION_IDS: SectionId[] = [
  "all",
  "ideas",
  "studio",
  "backgrounds",
  "measuring",
  "existing",
  "unused",
  "hidden",
  "missing",
];

/** Whether an image belongs to a section, before the hidden rule. */
function belongs(a: AssetInfo, section: SectionId, ctx: SectionContext): boolean {
  switch (section) {
    case "all":
      return true;
    case "unused":
      return ctx.usage !== null && !isInUse(ctx.usage[a.id]);
    case "hidden":
      return a.hidden === true;
    case "missing":
      return !a.exists;
    case "measuring":
    case "existing":
      return a.effectiveCategory === section && a.effectivePerson === ctx.person;
    default:
      return sectionCategories(section)!.includes(a.effectiveCategory);
  }
}

/** The images of a sidebar section; hidden ones only in the Hidden album or with Show hidden. */
export function sectionAssets(
  assets: readonly AssetInfo[],
  section: SectionId,
  ctx: SectionContext,
): AssetInfo[] {
  return assets.filter(
    (a) => belongs(a, section, ctx) && (section === "hidden" || ctx.showHidden || !a.hidden),
  );
}

/** Image counts per section, as the sidebar shows them next to each name. */
export function sectionCounts(assets: readonly AssetInfo[], ctx: SectionContext): Record<SectionId, number> {
  return Object.fromEntries(SECTION_IDS.map((id) => [id, sectionAssets(assets, id, ctx).length])) as Record<
    SectionId,
    number
  >;
}

/** Images of a section that only "Show hidden" would reveal (for the "All N here are hidden" hint). */
export function hiddenInSection(
  assets: readonly AssetInfo[],
  section: SectionId,
  ctx: SectionContext,
): number {
  if (section === "hidden" || ctx.showHidden) return 0;
  return sectionAssets(assets, section, { ...ctx, showHidden: true }).filter((a) => a.hidden).length;
}

/** Library sections the image pickers offer by default; photos and backgrounds are opt-in. */
export type PickerScope = { photos?: boolean; backgrounds?: boolean };

const LIBRARY: AssetCategory[] = ["reference", "generated", "edit"];

/**
 * Images a picker offers: not hidden (except `keep`, the one in use), from the library (ideas and
 * studio images), plus backgrounds and photos when asked for. `keep` is always offered.
 */
export function pickerAssets(
  assets: readonly AssetInfo[],
  scope: PickerScope = {},
  keep?: string,
): AssetInfo[] {
  const cats = new Set<AssetCategory>([
    ...LIBRARY,
    ...(scope.backgrounds ? (["background"] as const) : []),
    ...(scope.photos ? (["measuring", "existing"] as const) : []),
  ]);
  return pickableAssets(assets, keep).filter((a) => a.id === keep || cats.has(a.effectiveCategory));
}

/** How many images only "Show photos" would add to a picker. */
export function photoCount(assets: readonly AssetInfo[]): number {
  return pickableAssets(assets).filter(
    (a) => a.effectiveCategory === "measuring" || a.effectiveCategory === "existing",
  ).length;
}
