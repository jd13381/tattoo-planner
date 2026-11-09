// What a projection's photo picker offers (docs/adr/0020-asset-structure.md, ADR 0023): the current
// person's tattoo photos and measuring photos, each with the Image studio edits made from it stacked
// on it, then everything else the person may use. Picking an edit keeps the original as the frame
// the marks belong to (`file`) and draws the edit instead (`cleaned`). Pure; the projection UI only
// renders these groups.
import { fileKey } from "./manifestDoc.ts";
import type { AssetInfo } from "./types.ts";

/** A photo and the studio edits of it, in manifest order (oldest first). */
export type PhotoChoice = { photo: AssetInfo; edits: AssetInfo[] };

export type ProjectionPhotoGroups = {
  /** The person's tattoo photos (a projection uses them already). */
  tattoos: PhotoChoice[];
  /** The person's measuring photos. */
  measuring: PhotoChoice[];
  /** Everything else offered: the shared library and edits whose original is not offered. */
  others: AssetInfo[];
};

function isBodyPhoto(a: AssetInfo): boolean {
  return a.effectiveCategory === "existing" || a.effectiveCategory === "measuring";
}

function walkToRoot(asset: AssetInfo, byId: ReadonlyMap<string, AssetInfo>): AssetInfo | null {
  const seen = new Set<string>();
  let at = asset;
  while (at.derived_from) {
    if (seen.has(at.id)) return null;
    seen.add(at.id);
    const next = byId.get(at.derived_from);
    if (!next) return null;
    at = next;
  }
  return at === asset ? null : at;
}

/** The original an edit was made from, following `derived_from`; null for an original or a lost one. */
export function originalOf(asset: AssetInfo, assets: readonly AssetInfo[]): AssetInfo | null {
  return walkToRoot(asset, new Map(assets.map((a) => [a.id, a])));
}

/**
 * The picker's groups for `person`. Hidden images and other persons' photos (and edits of them) are
 * left out; `text` filters by id, file and tags. An edit that matches the filter shows its photo.
 */
export function projectionPhotoGroups(
  assets: readonly AssetInfo[],
  person: string,
  text = "",
): ProjectionPhotoGroups {
  const q = text.trim().toLowerCase();
  const matches = (a: AssetInfo) => !q || `${a.id} ${a.file} ${a.tags.join(" ")}`.toLowerCase().includes(q);
  const visible = assets.filter(
    (a) => !a.hidden && (a.effectivePerson === null || a.effectivePerson === person),
  );
  const byId = new Map(assets.map((a) => [a.id, a]));
  const choices = new Map<string, PhotoChoice>();
  for (const a of visible)
    if (!a.derived_from && a.effectivePerson === person && isBodyPhoto(a))
      choices.set(a.id, { photo: a, edits: [] });
  const others: AssetInfo[] = [];
  const shown = new Set<string>();
  for (const a of visible) {
    if (choices.has(a.id)) {
      if (matches(a)) shown.add(a.id);
      continue;
    }
    const root = a.derived_from ? walkToRoot(a, byId) : null;
    const choice = root ? choices.get(root.id) : undefined;
    if (choice) {
      choice.edits.push(a);
      if (matches(a)) shown.add(choice.photo.id);
    } else if (matches(a)) others.push(a);
  }
  const group = (c: string) =>
    [...choices.values()].filter((ch) => ch.photo.effectiveCategory === c && shown.has(ch.photo.id));
  return { tattoos: group("existing"), measuring: group("measuring"), others };
}

/**
 * The projection photo fields for a picked image: a studio edit of a body photo keeps the photo as
 * the frame the marks belong to (`file`) and is drawn instead (`cleaned`); anything else is the
 * photo itself.
 */
export function photoFields(
  picked: AssetInfo,
  assets: readonly AssetInfo[],
): { file: string; cleaned?: string } {
  const root = picked.derived_from ? originalOf(picked, assets) : null;
  if (!root || !isBodyPhoto(root) || fileKey(root.file) === fileKey(picked.file))
    return { file: picked.file };
  return { file: root.file, cleaned: picked.file };
}
