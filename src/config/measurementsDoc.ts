// Writing own measurements back into config/measurements.yaml so that hand edits survive: comments,
// key order and untouched values stay as they are; only the changed values are rewritten (the same
// approach as the layout files, src/layout/yamlDoc.ts).
//
// Where a value goes:
//   - the left arm stays in the original top-level blocks (`lengths`, `circumferences`, `positions`)
//     when the file already uses them; otherwise every region, the left arm included, is written
//     under `regions: <id>: <section>: <key>`;
//   - the sample body and the body height are the top-level `body` and `height_cm` (read and written
//     only through readBodyChoice / the `body` and `heightCm` fields of a draft, so they can move to
//     project.yaml later without touching the callers).
import { isMap, isScalar, parseDocument, type Document, type YAMLMap } from "yaml";
import { INPUT_SECTIONS, type InputSection } from "../body/inputs.ts";
import { REGION_IDS, REGIONS, type RegionId } from "../body/regions.ts";
import type { BodyId } from "../body/samples.ts";
import { parseMeasurements } from "./loadMeasurements.ts";
import type { Measurements } from "./measurements.ts";

/** Unsaved changes to measurements.yaml. A missing field is unchanged; null clears the value. */
export type MeasurementDraft = {
  body?: BodyId;
  heightCm?: number | null;
  /** Per region and key: a number sets the value, null removes it (the sample body shows again). */
  regions?: Partial<Record<RegionId, Partial<Record<string, number | null>>>>;
};

/** The body choice as stored today (top-level `body` and `height_cm` of measurements.yaml). */
export type BodyChoice = { body: BodyId | null; heightCm: number | null };

export function readBodyChoice(m: Measurements | null): BodyChoice {
  return { body: m?.body ?? null, heightCm: m?.height_cm ?? null };
}

/** Top-level keys in the order a new key is inserted (body and height after `units`, under the header). */
const TOP_ORDER = [
  "arm",
  "units",
  "body",
  "height_cm",
  "lengths",
  "circumferences",
  "positions",
  "regions",
  "existing",
  "notes",
];

const LEGACY_SECTIONS: InputSection[] = ["lengths", "circumferences", "positions"];

/** Whether the text gives the left arm in the original top-level blocks. */
export function usesLegacyArm(m: Measurements | null): boolean {
  return !!(m && (m.lengths || m.circumferences || m.positions));
}

/** The section of a region kind that holds `key`. */
export function sectionOf(id: RegionId, key: string): InputSection {
  const s = INPUT_SECTIONS[REGIONS[id].kind].find((sec) => (sec.keys as string[]).includes(key));
  if (!s) throw new Error(`${key} is not a measurement of ${id}`);
  return s.section;
}

/** Rounds to 0.01 and drops float noise (30.100000000000001 → 30.1). */
export function roundCm(v: number): number {
  return Math.round(v * 100) / 100;
}

function keyName(pair: { key: unknown }): string {
  const k = pair.key;
  return String(isScalar(k) ? k.value : k);
}

/**
 * Sets `key` in `map`, keeping the existing node (and its comment) when there is one. A new key is
 * inserted after the last existing key that comes before it in `order` (unknown keys keep their place).
 */
function setOrdered(doc: Document, map: YAMLMap, key: string, value: unknown, order: readonly string[]) {
  if (map.has(key)) {
    const node = map.get(key, true);
    if (isScalar(node) && (value === null || typeof value !== "object")) node.value = value;
    else map.set(key, doc.createNode(value));
    return;
  }
  const rank = order.indexOf(key);
  let at = map.items.length;
  if (rank >= 0) {
    at = 0;
    map.items.forEach((p, i) => {
      const r = order.indexOf(keyName(p));
      if (r >= 0 && r < rank) at = i + 1;
    });
    // Nothing earlier in the order: insert before the first later key, else at the end.
    if (at === 0) {
      const later = map.items.findIndex((p) => order.indexOf(keyName(p)) > rank);
      at = later >= 0 ? later : map.items.length;
    }
  }
  map.items.splice(at, 0, doc.createPair(key, value) as (typeof map.items)[number]);
}

/** The block map at `key` of `parent`, created (in `order`) when missing or empty. */
function childMap(doc: Document, parent: YAMLMap, key: string, order: readonly string[]): YAMLMap {
  const node = parent.get(key, true);
  if (isMap(node)) return node;
  setOrdered(doc, parent, key, {}, order);
  const created = parent.get(key, true);
  if (!isMap(created)) throw new Error(`could not create ${key}`);
  return created;
}

/** Removes `key` from `parent` when its map has no entries left. */
function dropIfEmpty(parent: YAMLMap, key: string) {
  const node = parent.get(key, true);
  if (isMap(node) && node.items.length === 0) parent.delete(key);
}

/** One change: set a value at `path` (null in a legacy block), or delete it (`value: undefined`). */
type Op = { path: string[]; value: number | string | null | undefined; fill?: string[] };

/**
 * Applies a draft to the text of measurements.yaml and returns the new text. Throws when the original
 * does not parse as YAML or when the result would not be a valid measurements file.
 *
 * Values that already exist are replaced in the text itself, so alignment and comments stay byte for
 * byte; new keys and removals go through the yaml Document API, and only the top-level blocks they
 * change are re-rendered.
 */
export function updateMeasurementsText(original: string, draft: MeasurementDraft): string {
  const source = original.trim() === "" ? "units: cm\n" : original;
  const doc = parseDocument(source);
  if (doc.errors.length > 0) throw new Error(`YAML syntax: ${doc.errors[0]!.message}`);
  if (!isMap(doc.contents)) throw new Error("measurements.yaml must be a map of keys");
  const before = parseMeasurements(source);
  const legacy = before.ok && usesLegacyArm(before.measurements);

  const ops: Op[] = [];
  if (draft.body !== undefined) ops.push({ path: ["body"], value: draft.body });
  if (draft.heightCm !== undefined)
    ops.push({ path: ["height_cm"], value: draft.heightCm === null ? undefined : roundCm(draft.heightCm) });
  for (const id of REGION_IDS) {
    const values = draft.regions?.[id];
    if (!values) continue;
    for (const { section, keys } of INPUT_SECTIONS[REGIONS[id].kind]) {
      for (const k of keys as string[]) {
        const v = values[k];
        if (v === undefined) continue;
        if (id === "arm-left" && legacy && LEGACY_SECTIONS.includes(section))
          ops.push({ path: [section, k], value: v === null ? null : roundCm(v), fill: keys as string[] });
        else ops.push({ path: ["regions", id, section, k], value: v === null ? undefined : roundCm(v) });
      }
    }
  }

  // 1. Values that exist: replace their text.
  const splices: { from: number; to: number; text: string }[] = [];
  const rest: Op[] = [];
  for (const op of ops) {
    const node = op.value === undefined ? null : doc.getIn(op.path, true);
    const range = isScalar(node) ? node.range : null;
    if (range && range[1] > range[0]) splices.push({ from: range[0], to: range[1], text: String(op.value) });
    else rest.push(op);
  }
  let text = source;
  for (const s of splices.sort((a, b) => b.from - a.from)) text = text.slice(0, s.from) + s.text + text.slice(s.to);

  // 2. New keys and removals: edit a Document, then re-render only the top-level blocks that changed.
  if (rest.length > 0) {
    const base = parseDocument(text);
    const next = parseDocument(text);
    for (const op of rest) applyOp(next, op);
    text = mergeTopLevel(text, base, next);
  }

  const check = parseMeasurements(text);
  if (!check.ok) throw new Error(check.error);
  return text;
}

/** Key orders below the top level: regions, then sections, then keys. */
function orderFor(path: string[], depth: number): readonly string[] {
  if (depth === 0) return TOP_ORDER;
  if (path[0] === "regions") {
    if (depth === 1) return REGION_IDS;
    const sections = INPUT_SECTIONS[REGIONS[path[1] as RegionId].kind];
    if (depth === 2) return sections.map((s) => s.section);
    return (sections.find((s) => s.section === path[2])?.keys as string[] | undefined) ?? [];
  }
  return LEGACY_SECTIONS.flatMap((s) => INPUT_SECTIONS.arm.find((x) => x.section === s)!.keys as string[]);
}

function applyOp(doc: Document, op: Op) {
  const root = doc.contents as YAMLMap;
  const key = op.path[op.path.length - 1]!;
  if (op.value === undefined) {
    // Remove the key, then every map on the way that became empty.
    const maps: YAMLMap[] = [root];
    for (const k of op.path.slice(0, -1)) {
      const node = maps[maps.length - 1]!.get(k, true);
      if (!isMap(node)) return;
      maps.push(node);
    }
    maps[maps.length - 1]!.delete(key);
    for (let i = maps.length - 1; i > 0; i--) dropIfEmpty(maps[i - 1]!, op.path[i - 1]!);
    return;
  }
  let map = root;
  op.path.slice(0, -1).forEach((k, depth) => {
    const existed = isMap(map.get(k, true));
    map = childMap(doc, map, k, orderFor(op.path, depth));
    // A new legacy block lists every key of its section (null = not measured).
    if (!existed && op.fill) for (const f of op.fill) setOrdered(doc, map, f, null, op.fill);
  });
  setOrdered(doc, map, key, op.value, orderFor(op.path, op.path.length - 1));
}

/** The text of every top-level entry (from its key to the next key) and what precedes the first one. */
function topLevelSlices(text: string, doc: Document): { prefix: string; slices: Map<string, string> } {
  const items = isMap(doc.contents) ? doc.contents.items : [];
  const starts = items.map((p) => (isScalar(p.key) && p.key.range ? p.key.range[0] : 0));
  const slices = new Map<string, string>();
  items.forEach((p, i) => slices.set(keyName(p), text.slice(starts[i], starts[i + 1] ?? text.length)));
  return { prefix: text.slice(0, starts[0] ?? text.length), slices };
}

/** `next` as text, taking every top-level entry that did not change from `text` unchanged. */
function mergeTopLevel(text: string, base: Document, next: Document): string {
  const rendered = next.toString({ lineWidth: 0 });
  const old = topLevelSlices(text, base);
  const fresh = topLevelSlices(rendered, parseDocument(rendered));
  const baseRoot = base.contents as YAMLMap;
  const nextRoot = next.contents as YAMLMap;
  const baseJs = base.toJS() as Record<string, unknown>;
  const nextJs = next.toJS() as Record<string, unknown>;
  let out = old.prefix;
  for (const pair of nextRoot.items) {
    const k = keyName(pair);
    const same = baseRoot.has(k) && JSON.stringify(baseJs[k] ?? null) === JSON.stringify(nextJs[k] ?? null);
    let slice = (same ? old.slices.get(k) : fresh.slices.get(k)) ?? "";
    if (!slice.endsWith("\n")) slice += "\n";
    out += slice;
  }
  return out;
}

/** Number of values a draft changes (body and height count one each). */
export function draftSize(draft: MeasurementDraft): number {
  let n = (draft.body !== undefined ? 1 : 0) + (draft.heightCm !== undefined ? 1 : 0);
  for (const values of Object.values(draft.regions ?? {}))
    n += Object.values(values ?? {}).filter((v) => v !== undefined).length;
  return n;
}
