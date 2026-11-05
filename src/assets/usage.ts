// Where each asset is used: which elements of which saved layout show it. Pure, for the Assets tab.
import { isFigureLike } from "../layout/imageFit.ts";
import { parseLayout } from "../layout/yamlDoc.ts";

export type AssetUse = { layout: string; element: string };

/**
 * Asset id → the layouts and element ids that reference it, in layout order. Layout files that do
 * not parse are skipped (the Layout tab reports them).
 */
export function assetUsage(layouts: readonly { name: string; text: string }[]): Map<string, AssetUse[]> {
  const out = new Map<string, AssetUse[]>();
  for (const file of layouts) {
    const r = parseLayout(file.text);
    if (!r.ok) continue;
    for (const el of r.layout.elements) {
      if (!isFigureLike(el) || !el.asset) continue;
      const list = out.get(el.asset) ?? [];
      list.push({ layout: file.name, element: el.id });
      out.set(el.asset, list);
    }
  }
  return out;
}

/** "a, b" → ["a", "b"]: tags typed as one comma-separated field. */
export function parseTags(text: string): string[] {
  return [
    ...new Set(
      text
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
    ),
  ];
}
