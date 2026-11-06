// The persons of the open project, as the Assets API needs them (docs/adr/0020-asset-structure.md).
// A seam for the persons work: today the implicit person (the top-level layouts/ and projections/,
// or the app's config/ for an old data folder) plus every valid persons/<id>/ folder. When the
// persons API lands, only this function changes.
import { readdir } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_PERSON_ID, PERSON_ID, PERSONS_FOLDER, type PersonRef } from "../src/project/persons.ts";
import { readProjectFile } from "./project/folder.ts";
import type { ProjectPaths } from "./project/store.ts";

export type PersonDirs = PersonRef & {
  layoutsDir: string | null;
  projectionsDir: string | null;
};

/** Names given in project.yaml's optional `persons:` list ({ id, name }), by id. */
async function personNames(dir: string): Promise<Map<string, string>> {
  const r = await readProjectFile(dir).catch(() => null);
  const list = r?.ok ? (r.project as { persons?: unknown }).persons : undefined;
  const names = new Map<string, string>();
  if (Array.isArray(list))
    for (const p of list as { id?: unknown; name?: unknown }[])
      if (typeof p?.id === "string" && typeof p.name === "string") names.set(p.id, p.name);
  return names;
}

/** Every person of the project; the implicit one first. Empty when no project is open. */
export async function projectPersons(paths: ProjectPaths): Promise<PersonDirs[]> {
  if (!paths.dir) return [];
  const names = await personNames(paths.dir);
  const out: PersonDirs[] = [
    {
      id: DEFAULT_PERSON_ID,
      name: names.get(DEFAULT_PERSON_ID) ?? null,
      implicit: true,
      layoutsDir: paths.layoutsDir,
      projectionsDir: paths.projectionsDir,
    },
  ];
  let entries: { name: string; isDirectory(): boolean }[] = [];
  try {
    entries = await readdir(path.join(paths.dir, PERSONS_FOLDER), { withFileTypes: true });
  } catch {
    // no persons/ folder: only the implicit person
  }
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!e.isDirectory() || !PERSON_ID.test(e.name) || e.name === DEFAULT_PERSON_ID) continue;
    const base = path.join(paths.dir, PERSONS_FOLDER, e.name);
    out.push({
      id: e.name,
      name: names.get(e.name) ?? e.name,
      implicit: false,
      layoutsDir: path.join(base, "layouts"),
      projectionsDir: path.join(base, "projections"),
    });
  }
  return out;
}

/** The persons of a folder opened without the store (tests, the sample): top-level folders only. */
export function folderPersons(dir: string): PersonDirs[] {
  return [
    {
      id: DEFAULT_PERSON_ID,
      name: null,
      implicit: true,
      layoutsDir: path.join(dir, "layouts"),
      projectionsDir: path.join(dir, "projections"),
    },
  ];
}
