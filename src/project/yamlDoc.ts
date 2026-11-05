// Reads and writes project.yaml as text, keeping comments, key order and unknown keys (like layouts).
import { parseDocument } from "yaml";
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

/** Applies a patch to the text of project.yaml; comments and unknown keys stay. */
export function updateProjectText(original: string, patch: ProjectPatch): string {
  const doc = parseDocument(original);
  if (doc.errors.length > 0) throw new Error(`${PROJECT_FILE}: YAML syntax: ${doc.errors[0]!.message}`);
  if (patch.name !== undefined) doc.set("name", patch.name.trim());
  if (patch.body !== undefined) doc.set("body", patch.body);
  if (patch.height_cm === null) doc.delete("height_cm");
  else if (patch.height_cm !== undefined) doc.set("height_cm", patch.height_cm);
  const text = doc.toString();
  const check = parseProjectText(text);
  if (!check.ok) throw new Error(check.error);
  return text;
}
