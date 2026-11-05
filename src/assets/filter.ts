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

/** Assets offered for picking: hidden ones are left out, except the one in use (`keep`). */
export function pickableAssets(assets: readonly AssetInfo[], keep?: string): AssetInfo[] {
  return assets.filter((a) => !a.hidden || a.id === keep);
}

/**
 * The asset `dir` steps before (-1) or after (+1) `current` among the pickable images of the same
 * kind (manifest order, wrapping round), for the quick previous / next arrows. Without a current
 * asset, `kind` (else the first image's kind) picks the list. Null when there is nothing to step to.
 */
export function stepAsset(
  assets: readonly AssetInfo[],
  current: string | undefined,
  dir: 1 | -1,
  kind?: string,
): AssetInfo | null {
  const now = current ? assets.find((a) => a.id === current) : undefined;
  const k = now?.kind ?? kind;
  const list = pickableAssets(assets, current).filter((a) => a.exists && (k === undefined || a.kind === k));
  if (list.length === 0) return null;
  const i = now ? list.findIndex((a) => a.id === now.id) : -1;
  if (i < 0) return dir === 1 ? list[0]! : list[list.length - 1]!;
  if (list.length === 1) return null;
  return list[(i + dir + list.length) % list.length]!;
}
