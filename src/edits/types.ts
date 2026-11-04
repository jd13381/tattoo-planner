// Contract between the image-edit endpoint (dev server) and the browser. Two engines: `claude -p`
// with local tools (docs/adr/0007-image-edits.md) and the OpenAI Images API for generative edits
// (docs/adr/0008-generative-edits.md).

/** GET → EditOverview; POST body EditRequest → EditJob. */
export const EDITS_ENDPOINT = "/api/edits";

/** Folder in the data folder where kept edits are written (never next to the originals). */
export const EDITS_FOLDER = "edits";

/** Tag added to every kept edit, so the Assets panel can filter them. */
export const EDITED_TAG = "edited";

/** "claude": local tools driven by `claude -p`; "openai": generative edit with GPT Image. */
export type EditEngine = "claude" | "openai";

export type EditAvailability = { enabled: true; claude: string } | { enabled: false; reason: string };
export type GenerativeAvailability = { enabled: true; model: string } | { enabled: false; reason: string };

export type EditJobState = "running" | "done" | "failed" | "cancelled" | "kept" | "discarded";

export type EditJob = {
  id: string;
  /** Manifest asset the chain started from (the original image). */
  assetId: string;
  /** Job whose result this one edits further, if any. */
  fromJob?: string;
  /** Engine of this job. */
  engine: EditEngine;
  /** Every instruction in the chain, oldest first; the last one is this job's. */
  instructions: string[];
  /** Engine (or model) that applied each instruction, same order as `instructions`. */
  tools: string[];
  state: EditJobState;
  startedAt: string;
  finishedAt?: string;
  /** Progress lines: Claude's remarks and the commands it ran. */
  log: string[];
  /** Claude's closing summary. */
  summary?: string;
  error?: string;
  /** Rough cost in USD of a generative edit, from the token usage the API reported. */
  costUsd?: number;
  /** Set when state is "done" or "kept". */
  output?: { width: number; height: number; bytes: number; alpha: boolean };
  /** Set when state is "kept": the new manifest entry. */
  kept?: { id: string; file: string };
};

export type EditOverview = {
  /** Local edits with `claude -p`. */
  availability: EditAvailability;
  /** Generative edits with the OpenAI Images API. */
  generative: GenerativeAvailability;
  jobs: EditJob[];
};

export type EditRequest = { assetId: string; instruction: string; fromJob?: string; engine?: EditEngine };

/** Generative variants one click may ask for (each one is its own job). */
export const MAX_VARIANTS_PER_RUN = 3;

export function jobUrl(id: string, action?: "keep" | "discard" | "cancel" | "input" | "output"): string {
  return `${EDITS_ENDPOINT}/jobs/${encodeURIComponent(id)}${action ? `/${action}` : ""}`;
}

/** One-click instructions; Jan can edit the text before running it. `engine` picks the engine too. */
export const EDIT_PRESETS: readonly { label: string; instruction: string; engine?: EditEngine }[] = [
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
  {
    label: "Simplify (generative)",
    engine: "openai",
    instruction:
      "Simplify the motif for a tattoo: fewer small details, clearer and bolder shapes, same style and composition.",
  },
  {
    label: "Remove an object (generative)",
    engine: "openai",
    instruction:
      "Remove the … and fill the area behind it so it matches the rest of the image. Change nothing else.",
  },
];
