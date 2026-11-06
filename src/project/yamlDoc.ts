// Reads and writes project.yaml as text, keeping comments, key order and unknown keys (like layouts).
import { isMap, isScalar, isSeq, parseDocument, type Document, type YAMLMap } from "yaml";
import { ROOT_PERSON_ID } from "./persons.ts";
import {
  PROJECT_FILE,
  PROJECT_VERSION,
  projectSchema,
  type Body,
  type ProjectMeta,
  type ProjectPatch,
} from "./schema.ts";

export type ParsedProject = { ok: true; project: ProjectMeta } | { ok: false; error: string };

export function parseProjectText(text: string): ParsedProject {
  const doc = parseDocument(text);
  if (doc.errors.length > 0)
    return { ok: false, error: `${PROJECT_FILE}: YAML syntax: ${doc.errors[0]!.message}` };
  const raw: unknown = doc.toJS();
  const version = (raw as { version?: unknown } | null)?.version;
  if (typeof version === "number" && version > PROJECT_VERSION)
    return {
      ok: false,
      error: `${PROJECT_FILE} was written by a newer version of the planner (version ${version})`,
    };
  const r = projectSchema.safeParse(raw);
  if (r.success) return { ok: true, project: r.data };
  const issues = r.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
  return { ok: false, error: `${PROJECT_FILE}: ${issues.join("; ")}` };
}

export function newProjectText(fields: { name: string; body: Body; height_cm?: number | null }): string {
  const lines = [
    "# Tattoo Planner project. The planner keeps this file up to date; editing it by hand is fine.",
    "# body: the sample body the project starts from (female | male); height_cm is optional.",
    `version: ${PROJECT_VERSION}`,
  ];
  const doc = parseDocument(lines.join("\n") + "\n");
  doc.set("name", fields.name.trim());
  doc.set("body", fields.body);
  if (fields.height_cm != null) doc.set("height_cm", fields.height_cm);
  return doc.toString();
}

function parseOrThrow(original: string): Document.Parsed {
  const doc = parseDocument(original);
  if (doc.errors.length > 0) throw new Error(`${PROJECT_FILE}: YAML syntax: ${doc.errors[0]!.message}`);
  return doc;
}

function checked(doc: Document.Parsed): string {
  const text = doc.toString();
  const check = parseProjectText(text);
  if (!check.ok) throw new Error(check.error);
  return text;
}

/** The `persons:` entry of a person, or null. */
function personNode(doc: Document.Parsed, id: string): YAMLMap | null {
  const seq = doc.get("persons");
  if (!isSeq(seq)) return null;
  for (const item of seq.items) if (isMap(item) && item.get("id") === id) return item;
  return null;
}

/** The map that holds a person's body, height and active variants: the top level for the root person. */
function personHolder(doc: Document.Parsed, personId: string): YAMLMap | Document.Parsed {
  if (personId === ROOT_PERSON_ID) return doc;
  const node = personNode(doc, personId);
  if (!node) throw new Error(`${PROJECT_FILE}: no person ${personId}`);
  return node;
}

/** Adds a key; at the top level it goes before `persons:`, so the root person's keys stay together. */
function insertBeforePersons(
  doc: Document.Parsed,
  holder: YAMLMap | Document.Parsed,
  key: string,
  value: unknown,
): void {
  const map = holder === doc ? doc.contents : holder;
  const at = isMap(map)
    ? map.items.findIndex((p) => (isScalar(p.key) ? p.key.value : p.key) === "persons")
    : -1;
  if (holder !== doc || !isMap(map) || at < 0) {
    holder.set(key, doc.createNode(value));
    return;
  }
  map.items.splice(at, 0, doc.createPair(key, value));
}

/**
 * Applies a patch to the text of project.yaml; comments and unknown keys stay. `name` is the
 * project's; body, height and active variants go to `personId` (the root person: the top level).
 */
export function updateProjectText(
  original: string,
  patch: ProjectPatch,
  personId: string = ROOT_PERSON_ID,
): string {
  const doc = parseOrThrow(original);
  if (patch.name !== undefined) doc.set("name", patch.name.trim());
  const holder = personHolder(doc, personId);
  if (patch.body !== undefined) holder.set("body", patch.body);
  if (patch.height_cm === null) holder.delete("height_cm");
  else if (patch.height_cm !== undefined) holder.set("height_cm", patch.height_cm);
  if (patch.active) {
    for (const [region, name] of Object.entries(patch.active)) {
      if (name === undefined) continue;
      if (name === null) holder.deleteIn(["active", region]);
      else if (holder.has("active")) holder.setIn(["active", region], name);
      else insertBeforePersons(doc, holder, "active", { [region]: name });
    }
    const map = holder.get("active");
    if (isMap(map) && map.items.length === 0) holder.delete("active");
  }
  return checked(doc);
}

export type NewPersonFields = { id: string; name: string; body: Body; height_cm?: number | null };

/** Adds a person at the end of `persons:` (created when missing). */
export function addPersonText(original: string, fields: NewPersonFields): string {
  const doc = parseOrThrow(original);
  if (fields.id === ROOT_PERSON_ID || personNode(doc, fields.id))
    throw new Error(`${PROJECT_FILE}: person ${fields.id} exists already`);
  const entry: Record<string, unknown> = { id: fields.id, name: fields.name.trim(), body: fields.body };
  if (fields.height_cm != null) entry.height_cm = fields.height_cm;
  if (!isSeq(doc.get("persons"))) {
    if (!doc.contents || !isMap(doc.contents)) throw new Error(`${PROJECT_FILE}: not a map`);
    const key = doc.createNode("persons");
    key.commentBefore =
      " Further persons, each with own body and layouts in persons/<id>/ (the top level is the\n first person's; docs/adr/0017-persons.md).";
    doc.contents.items.push(doc.createPair(key, doc.createNode([])));
  }
  doc.addIn(["persons"], doc.createNode(entry));
  return checked(doc);
}

/**
 * Renames a person or changes their body or height. The root person's name goes into its own
 * `persons:` entry (created, first in the list, when missing); its body and height stay top-level.
 */
export function updatePersonText(
  original: string,
  id: string,
  patch: { name?: string; body?: Body; height_cm?: number | null },
): string {
  let text = original;
  if (patch.body !== undefined || patch.height_cm !== undefined)
    text = updateProjectText(text, { body: patch.body, height_cm: patch.height_cm }, id);
  if (patch.name === undefined) return text;
  const doc = parseOrThrow(text);
  const name = patch.name.trim();
  const node = personNode(doc, id);
  if (!node && id === ROOT_PERSON_ID) {
    const entry = doc.createNode({ id: ROOT_PERSON_ID, name });
    const seq = doc.get("persons");
    if (isSeq(seq)) seq.items.unshift(entry);
    else doc.set("persons", doc.createNode([{ id: ROOT_PERSON_ID, name }]));
    return checked(doc);
  }
  if (!node) throw new Error(`${PROJECT_FILE}: no person ${id}`);
  node.set("name", name);
  return checked(doc);
}

/** Removes a person's entry (never the root person's data, which is the project's top level). */
export function removePersonText(original: string, id: string): string {
  if (id === ROOT_PERSON_ID) throw new Error("The first person's data is the project itself.");
  const doc = parseOrThrow(original);
  const seq = doc.get("persons");
  if (!isSeq(seq)) throw new Error(`${PROJECT_FILE}: no person ${id}`);
  const i = seq.items.findIndex((item) => isMap(item) && item.get("id") === id);
  if (i < 0) throw new Error(`${PROJECT_FILE}: no person ${id}`);
  seq.items.splice(i, 1);
  if (seq.items.length === 0) doc.delete("persons");
  return checked(doc);
}
