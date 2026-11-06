// The text of measurements.yaml and the project's body choice as the page knows them. Both load once
// before the app renders (src/project/projectData.ts); a save from Settings → Body & measurements
// replaces them in place, without a page reload, so unsaved work in other tabs survives.
// `saveMeasurementsText` and `saveBodyChoice` are the only places that talk to the server.
import { useSyncExternalStore } from "react";
import { updateProject } from "../project/api.ts";
import { takePersons } from "../project/personsStore.ts";
import { measurementsText as initialText, projectStatus } from "../project/projectData.ts";
import { PROJECT_ENDPOINT, type MeasurementsFile, type ProjectStatus } from "../project/schema.ts";

/** Body and height in project.yaml (null: not given there, measurements.yaml decides). */
export type ProjectBody = Pick<ProjectStatus, "body" | "height_cm"> | null;

type State = { text: string; project: ProjectBody };

let state: State = {
  text: initialText,
  project: projectStatus ? { body: projectStatus.body, height_cm: projectStatus.height_cm } : null,
};
const listeners = new Set<() => void>();

function set(next: Partial<State>) {
  state = { ...state, ...next };
  for (const l of listeners) l();
}

export function getMeasurementsText(): string {
  return state.text;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The current text of measurements.yaml and the project's body choice; re-renders after a save. */
export function useMeasurementsState(): State {
  return useSyncExternalStore(subscribe, () => state);
}

/** Whether body and height belong in project.yaml (a project folder) rather than measurements.yaml. */
export function bodyInProject(): boolean {
  return projectStatus?.status === "project";
}

/** Writes the full text of measurements.yaml (validated by the server) and makes it current. */
export async function saveMeasurementsText(next: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${PROJECT_ENDPOINT}/measurements`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: next }),
    });
  } catch {
    throw new Error("Cannot reach the planner's server. Restart the planner and try again.");
  }
  const body = (await res.json().catch(() => ({}))) as Partial<MeasurementsFile> & { error?: string };
  if (!res.ok || typeof body.text !== "string") throw new Error(body.error ?? `save failed (${res.status})`);
  set({ text: body.text });
}

/**
 * Writes body and height into project.yaml (only for a project folder, see bodyInProject): the
 * current person's, so the root person's top level or another person's entry.
 */
export async function saveBodyChoice(patch: {
  body?: NonNullable<ProjectStatus["body"]>;
  height_cm?: number | null;
}): Promise<void> {
  const p = await updateProject({
    ...(patch.body ? { body: patch.body } : {}),
    ...(patch.height_cm !== undefined ? { height_cm: patch.height_cm } : {}),
  });
  set({ project: { body: p.body, height_cm: p.height_cm } });
  // The current person's body and height (docs/adr/0017-persons.md): Home and the person chip.
  takePersons(p);
}
