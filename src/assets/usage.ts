// Where each asset is used in saved layouts. The full picture (projections, kept edits, studio
// sessions, every person) lives in references.ts; this keeps the older layout-only helper.
import { parse } from "yaml";
import { layoutAssetRefs } from "./references.ts";

export { assetReferences, describeUse, isInUse, usageBadge } from "./references.ts";

export type AssetUse = { layout: string; element: string };

/** Asset id → the layouts and element ids that reference it, in layout order. Unparsable files are skipped. */
export function assetUsage(layouts: readonly { name: string; text: string }[]): Map<string, AssetUse[]> {
  const out = new Map<string, AssetUse[]>();
  for (const file of layouts) {
    let doc: unknown;
    try {
      doc = parse(file.text);
    } catch {
      continue;
    }
    for (const ref of layoutAssetRefs(doc)) {
      const list = out.get(ref.asset) ?? [];
      list.push({ layout: file.name, element: ref.element });
      out.set(ref.asset, list);
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
