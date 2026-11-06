// Where each catalogued image is used (docs/adr/0020-asset-structure.md): layouts of every person
// (any `asset` key, so figures, existing tattoos and background layers all count), projections
// (photo files, matched like the file system does: case-insensitively), kept edits made from it
// and open Image studio sessions. Pure; the server answers GET /api/assets/usage with it and the
// trash dialog lists the uses before anything is deleted.
import { parse } from "yaml";
import type { Asset } from "./manifest.ts";
import { fileKey } from "./manifestDoc.ts";

export type AssetUse =
  | { kind: "layout"; person: string; layout: string; element: string }
  | { kind: "projection"; person: string; projection: string; label: string; photo: number }
  | { kind: "derived"; child: string }
  | { kind: "session" };

export type NamedText = { person: string; name: string; text: string };

export type ReferenceInput = {
  assets: readonly Pick<Asset, "id" | "file" | "derived_from">[];
  layouts: readonly NamedText[];
  projections: readonly NamedText[];
  /** Asset ids with an open Image studio session. */
  sessions?: readonly string[];
};

/** Asset id → its uses. Ids without uses are missing (not an empty list). */
export type UsageMap = Record<string, AssetUse[]>;

function safeParse(text: string): unknown {
  try {
    return parse(text);
  } catch {
    return null;
  }
}

/** True for keys that name an asset id: `asset` and `<something>_asset`. */
function isAssetKey(key: string): boolean {
  return key === "asset" || key.endsWith("_asset");
}

/** Every (asset id, element id) pair in a parsed layout, in document order. */
export function layoutAssetRefs(doc: unknown): { asset: string; element: string }[] {
  const out: { asset: string; element: string }[] = [];
  const walk = (node: unknown, owner: string) => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item, owner);
      return;
    }
    if (!node || typeof node !== "object") return;
    const obj = node as Record<string, unknown>;
    const id = typeof obj.id === "string" ? obj.id : owner;
    for (const [key, value] of Object.entries(obj)) {
      if (isAssetKey(key) && typeof value === "string" && value) out.push({ asset: value, element: id });
      else walk(value, id);
    }
  };
  walk(doc, "");
  return out;
}

/** File keys (fileKey) of every photo of the given projections. */
export function projectionPhotoKeys(projections: readonly Pick<NamedText, "text">[]): Set<string> {
  const keys = new Set<string>();
  for (const p of projections) for (const f of projectionPhotos(safeParse(p.text))) keys.add(fileKey(f));
  return keys;
}

function projectionPhotos(doc: unknown): string[] {
  const photos = (doc as { photos?: unknown } | null)?.photos;
  if (!Array.isArray(photos)) return [];
  return photos
    .map((p) => (p as { file?: unknown } | null)?.file)
    .map((f) => (typeof f === "string" ? f : ""));
}

export function assetReferences(input: ReferenceInput): UsageMap {
  const out: UsageMap = {};
  const add = (id: string, use: AssetUse) => (out[id] ??= []).push(use);
  const known = new Set(input.assets.map((a) => a.id));
  for (const file of input.layouts) {
    for (const ref of layoutAssetRefs(safeParse(file.text)))
      if (known.has(ref.asset))
        add(ref.asset, { kind: "layout", person: file.person, layout: file.name, element: ref.element });
  }
  // Several entries may name the same file; a projection uses all of them.
  const byFile = new Map<string, string[]>();
  for (const a of input.assets) {
    const k = fileKey(a.file);
    byFile.set(k, [...(byFile.get(k) ?? []), a.id]);
  }
  for (const p of input.projections) {
    const doc = safeParse(p.text) as { name?: unknown; description?: unknown } | null;
    const label =
      typeof doc?.description === "string" && doc.description.trim()
        ? doc.description.trim()
        : typeof doc?.name === "string"
          ? doc.name
          : p.name;
    projectionPhotos(doc).forEach((file, i) => {
      if (!file) return;
      for (const id of byFile.get(fileKey(file)) ?? [])
        add(id, { kind: "projection", person: p.person, projection: p.name, label, photo: i + 1 });
    });
  }
  for (const a of input.assets)
    if (a.derived_from && known.has(a.derived_from)) add(a.derived_from, { kind: "derived", child: a.id });
  for (const id of new Set(input.sessions ?? [])) if (known.has(id)) add(id, { kind: "session" });
  return out;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** The badge on a card: "2 layouts · 1 projection", or "Unused". Kept edits do not count as use. */
export function usageBadge(uses: readonly AssetUse[] | undefined): string {
  const layouts = new Set(
    (uses ?? []).flatMap((u) => (u.kind === "layout" ? [`${u.person}/${u.layout}`] : [])),
  ).size;
  const projections = new Set(
    (uses ?? []).flatMap((u) => (u.kind === "projection" ? [`${u.person}/${u.projection}`] : [])),
  ).size;
  const parts = [];
  if (layouts) parts.push(plural(layouts, "layout"));
  if (projections) parts.push(plural(projections, "projection"));
  return parts.length ? parts.join(" · ") : "Unused";
}

/** Whether anything but kept edits uses the image (layouts, projections, a studio session). */
export function isInUse(uses: readonly AssetUse[] | undefined): boolean {
  return (uses ?? []).some((u) => u.kind !== "derived");
}

/** One line per use, for the detail panel and the trash dialog. */
export function describeUse(assetId: string, use: AssetUse): string {
  switch (use.kind) {
    case "layout":
      return `${assetId}: element ${use.element || "(no id)"} in layout ${use.layout}`;
    case "projection":
      return `${assetId}: photo ${use.photo} of projection ${use.label}`;
    case "derived":
      return `${assetId}: original of the edit ${use.child}`;
    case "session":
      return `${assetId}: open in the Image studio`;
  }
}

export type DeleteCheck = {
  /** Ids with an open studio session: deleting them is refused. */
  inSession: string[];
  /** Projection photos: deleting them breaks the projection; allowed only when forced. */
  projections: { id: string; use: Extract<AssetUse, { kind: "projection" }> }[];
  /** Layout uses: the element keeps its asset id and shows a missing image. */
  layouts: { id: string; use: Extract<AssetUse, { kind: "layout" }> }[];
};

export function deleteCheck(ids: readonly string[], usage: UsageMap): DeleteCheck {
  const check: DeleteCheck = { inSession: [], projections: [], layouts: [] };
  for (const id of ids)
    for (const use of usage[id] ?? []) {
      if (use.kind === "session") check.inSession.push(id);
      else if (use.kind === "projection") check.projections.push({ id, use });
      else if (use.kind === "layout") check.layouts.push({ id, use });
    }
  return check;
}
