// Framework-free rules for the OpenAI Images API (ADR 0008, ADR 0009): prompts, the multipart request
// for POST /v1/images/edits (edit one image, or create from reference images), the JSON request for
// POST /v1/images/generations (create from text alone), how the answer becomes PNG bytes, and a cost
// estimate from the reported token usage. The dev-server endpoint (server/editsApi.ts) does the call.
import type { Asset } from "../assets/manifest.ts";
import type { CreateBackground, CreateSize } from "./types.ts";

export const OPENAI_EDITS_URL = "https://api.openai.com/v1/images/edits";
export const OPENAI_GENERATIONS_URL = "https://api.openai.com/v1/images/generations";
/** Best editing model on the public leaderboards in Oct/Nov 2026; Sunburst is the precise-edit variant. */
export const DEFAULT_OPENAI_MODEL = "gpt-image-2.5-sunburst";
/** Generative edits allowed at the same time (each is one API request). */
export const MAX_RUNNING_OPENAI = 4;
/** The API takes images up to 50 MB. */
export const MAX_OPENAI_INPUT_BYTES = 50 * 1024 * 1024;

/** Image types the edit endpoint accepts, by file extension. */
const INPUT_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

export function openaiInputType(file: string): string | null {
  const ext = file.split(".").pop()?.toLowerCase() ?? "";
  return INPUT_TYPES[ext] ?? null;
}

/** A reference image sent along with a request: its asset id and notes, so the prompt can name it. */
export type PromptReference = Pick<Asset, "id" | "notes">;

export type GenerativePromptInput = {
  /** Every instruction of the chain, oldest first; earlier ones are already applied to the input. */
  instructions: string[];
  asset: Pick<Asset, "id" | "kind" | "notes">;
  /** Reference images sent after the image to edit (image 2, 3, …). */
  references?: readonly PromptReference[];
};

function referenceLines(refs: readonly PromptReference[], firstNumber: number): string[] {
  return refs.map(
    (r, i) => `- Image ${firstNumber + i}: reference "${r.id}"${r.notes ? ` (${r.notes.trim()})` : ""}`,
  );
}

/** The prompt sent with the image. Jan writes the instruction; it may be German. */
export function buildGenerativePrompt(p: GenerativePromptInput): string {
  const current = (p.instructions.at(-1) ?? "").trim();
  const refs = p.references ?? [];
  return [
    refs.length > 0
      ? "Edit the first image. It is a reference sketch for planning a tattoo with a tattoo artist."
      : "Edit this image. It is a reference sketch for planning a tattoo with a tattoo artist.",
    "Apply exactly the change described below. Keep everything the instruction does not mention as it is:",
    "the style, the line work, the shading, the composition, the proportions and the background.",
    "Do not add a frame, text, a signature or a watermark.",
    ...(refs.length > 0
      ? [
          "",
          "The other images are references. Use them only for what the instruction asks (a shape, a motif, a style); never copy anything else from them into the result:",
          ...referenceLines(refs, 2),
        ]
      : []),
    "",
    "Change:",
    current,
  ].join("\n");
}

/** The prompt for a new image; reference images, if any, are sent as image 1, 2, … */
export function buildCreatePrompt(instruction: string, references: readonly PromptReference[]): string {
  return [
    "Create a new image for planning a tattoo with a tattoo artist: a motif, an ornament or a pattern as a clean sketch.",
    "Follow the description below. Unless it says otherwise: one motif, centred, on a plain white background, no frame, no text, no signature, no watermark, no skin or body.",
    ...(references.length > 0
      ? [
          "",
          "The attached images are references. Use them only for what the description asks (a shape, a motif, a style):",
          ...referenceLines(references, 1),
        ]
      : []),
    "",
    "Description:",
    instruction.trim(),
  ].join("\n");
}

export type OpenAISettings = {
  apiKey: string;
  model: string;
  /** "high" keeps the input's style and features more faithfully; null leaves the API default. */
  inputFidelity: "high" | "low" | null;
  quality: "high" | "medium" | "low" | "auto";
  /**
   * False: send the image as it is with size "auto" (the answer may come back in another aspect).
   * Missing: pad it to the closest output size and crop the answer back (src/edits/pad.ts).
   */
  padToSize?: false;
};

export type FormImage = { bytes: Uint8Array; fileName: string; mimeType: string };

/** Images one request may carry: the image to edit plus references (the API takes up to 16). */
export const MAX_REFERENCES = 4;

export type EditFormInput = {
  /** The image to edit first, then reference images; or reference images alone when creating. */
  images: readonly FormImage[];
  prompt: string;
  settings: Pick<OpenAISettings, "model" | "inputFidelity" | "quality">;
  size?: CreateSize;
  background?: CreateBackground;
};

/** Multipart body for POST /v1/images/edits: one result, PNG out, size kept unless given. */
export function buildEditForm(p: EditFormInput): FormData {
  const form = new FormData();
  form.set("model", p.settings.model);
  form.set("prompt", p.prompt);
  form.set("n", "1");
  form.set("size", p.size ?? "auto");
  form.set("quality", p.settings.quality);
  form.set("output_format", "png");
  if (p.background && p.background !== "auto") form.set("background", p.background);
  if (p.settings.inputFidelity) form.set("input_fidelity", p.settings.inputFidelity);
  // One image goes as `image`, several as the array field `image[]`.
  const field = p.images.length > 1 ? "image[]" : "image";
  for (const img of p.images)
    form.append(field, new Blob([img.bytes as BlobPart], { type: img.mimeType }), img.fileName);
  return form;
}

/** JSON body for POST /v1/images/generations (a new image from text alone). */
export function buildGenerationBody(p: {
  prompt: string;
  settings: Pick<OpenAISettings, "model" | "quality">;
  size: CreateSize;
  background: CreateBackground;
}): Record<string, string | number> {
  return {
    model: p.settings.model,
    prompt: p.prompt,
    n: 1,
    size: p.size,
    quality: p.settings.quality,
    output_format: "png",
    ...(p.background !== "auto" ? { background: p.background } : {}),
  };
}

export type ImageUsage = {
  input_tokens?: number;
  output_tokens?: number;
  input_tokens_details?: { text_tokens?: number; image_tokens?: number };
};

export type EditResponse =
  | { ok: true; png: Uint8Array; usage: ImageUsage | null; revisedPrompt?: string }
  | { ok: false; message: string };

/** Reads the JSON answer of the edit endpoint (success or error). */
export function parseEditResponse(status: number, body: unknown): EditResponse {
  const b = (body ?? {}) as {
    data?: { b64_json?: unknown; revised_prompt?: unknown }[];
    usage?: ImageUsage;
    error?: { message?: unknown; code?: unknown };
  };
  if (status < 200 || status >= 300 || b.error) {
    const msg = typeof b.error?.message === "string" ? b.error.message : `HTTP ${status}`;
    return { ok: false, message: `OpenAI: ${msg}` };
  }
  const first = b.data?.[0];
  if (!first || typeof first.b64_json !== "string" || !first.b64_json)
    return { ok: false, message: "OpenAI returned no image" };
  const png = Uint8Array.from(atob(first.b64_json), (c) => c.charCodeAt(0));
  return {
    ok: true,
    png,
    usage: b.usage ?? null,
    ...(typeof first.revised_prompt === "string" ? { revisedPrompt: first.revised_prompt } : {}),
  };
}

/** True when the API refused the request because of the input_fidelity field (older or newer models). */
export function rejectsInputFidelity(message: string): boolean {
  return /input_fidelity/i.test(message);
}

/**
 * USD per million tokens for GPT Image 2.5 (Flare and Sunburst share them), from OpenAI's price list
 * as quoted in Nov 2026. Only used for the rough cost shown next to a result; check the Usage page.
 */
export const PRICE_PER_M = { textInput: 5, imageInput: 8, imageOutput: 30 } as const;

/** Rough cost of one edit in USD from the usage the API reports; null without usage. */
export function estimateCostUsd(usage: ImageUsage | null): number | null {
  if (!usage || typeof usage.output_tokens !== "number") return null;
  const text = usage.input_tokens_details?.text_tokens ?? 0;
  const image = usage.input_tokens_details?.image_tokens ?? Math.max(0, (usage.input_tokens ?? 0) - text);
  return (
    (text * PRICE_PER_M.textInput +
      image * PRICE_PER_M.imageInput +
      usage.output_tokens * PRICE_PER_M.imageOutput) /
    1_000_000
  );
}

export type OpenAIEnv = Record<string, string | undefined>;

/**
 * Settings from the environment: TATTOO_OPENAI_API_KEY (or OPENAI_API_KEY from the shell),
 * TATTOO_OPENAI_MODEL, TATTOO_OPENAI_FIDELITY (high | low | default), TATTOO_OPENAI_QUALITY,
 * TATTOO_OPENAI_PAD (on by default; off | false | 0 sends images unpadded). Null without a key.
 */
export function openaiSettingsFromEnv(env: OpenAIEnv): OpenAISettings | null {
  const apiKey = (env.TATTOO_OPENAI_API_KEY ?? env.OPENAI_API_KEY ?? "").trim();
  if (!apiKey) return null;
  const fidelity = env.TATTOO_OPENAI_FIDELITY?.trim().toLowerCase();
  const quality = env.TATTOO_OPENAI_QUALITY?.trim().toLowerCase();
  const pad = env.TATTOO_OPENAI_PAD?.trim().toLowerCase();
  return {
    ...(pad === "off" || pad === "false" || pad === "0" ? { padToSize: false as const } : {}),
    apiKey,
    model: env.TATTOO_OPENAI_MODEL?.trim() || DEFAULT_OPENAI_MODEL,
    inputFidelity: fidelity === "low" ? "low" : fidelity === "default" ? null : "high",
    quality: quality === "medium" || quality === "low" || quality === "auto" ? quality : "high",
  };
}
