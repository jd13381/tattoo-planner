// The text of config/measurements.yaml as the page knows it. Loaded the way it always was (bundled
// with `?raw`); a save or a hand edit of the file replaces it in place, without a page reload, so
// unsaved work in other tabs survives. `saveMeasurementsText` is the one place that talks to the dev
// server: rewire it (and the import below) when the measurements move into the project folder.
import { useSyncExternalStore } from "react";
import initialText from "../../config/measurements.yaml?raw";
import { parseMeasurements } from "../config/loadMeasurements.ts";

let text: string = initialText;
const listeners = new Set<() => void>();

function setText(next: string) {
  if (next === text) return;
  text = next;
  for (const l of listeners) l();
}

export function getMeasurementsText(): string {
  return text;
}

export function subscribeMeasurements(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The current text of measurements.yaml; re-renders when it is saved or edited by hand. */
export function useMeasurementsText(): string {
  return useSyncExternalStore(subscribeMeasurements, getMeasurementsText);
}

/** Writes the full text of measurements.yaml (validated by the dev server) and makes it current. */
export async function saveMeasurementsText(next: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch("/api/measurements", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: next }),
    });
  } catch {
    throw new Error("Cannot reach the planner's dev server. Restart the planner and try again.");
  }
  const body = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
  if (!res.ok || typeof body.text !== "string") throw new Error(body.error ?? `save failed (${res.status})`);
  setText(body.text);
}

/** The `existing` block, which the pages read once at load (src/viewer/useArm.ts `anubisSize`). */
function existingOf(t: string): string {
  const r = parseMeasurements(t);
  return r.ok ? JSON.stringify(r.measurements.existing ?? null) : "";
}

// A save (or a hand edit) changes the file on disk, and Vite sends the new text here instead of
// reloading the page; only a changed `existing` block still reloads.
if (import.meta.hot) {
  const hot = import.meta.hot;
  hot.accept("../../config/measurements.yaml?raw", (mod) => {
    if (!mod || typeof mod.default !== "string") return;
    if (existingOf(mod.default) !== existingOf(initialText))
      hot.invalidate("measurements.yaml: existing changed");
    else setText(mod.default);
  });
}
