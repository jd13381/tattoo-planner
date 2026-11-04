// Contract between the image-edit endpoint (dev server) and the browser. Two engines: `claude -p`
// with local tools (docs/adr/0007-image-edits.md) and the OpenAI Images API for generative edits
// (docs/adr/0008-generative-edits.md).

/** GET → EditOverview; POST body EditRequest → EditJob. */
export const EDITS_ENDPOINT = "/api/edits";

/** Folder in the data folder where kept edits are written (never next to the originals). */
export const EDITS_FOLDER = "edits";

/** Tag added to every kept edit, so the Assets panel can filter them. */
export const EDITED_TAG = "edited";

/** Folder in the data folder where kept new images (created, not edited) are written. */
export const GENERATED_FOLDER = "generated";
/** Tag added to every kept new image. */
export const GENERATED_TAG = "generated";
/** Kind of a kept new image in the manifest. */
export const GENERATED_KIND = "idea";

/** "edit": change an existing image; "create": make a new one (GPT Image only). */
export type EditMode = "edit" | "create";
export type CreateSize = "auto" | "1024x1024" | "1536x1024" | "1024x1536";
export type CreateBackground = "auto" | "transparent" | "opaque";

export const CREATE_SIZES: readonly { value: CreateSize; label: string }[] = [
  { value: "1024x1024", label: "Square" },
  { value: "1024x1536", label: "Portrait (tall)" },
  { value: "1536x1024", label: "Landscape (wide)" },
  { value: "auto", label: "Let the model choose" },
];
export const CREATE_BACKGROUNDS: readonly { value: CreateBackground; label: string }[] = [
  { value: "transparent", label: "Transparent" },
  { value: "opaque", label: "White / opaque" },
  { value: "auto", label: "Let the model choose" },
];

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
  /** Set for a new image (mode "create"): the name its kept file and id are built from. */
  created?: { name: string };
  /** Asset ids sent as reference images with this job. */
  references?: string[];
  /** Rough cost in USD of a generative edit, from the token usage the API reported. */
  costUsd?: number;
  /** Set when state is "done" or "kept". */
  output?: { width: number; height: number; bytes: number; alpha: boolean };
  /** Set when state is "kept": the new manifest entry. */
  kept?: { id: string; file: string };
  /** Editing session the job belongs to (docs/adr/0010-editing-sessions.md). */
  session?: string;
};

/**
 * One editing session: a source (a manifest image, or a blank artboard for a new image) and a linear
 * stack of versions. v0 is the source; `versions[i]` is the job whose result is v(i+1). The next run
 * always starts from the last version. Sessions live in the dev server's memory until closed.
 */
export type EditSession = {
  id: string;
  mode: EditMode;
  /** Mode "edit": the image the session edits (may itself be a kept edit). */
  assetId?: string;
  /** Mode "create": name, size and background of the new image. */
  create?: { name: string; size: CreateSize; background: CreateBackground };
  /** Job ids of v1 … vN, oldest first. */
  versions: string[];
  startedAt: string;
};

/** POST /api/edits/sessions: open a session on an image, or for a new image. */
export type SessionRequest =
  | { mode: "edit"; assetId: string }
  | { mode: "create"; name?: string; size?: CreateSize; background?: CreateBackground };

export type EditOverview = {
  /** Local edits with `claude -p`. */
  availability: EditAvailability;
  /** Generative edits with the OpenAI Images API. */
  generative: GenerativeAvailability;
  jobs: EditJob[];
  /** Open editing sessions, oldest first. */
  sessions: EditSession[];
};

export type EditRequest = {
  /** Session to run in: the source is then its last version, and assetId / fromJob / mode are ignored. */
  session?: string;
  /** The image to edit (mode "edit" without fromJob). */
  assetId?: string;
  instruction: string;
  fromJob?: string;
  engine?: EditEngine;
  /** Default "edit". "create" makes a new image and needs engine "openai". */
  mode?: EditMode;
  /** Asset ids to send as reference images (GPT Image only). */
  references?: string[];
  /** Mode "create": name of the new image (becomes its id and file name). */
  name?: string;
  /** Mode "create": output size and background. */
  size?: CreateSize;
  background?: CreateBackground;
};

/** Generative variants one click may ask for (each one is its own job). */
export const MAX_VARIANTS_PER_RUN = 3;

export function sessionUrl(id: string, action?: "pick" | "truncate" | "save" | "close"): string {
  return `${EDITS_ENDPOINT}/sessions/${encodeURIComponent(id)}${action ? `/${action}` : ""}`;
}

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
