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

export const NEW_MANIFEST_TEXT = `# Image catalogue of this Tattoo Planner project. Layouts reference images by id.
# The Assets tab's "Look for new images" button (or \`npm run assets:scan\` in a git checkout) adds
# entries for new files; hand edits are welcome and kept.
version: 1
assets: []
`;

/** Key order of new entries; matches the schema and the example in the brief. */
const KEY_ORDER: (keyof Asset)[] = [
  "id",
  "file",
  "kind",
  "category",
  "person",
  "derived_from",
  "source",
  "notes",
  "tags",
  "page",
  "bbox",
  "crop",
  "hidden",
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
  // Only new entries: append them as text, so everything already there stays byte for byte.
  const appended =
    original !== null && updated.length === 0
      ? appendEntries(original, assets.items.slice(-added.length) as YAMLMap[], text)
      : null;
  return { text: appended ?? text, changed: (appended ?? text) !== original, added, updated };
}

/**
 * `original` with `nodes` written after its last entry, in the indentation of the existing entries.
 * Null when that is not possible (flow or empty list) or would not give the same data as `expected`.
 */
function appendEntries(original: string, nodes: YAMLMap[], expected: string): string | null {
  const doc = parseDocument(original);
  const seq = doc.get("assets", true);
  if (!isSeq(seq) || seq.flow || seq.items.length === 0) return null;
  const last = seq.items.at(-1) as YAMLMap | undefined;
  const end = last?.range?.[2];
  if (end === undefined) return null;
  const lineStart = original.lastIndexOf("\n", last!.range![0] - 1) + 1;
  const indent = /^(\s*)-/.exec(original.slice(lineStart, last!.range![0]))?.[1];
  if (indent === undefined) return null;
  const tmp = parseDocument("assets: []\n");
  const list = new YAMLSeq();
  list.items = nodes.map((n) => n.clone());
  tmp.set("assets", list);
  const body = tmp
    .toString({ lineWidth: 0, flowCollectionPadding: false })
    .split("\n")
    .slice(1)
    .map((l) => (l.trim() === "" ? "" : l.startsWith("  ") ? indent + l.slice(2) : l))
    .join("\n")
    .replace(/^\n+/, "")
    .replace(/\n+$/, "\n");
  const head = original.slice(0, end);
  const text = `${head}${head.endsWith("\n") ? "" : "\n"}\n${body}${original.slice(end)}`;
  try {
    const same =
      JSON.stringify(parseDocument(text).toJS()) === JSON.stringify(parseDocument(expected).toJS());
    return same ? text : null;
  } catch {
    return null;
  }
}

/** Fields of one entry that the Assets tab edits. `null` / empty removes the field. */
export type EntryPatch = {
  tags?: string[];
  notes?: string | null;
  hidden?: boolean;
  /** "Move to …": the section; null removes the field (back to the derived one). */
  category?: string | null;
  /** The person a photo belongs to; null removes the field (the implicit person). */
  person?: string | null;
};

function entryMap(doc: Document, id: string): YAMLMap {
  const seq = doc.get("assets", true);
  const entry = isSeq(seq) ? seq.items.find((item) => isMap(item) && item.get("id") === id) : undefined;
  if (!isMap(entry)) throw new ManifestError(`no asset with id ${id}`);
  return entry as YAMLMap;
}

function applyPatch(doc: Document, entry: YAMLMap, patch: EntryPatch) {
  const set = (key: keyof Asset, value: unknown) => {
    if (value === undefined) return;
    const remove =
      value === null || value === false || value === "" || (Array.isArray(value) && value.length === 0);
    if (remove) {
      // Tags default to []; keep an existing empty list rather than dropping the key.
      if (key === "tags" && entry.has(key)) entry.set(key, valueNode(doc, key, []));
      else entry.delete(key);
      return;
    }
    const current = entry.get(key, true);
    if (entry.has(key)) {
      if (same((current as { toJSON?(): unknown })?.toJSON?.() ?? current, value)) return;
      const next = valueNode(doc, key, value);
      if (current && typeof current === "object" && "comment" in current)
        next.comment = (current as { comment?: string | null }).comment;
      entry.set(key, next);
      return;
    }
    // Insert after the last present key that comes before it in KEY_ORDER.
    const at = KEY_ORDER.indexOf(key);
    let index = 0;
    entry.items.forEach((pair, i) => {
      const k = KEY_ORDER.indexOf(
        String((pair.key as { value?: unknown })?.value ?? pair.key) as keyof Asset,
      );
      if (k !== -1 && k < at) index = i + 1;
    });
    entry.items.splice(index, 0, doc.createPair(key, valueNode(doc, key, value)));
  };
  if (patch.tags !== undefined) set("tags", [...new Set(patch.tags.map((t) => t.trim()).filter(Boolean))]);
  if (patch.notes !== undefined) set("notes", patch.notes?.trim() ? patch.notes.trim() : null);
  if (patch.category !== undefined) set("category", patch.category);
  if (patch.person !== undefined) set("person", patch.person);
  if (patch.hidden !== undefined) set("hidden", patch.hidden || null);
}

function finish(doc: Document, what: string): string {
  const text = doc.toString({ lineWidth: 0, flowCollectionPadding: false });
  const check = manifestSchema.safeParse(parseDocument(text).toJS());
  if (!check.success) throw new ManifestError(`${what} produced an invalid manifest: ${issues(check.error)}`);
  return text;
}

/**
 * Changes the tags, notes, category, person or hidden flag of the entry with `id`, keeping
 * comments, key order and every other field. A field the entry does not have yet goes where
 * KEY_ORDER puts it.
 */
export function updateManifestEntry(original: string, id: string, patch: EntryPatch): string {
  return updateManifestEntries(original, [{ id, patch }]);
}

/**
 * Several entry updates in one write (the batch actions of the Assets tab). Unknown ids throw, so a
 * batch is all or nothing. A batch that changes nothing returns the original text unchanged.
 */
export function updateManifestEntries(
  original: string,
  updates: readonly { id: string; patch: EntryPatch }[],
): string {
  const doc = parseManifestText(original);
  const before = JSON.stringify(doc.toJS());
  for (const u of updates) applyPatch(doc, entryMap(doc, u.id), u.patch);
  if (JSON.stringify(doc.toJS()) === before) return original;
  return finish(doc, "update");
}

const isBlank = (line: string) => line.trim() === "";

/**
 * Removes the entries with these ids. Everything else stays byte for byte: other entries, comments
 * (also those right above a removed entry) and blank lines between entries. The text is cut line by
 * line from the parsed ranges; when a layout is too unusual for that (flow sequences, every entry
 * removed), the document is re-serialised instead. Returns the text and the removed ids.
 */
export function removeManifestEntries(
  original: string,
  ids: readonly string[],
): { text: string; removed: string[] } {
  const doc = parseManifestText(original);
  const seq = doc.get("assets", true);
  if (!isSeq(seq)) return { text: original, removed: [] };
  const drop = new Set(ids);
  const items = seq.items.filter(isMap) as YAMLMap[];
  const removed = items.map((m) => String(m.get("id"))).filter((id) => drop.has(id));
  if (removed.length === 0) return { text: original, removed };
  const expected = JSON.stringify(
    (doc.toJS() as { assets: { id: string }[] }).assets.filter((a) => !drop.has(a.id)),
  );
  const viaDoc = () => {
    const d = parseManifestText(original);
    const s = d.get("assets", true) as YAMLSeq;
    s.items = s.items.filter((m) => !(isMap(m) && drop.has(String(m.get("id")))));
    if (s.items.length === 0) s.flow = true;
    return finish(d, "removal");
  };
  if (seq.flow || removed.length === items.length) return { text: viaDoc(), removed };

  const lines = original.split("\n");
  const starts: number[] = [];
  let offset = 0;
  for (const line of lines) {
    starts.push(offset);
    offset += line.length + 1;
  }
  const lineOf = (pos: number) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid]! <= pos) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  const cut = new Set<number>();
  for (const item of items) {
    if (!drop.has(String(item.get("id")))) continue;
    const range = item.range;
    if (!range) return { text: viaDoc(), removed };
    let first = lineOf(range[0]);
    const head = lines[first]!.slice(0, range[0] - starts[first]!);
    if (!/^\s*-\s+$/.test(head)) {
      // "-" alone on the line above the entry's first key.
      if (head.trim() === "" && first > 0 && /^\s*-\s*$/.test(lines[first - 1]!)) first -= 1;
      else return { text: viaDoc(), removed };
    }
    const last = lineOf(Math.max(range[0], range[2] - 1));
    for (let l = first; l <= last; l++) cut.add(l);
    // The blank lines after the entry go with it; at the end of the list, those before it.
    let after = last + 1;
    while (after < lines.length - 1 && isBlank(lines[after]!)) cut.add(after++);
    if (after === last + 1 && item === items.at(-1))
      for (let before = first - 1; before > 0 && isBlank(lines[before]!); before--) cut.add(before);
  }
  const text = lines.filter((_, i) => !cut.has(i)).join("\n");
  try {
    const check = parseManifestText(text);
    if (JSON.stringify((check.toJS() as { assets: unknown[] }).assets) === expected) return { text, removed };
  } catch {
    // fall through to the re-serialised document
  }
  return { text: viaDoc(), removed };
}
