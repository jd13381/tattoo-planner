// Reading and writing config/projections/*.yaml so hand edits survive: only the numbers that changed
// are rewritten in place, comments and flow style stay as they are.
import { isMap, isScalar, isSeq, parseDocument, type Document } from "yaml";
import { projectionSchema, type ProjectionCalibration } from "./schema.ts";

export type ProjectionParse = { ok: true; calibration: ProjectionCalibration } | { ok: false; error: string };

export function parseProjection(text: string): ProjectionParse {
  const doc = parseDocument(text);
  if (doc.errors.length > 0) return { ok: false, error: `YAML syntax: ${doc.errors[0]!.message}` };
  const r = projectionSchema.safeParse(doc.toJS());
  if (r.success) return { ok: true, calibration: r.data };
  return {
    ok: false,
    error: r.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; "),
  };
}

type Path = (string | number)[];

/** Paths of the leaves where `next` differs from `prev` (arrays of different length count as one leaf). */
function changedPaths(prev: unknown, next: unknown, path: Path = []): Path[] {
  if (Array.isArray(prev) && Array.isArray(next) && prev.length === next.length)
    return prev.flatMap((p, i) => changedPaths(p, next[i], [...path, i]));
  if (isPlain(prev) && isPlain(next)) {
    const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
    return [...keys].flatMap((k) => changedPaths(prev[k], next[k], [...path, k]));
  }
  return JSON.stringify(prev) === JSON.stringify(next) ? [] : [path];
}

const isPlain = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);

function setValue(doc: Document, path: Path, value: unknown) {
  const node = doc.getIn(path, true);
  if (value === undefined) {
    doc.deleteIn(path);
  } else if (isScalar(node) && (typeof value !== "object" || value === null)) {
    node.value = value; // keeps the node's comment
  } else {
    const created = doc.createNode(value);
    // Points and short lists read best on one line, as in the hand-written file.
    if ((isMap(created) || isSeq(created)) && path.length > 1) created.flow = true;
    doc.setIn(path, created);
  }
}

/** Applies `calibration` to the original text; returns the new text. */
export function updateProjectionText(original: string, calibration: ProjectionCalibration): string {
  const doc = parseDocument(original);
  const before = projectionSchema.safeParse(doc.toJS());
  // Compare with the original as the schema reads it, so defaults the file leaves out stay out.
  const prev = before.success ? before.data : doc.toJS();
  for (const path of changedPaths(prev, calibration)) setValue(doc, path, valueAt(calibration, path));
  // Prettier's flow style: padded maps ({ x: 1 }), unpadded lists ([1, 2]).
  return doc
    .toString({ lineWidth: 0, flowCollectionPadding: true })
    .replace(/\[ /g, "[")
    .replace(/ \]/g, "]");
}

function valueAt(root: unknown, path: Path): unknown {
  let cur: unknown = root;
  for (const k of path) cur = (cur as Record<string | number, unknown> | undefined)?.[k];
  return cur;
}

/** A fresh calibration file. */
export function newProjectionText(calibration: ProjectionCalibration): string {
  return updateProjectionText(
    `# Projection ${calibration.name} (docs/adr/0006-anubis-projection.md). Edited in the Tattoo Planner.\nname: ${calibration.name}\n`,
    calibration,
  );
}
