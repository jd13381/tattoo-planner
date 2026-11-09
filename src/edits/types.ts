// Contract between the image-edit endpoint (dev server) and the browser. Two engines: built-in image
// operations that the page runs itself and uploads as a new version (docs/adr/0013-builtin-image-
// operations.md), and the OpenAI Images API for generative edits (docs/adr/0008-generative-edits.md).

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

/** "builtin": a local operation run in the page (no key, no network); "openai": generative edit with GPT Image. */
export type EditEngine = "builtin" | "openai";

export type BuiltinAvailability = { enabled: true } | { enabled: false; reason: string };
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
  /** Progress lines of a generative request. */
  log: string[];
  error?: string;
  /**
   * Set for a new image (mode "create"): the name its kept file and id are built from; `tileable`
   * for a background (Background mode, docs/adr/0019): seam-fixed and kept in backgrounds/.
   */
  created?: { name: string; tileable?: boolean };
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
  /** Mode "create": name, size and background of the new image; `tileable` for a background tile. */
  create?: { name: string; size: CreateSize; background: CreateBackground; tileable?: boolean };
  /** Job ids of v1 … vN, oldest first. */
  versions: string[];
  startedAt: string;
};

/** POST /api/edits/sessions: open a session on an image, or for a new image. */
export type SessionRequest =
  | { mode: "edit"; assetId: string }
  | { mode: "create"; name?: string; size?: CreateSize; background?: CreateBackground; tileable?: boolean };

export type EditOverview = {
  /** Built-in operations (they need only the data folder). */
  builtin: BuiltinAvailability;
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
  /** Only "openai" (the default); built-in operations go to sessionUrl(id, "apply"). */
  engine?: EditEngine;
  /** Default "edit". "create" makes a new image. */
  mode?: EditMode;
  /** Asset ids to send as reference images (GPT Image only). */
  references?: string[];
  /** Mode "create": name of the new image (becomes its id and file name). */
  name?: string;
  /** Mode "create": output size and background. */
  size?: CreateSize;
  background?: CreateBackground;
  /** Mode "create": a seamless background tile (square, opaque, seam-fixed; docs/adr/0019). */
  tileable?: boolean;
};

/** Generative variants one click may ask for (each one is its own job). */
export const MAX_VARIANTS_PER_RUN = 3;

/**
 * Built-in operation result: POST sessionUrl(id, "apply") with the PNG as the body (Content-Type
 * image/png) and these query parameters. The server adds it to the session as its next version.
 */
export type ApplyQuery = {
  /** How the step is named in the version strip and the notes, e.g. "Mirror". */
  step: string;
  /** Number of versions the page saw when it ran the operation; a changed session refuses the result. */
  base: number;
};

export function applyUrl(sessionId: string, q: ApplyQuery): string {
  return `${sessionUrl(sessionId, "apply")}?${new URLSearchParams({ step: q.step, base: String(q.base) })}`;
}

export function sessionUrl(
  id: string,
  action?: "pick" | "truncate" | "save" | "close" | "apply" | "source",
): string {
  return `${EDITS_ENDPOINT}/sessions/${encodeURIComponent(id)}${action ? `/${action}` : ""}`;
}

export function jobUrl(id: string, action?: "keep" | "discard" | "cancel" | "input" | "output"): string {
  return `${EDITS_ENDPOINT}/jobs/${encodeURIComponent(id)}${action ? `/${action}` : ""}`;
}

/** One-click instructions for GPT Image; Jan can edit the text before running it. */
/** Clean-up of a tattoo photo for a projection (docs/adr/0023): the ink alone, in place. */
export const INK_ONLY_INSTRUCTION =
  "Keep only the tattoo ink, exactly where it is. Remove the skin, its shadows and highlights, hair and the body's shape and everything around it: white or transparent background. Do not move, redraw, straighten or complete any line; keep the image's size and framing.";

export const EDIT_PRESETS: readonly { label: string; instruction: string }[] = [
  {
    label: "Simplify",
    instruction:
      "Simplify the motif for a tattoo: fewer small details, clearer and bolder shapes, same style and composition.",
  },
  {
    label: "Remove an object",
    instruction:
      "Remove the … and fill the area behind it so it matches the rest of the image. Change nothing else.",
  },
  {
    label: "Tattoo ink only",
    instruction: INK_ONLY_INSTRUCTION,
  },
  {
    label: "Remove text / watermark",
    instruction:
      "Remove any text, logos, watermarks and UI elements and fill those areas so they match their surroundings. Change nothing else.",
  },
];
