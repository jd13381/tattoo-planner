// The persons of the open project as the Assets API needs them (docs/adr/0020-asset-structure.md):
// each person's layouts/ and projections/ folders, so references count every person's use of an image.
// The list itself is the store's (docs/adr/0017-persons.md).
import path from "node:path";
import type { PersonRef } from "../src/assets/types.ts";
import { ROOT_PERSON_DEFAULT_NAME, ROOT_PERSON_ID, type PersonInfo } from "../src/project/persons.ts";
import type { ProjectPaths } from "./project/store.ts";

export type PersonDirs = PersonRef & {
  layoutsDir: string | null;
  projectionsDir: string | null;
};

/**
 * Every person of the project with their folders; the root person first when the project has no
 * persons list. `paths` are the current person's; a legacy folder (no persons) keeps the app's config/.
 * Empty when no project is open.
 */
export function projectPersons(paths: ProjectPaths, persons: readonly PersonInfo[]): PersonDirs[] {
  const dir = paths.dir;
  if (!dir) return [];
  if (persons.length === 0)
    return [
      {
        id: ROOT_PERSON_ID,
        name: ROOT_PERSON_DEFAULT_NAME,
        implicit: true,
        layoutsDir: paths.layoutsDir,
        projectionsDir: paths.projectionsDir,
      },
    ];
  return persons.map((p) => {
    const current = p.id === paths.person;
    const base = p.folder ? path.join(dir, ...p.folder.split("/")) : dir;
    return {
      id: p.id,
      name: p.name,
      implicit: p.root,
      layoutsDir: current ? paths.layoutsDir : path.join(base, "layouts"),
      projectionsDir: current ? paths.projectionsDir : path.join(base, "projections"),
    };
  });
}

/** The persons of a folder opened without the store (tests, the sample): top-level folders only. */
export function folderPersons(dir: string): PersonDirs[] {
  return [
    {
      id: ROOT_PERSON_ID,
      name: ROOT_PERSON_DEFAULT_NAME,
      implicit: true,
      layoutsDir: path.join(dir, "layouts"),
      projectionsDir: path.join(dir, "projections"),
    },
  ];
}
