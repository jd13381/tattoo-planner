// Merging generated entries into <TATTOO_DATA_DIR>/manifest.yaml without losing Jan's hand edits
// (ADR 0003): comments, key order and every field he wrote stay as they are. New files become new
// entries at the end; existing entries only get the fields named in `refresh` updated.
import { isMap, isSeq, parseDocument, type Document, YAMLMap, YAMLSeq } from "yaml";
import { manifestSchema, type Asset } from "./manifest.ts";

export class ManifestError extends Error {}

export type MergeOptions = {
  /** Fields of an existing entry that are overwritten from the incoming entry (e.g. page, bbox). */
  refresh?: readonly (keyof Asset)[];
  /** Also match an incoming entry to an existing one by id when no entry has its file. */
  matchById?: boolean;
};

export type MergeResult = {
  text: string;
  /** False when the text is byte-identical to the original. */
  changed: boolean;
  added: string[];
  updated: string[];
};

export const NEW_MANIFEST_TEXT = `# Asset catalogue (PROJECT_BRIEF.md §12.4). Layouts reference assets by id.
# \`npm run assets:scan\` and the Reload button add entries for new files; hand edits are welcome and kept.
version: 1
assets: []
`;

/** Key order of new entries; matches the schema and the example in the brief. */
const KEY_ORDER: (keyof Asset)[] = [
  "id",
  "file",
  "kind",
  "derived_from",
  "source",
  "notes",
  "tags",
  "page",
  "bbox",
  "crop",
];
const FLOW_KEYS = new Set<string>(["tags", "bbox", "crop"]);

/** Normalised form of a data-folder path for comparisons (macOS file systems ignore case). */
export function fileKey(file: string): string {
  return file
    .replaceAll("\\", "/")
    .replace(/^(\.\/)+/, "")
    .toLowerCase();
}

function issues(e: { issues: { path: PropertyKey[]; message: string }[] }): string {
  return e.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
}

/** Parses and validates manifest text; throws ManifestError so callers never overwrite a broken file. */
export function parseManifestText(text: string): Document {
  const doc = parseDocument(text);
  if (doc.errors.length > 0) throw new ManifestError(`YAML syntax: ${doc.errors[0]!.message}`);
  const result = manifestSchema.safeParse(doc.toJS() ?? {});
  if (!result.success) throw new ManifestError(issues(result.error));
  return doc;
}

function valueNode(doc: Document, key: string, value: unknown) {
  const node = doc.createNode(value);
  if (FLOW_KEYS.has(key) && (isMap(node) || isSeq(node))) node.flow = true;
  return node;
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Adds `incoming` entries to the manifest text (null: no manifest yet). An incoming entry matches an
 * existing one with the same file (and, with matchById, the same id); matched entries keep everything
 * except the `refresh` fields. Ids of new entries are made unique with a -2, -3, ... suffix.
 */
export function mergeManifest(
  original: string | null,
  incoming: Asset[],
  opts: MergeOptions = {},
): MergeResult {
  const base = original ?? NEW_MANIFEST_TEXT;
  const doc = parseManifestText(base);
  if (!doc.has("version")) {
    // Keep `version` first, as in a new file.
    const root = doc.contents;
    if (isMap(root)) root.items.unshift(doc.createPair("version", 1));
  }
  let seq = doc.get("assets", true);
  if (!isSeq(seq)) {
    seq = new YAMLSeq();
    doc.set("assets", seq);
  }
  const assets = seq as YAMLSeq;

  const byFile = new Map<string, YAMLMap>();
  const byId = new Map<string, YAMLMap>();
  for (const item of assets.items) {
    if (!isMap(item)) continue;
    const file = item.get("file");
    const id = item.get("id");
    if (typeof file === "string") byFile.set(fileKey(file), item);
    if (typeof id === "string") byId.set(id, item);
  }

  const added: string[] = [];
  const updated: string[] = [];
  for (const asset of incoming) {
    const existing = byFile.get(fileKey(asset.file)) ?? (opts.matchById ? byId.get(asset.id) : undefined);
    if (existing) {
      let touched = false;
      for (const key of opts.refresh ?? []) {
        const value = asset[key];
        if (value === undefined) continue;
        const current = existing.get(key, true);
        const currentJs =
          current && typeof current === "object" && "toJSON" in current
            ? (current as { toJSON(): unknown }).toJSON()
            : current;
        if (existing.has(key) && same(currentJs, value)) continue;
        const next = valueNode(doc, key, value);
        if (current && typeof current === "object" && "comment" in current)
          next.comment = (current as { comment?: string | null }).comment;
        existing.set(key, next);
        touched = true;
      }
      if (touched) updated.push(String(existing.get("id")));
      continue;
    }

    let id = asset.id;
    for (let n = 2; byId.has(id); n++) id = `${asset.id}-${n}`;
    const node = new YAMLMap();
    for (const key of KEY_ORDER) {
      const value = key === "id" ? id : asset[key];
      if (value !== undefined) node.set(key, valueNode(doc, key, value));
    }
    if (assets.items.length > 0) node.spaceBefore = true;
    assets.flow = false;
    assets.items.push(node);
    byId.set(id, node);
    byFile.set(fileKey(asset.file), node);
    added.push(id);
  }

  if (added.length === 0 && updated.length === 0)
    return { text: base, changed: original === null, added, updated };
  // `[a, b]` as in the brief's example and as people usually type it.
  const text = doc.toString({ lineWidth: 0, flowCollectionPadding: false });
  const check = manifestSchema.safeParse(parseDocument(text).toJS());
  if (!check.success) throw new ManifestError(`merge produced an invalid manifest: ${issues(check.error)}`);
  return { text, changed: text !== original, added, updated };
}
