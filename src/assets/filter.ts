// Filtering for the asset browser: by kind, by tag and by free text over id, notes and source.
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
