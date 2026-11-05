// Reading and writing layout YAML so that Jan's hand edits survive: comments, key order and flow style
// of unchanged elements are kept; only changed values are rewritten.
import { Document, isMap, isSeq, parseDocument, YAMLMap, YAMLSeq } from "yaml";
import { DEFAULT_REGION, isRegionId, regionOf, type RegionId } from "../body/regions.ts";
import { layoutSchema, type Layout, type LayoutElement } from "./schema.ts";

export type ParseResult = { ok: true; layout: Layout } | { ok: false; error: string };

export function parseLayout(text: string): ParseResult {
  const doc = parseDocument(text);
  if (doc.errors.length > 0) return { ok: false, error: `YAML syntax: ${doc.errors[0]!.message}` };
  const result = layoutSchema.safeParse(doc.toJS());
  if (result.success) return { ok: true, layout: result.data };
  return {
    ok: false,
    error: result.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; "),
  };
}

/** The region a stored layout belongs to, also when the file does not parse (then read from its text). */
export function layoutRegion(text: string): RegionId {
  const r = parseLayout(text);
  if (r.ok) return regionOf(r.layout);
  const m = /^region:\s*["']?([a-z-]+)/m.exec(text);
  return m && isRegionId(m[1]) ? m[1] : DEFAULT_REGION;
}

/** Keys whose object values are written in flow style ({ u: 0.5, v: 0.1 }), as in the brief. */
const FLOW_KEYS = new Set(["position", "size_cm", "region", "points", "crop"]);

function valueNode(doc: Document, key: string, value: unknown) {
  const node = doc.createNode(value);
  if (FLOW_KEYS.has(key) && (isMap(node) || isSeq(node))) {
    node.flow = true;
    if (isSeq(node)) for (const item of node.items) if (isMap(item)) item.flow = true;
  }
  return node;
}

/** Leading keys of a new element, in reverse (unlisted keys keep their order after them). */
const KEY_FIRST = ["type", "id"];

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Applies `layout` to the original YAML text and returns the new text. */
export function updateLayoutText(original: string, layout: Layout): string {
  const doc = parseDocument(original);
  for (const key of ["name", "description"] as const) {
    if (layout[key] === undefined) doc.delete(key);
    else if (!same(doc.get(key), layout[key])) doc.set(key, layout[key]);
  }
  // `region` sits right after `name`; files without one (the left arm) are left without it.
  if (layout.region === undefined) doc.delete("region");
  else if (!same(doc.get("region"), layout.region)) {
    if (doc.has("region")) doc.set("region", layout.region);
    else if (isMap(doc.contents)) {
      const items = doc.contents.items;
      const at = items.findIndex((p) => String((p.key as { value?: unknown })?.value ?? p.key) === "name");
      const pair = doc.createPair("region", layout.region);
      items.splice(at + 1, 0, pair as (typeof items)[number]);
    } else doc.set("region", layout.region);
  }

  const oldSeq = doc.get("elements", true);
  const oldById = new Map<string, YAMLMap>();
  if (isSeq(oldSeq)) {
    for (const item of oldSeq.items) {
      if (isMap(item)) {
        const id = item.get("id");
        if (typeof id === "string") oldById.set(id, item);
      }
    }
  }

  const seq = isSeq(oldSeq) ? (oldSeq as YAMLSeq) : new YAMLSeq();
  seq.items = layout.elements.map((el) => updateElement(doc, oldById.get(el.id), el));
  if (!isSeq(oldSeq)) doc.set("elements", seq);
  return doc.toString({ lineWidth: 0 });
}

function updateElement(doc: Document, node: YAMLMap | undefined, el: LayoutElement): YAMLMap {
  const target = node ?? new YAMLMap();
  if (!node) target.spaceBefore = true; // blank line between elements, as in the hand-written files
  const entries = Object.entries(el).filter(([, v]) => v !== undefined);
  // A new element starts with id and type, as in the hand-written files (schema output puts type first).
  if (!node) entries.sort(([a], [b]) => KEY_FIRST.indexOf(b) - KEY_FIRST.indexOf(a));
  const keep = new Set(entries.map(([k]) => k));
  for (const pair of [...target.items]) {
    const k = String((pair.key as { value?: unknown })?.value ?? pair.key);
    if (!keep.has(k)) target.delete(k);
  }
  for (const [k, v] of entries) {
    const current = target.get(k, true);
    const currentJs =
      current && typeof current === "object" && "toJSON" in current
        ? (current as { toJSON(): unknown }).toJSON()
        : current;
    if (!target.has(k) || !same(currentJs, v)) {
      const next = valueNode(doc, k, v);
      // Keep a trailing comment such as "# outer centre line" when the value changes.
      if (current && typeof current === "object" && "comment" in current)
        next.comment = (current as { comment?: string | null }).comment;
      target.set(k, next);
    }
  }
  return target;
}

/** A fresh YAML file for a new variant. */
export function newLayoutText(layout: Layout): string {
  return updateLayoutText(
    `# Layout variant ${layout.name}. Edited in the Tattoo Planner; hand edits are welcome.\nname: ${layout.name}\nelements: []\n`,
    layout,
  );
}
