// The persons of the open project as the page knows them (docs/adr/0017-persons.md): loaded once
// with the project status (src/project/projectData.ts); marking an active variant or editing a
// person replaces them in place. Switching person reloads the page, like switching project.
import { useSyncExternalStore } from "react";
import type { RegionId } from "../body/regions.ts";
import { updatePerson, updateProject } from "./api.ts";
import type { PersonInfo } from "./persons.ts";
import { projectStatus } from "./projectData.ts";
import type { Body, ProjectStatus } from "./schema.ts";

export type PersonsState = {
  persons: PersonInfo[];
  /** The person every tab shows; null without a project.yaml (legacy folder, broken file). */
  current: PersonInfo | null;
};

function fromStatus(s: Pick<ProjectStatus, "persons" | "person"> | null): PersonsState {
  const persons = s?.persons ?? [];
  return { persons, current: persons.find((p) => p.id === s?.person) ?? null };
}

let state: PersonsState = fromStatus(projectStatus);
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Takes the persons from a fresh project status (after a PATCH). */
export function takePersons(s: ProjectStatus): void {
  state = fromStatus(s);
  for (const l of listeners) l();
}

export function usePersons(): PersonsState {
  return useSyncExternalStore(subscribe, () => state);
}

export function getPersons(): PersonsState {
  return state;
}

/** Marks a variant as the region's active one for the current person (null: back to the first). */
export async function setActiveVariant(region: RegionId, name: string | null): Promise<void> {
  takePersons(await updateProject({ active: { [region]: name } }));
}

/** Renames a person or changes their body or height; reload when it was the current person's body. */
export async function editPerson(
  id: string,
  patch: { name?: string; body?: Body; height_cm?: number | null },
): Promise<ProjectStatus> {
  const s = await updatePerson(id, patch);
  takePersons(s);
  return s;
}
