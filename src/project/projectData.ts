// What the page knows about the open project before the app renders: its status and the text of
// measurements.yaml. main.tsx loads both once; switching projects reloads the page, so these module
// values never change while the app runs and the body hooks can read them synchronously.
import type { Measurements } from "../config/measurements.ts";
import { PROJECT_ENDPOINT, type MeasurementsFile, type ProjectStatus } from "./schema.ts";

/** Used when the project has no measurements.yaml yet: every value comes from the sample body. */
export const EMPTY_MEASUREMENTS_TEXT = "units: cm\n";

export let projectStatus: ProjectStatus | null = null;
export let measurementsText: string = EMPTY_MEASUREMENTS_TEXT;
/** Whether the project has a measurements.yaml (false: the empty default above). */
export let measurementsFound = false;
/** Why the project could not be asked (the planner's server did not answer). */
export let loadError: string | null = null;

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return (await r.json()) as T;
}

export async function loadProjectData(): Promise<void> {
  try {
    const [status, file] = await Promise.all([
      getJson<ProjectStatus>(PROJECT_ENDPOINT),
      getJson<MeasurementsFile>(`${PROJECT_ENDPOINT}/measurements`),
    ]);
    projectStatus = status;
    measurementsFound = file.text !== null;
    measurementsText = file.text ?? EMPTY_MEASUREMENTS_TEXT;
  } catch (e) {
    loadError = String(e);
  }
}

/**
 * project.yaml is the source for body and height (docs/adr/0012); measurements.yaml may still
 * name them (the place before projects existed) and is used where project.yaml says nothing.
 */
export function withProjectBody(
  m: Measurements | null,
  project: Pick<ProjectStatus, "body" | "height_cm"> | null = projectStatus,
): Measurements | null {
  if (!project || (project.body === null && project.height_cm === null)) return m;
  return {
    ...(m ?? { units: "cm" }),
    ...(project.body !== null ? { body: project.body } : {}),
    ...(project.height_cm !== null ? { height_cm: project.height_cm } : {}),
  };
}
