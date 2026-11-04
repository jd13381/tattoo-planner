// Contract between the image-edit endpoint (dev server, runs `claude -p` locally) and the browser.
// See docs/adr/0007-image-edits.md.

/** GET → EditOverview; POST body EditRequest → EditJob. */
export const EDITS_ENDPOINT = "/api/edits";

/** Folder in the data folder where kept edits are written (never next to the originals). */
export const EDITS_FOLDER = "edits";

/** Tag added to every kept edit, so the Assets panel can filter them. */
export const EDITED_TAG = "edited";

export type EditAvailability = { enabled: true; claude: string } | { enabled: false; reason: string };

export type EditJobState = "running" | "done" | "failed" | "cancelled" | "kept" | "discarded";

export type EditJob = {
  id: string;
  /** Manifest asset the chain started from (the original image). */
  assetId: string;
  /** Job whose result this one edits further, if any. */
  fromJob?: string;
  /** Every instruction in the chain, oldest first; the last one is this job's. */
  instructions: string[];
  state: EditJobState;
  startedAt: string;
  finishedAt?: string;
  /** Progress lines: Claude's remarks and the commands it ran. */
  log: string[];
  /** Claude's closing summary. */
  summary?: string;
  error?: string;
  /** Set when state is "done" or "kept". */
  output?: { width: number; height: number; bytes: number; alpha: boolean };
  /** Set when state is "kept": the new manifest entry. */
  kept?: { id: string; file: string };
};

export type EditOverview = { availability: EditAvailability; jobs: EditJob[] };

export type EditRequest = { assetId: string; instruction: string; fromJob?: string };

export function jobUrl(id: string, action?: "keep" | "discard" | "cancel" | "input" | "output"): string {
  return `${EDITS_ENDPOINT}/jobs/${encodeURIComponent(id)}${action ? `/${action}` : ""}`;
}

/** One-click instructions; Jan can edit the text before running it. */
export const EDIT_PRESETS: readonly { label: string; instruction: string }[] = [
  {
    label: "Remove background",
    instruction:
      "Remove the background completely and make it transparent. Keep the motif itself unchanged, with clean, slightly soft edges.",
  },
  {
    label: "Keep main figure only",
    instruction:
      "Keep only the main figure. Remove the background and every other object, text, frame or watermark; make all of that transparent.",
  },
  {
    label: "Remove text / watermark",
    instruction:
      "Remove any text, logos, watermarks and UI elements and fill those areas so they match their surroundings. Change nothing else.",
  },
  {
    label: "Stronger contrast",
    instruction:
      "Increase contrast and clarity a little so the line work reads well, without changing colours or the motif.",
  },
  {
    label: "Black and grey",
    instruction:
      "Convert to black and grey (no colour), as a tattoo would be shaded, with deep blacks and a clean white background.",
  },
  {
    label: "Trim to motif",
    instruction: "Crop tightly to the motif with a small margin, and straighten it if it is tilted.",
  },
  { label: "Mirror", instruction: "Mirror the image left to right. Change nothing else." },
];
