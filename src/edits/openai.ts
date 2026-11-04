// Framework-free rules for generative edits with the OpenAI Images API (ADR 0008): the prompt, the
// multipart request for POST /v1/images/edits, how the answer becomes PNG bytes, and a cost estimate
// from the reported token usage. The dev-server endpoint (server/editsApi.ts) does the network call.
import type { Asset } from "../assets/manifest.ts";

export const OPENAI_EDITS_URL = "https://api.openai.com/v1/images/edits";
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

export type GenerativePromptInput = {
  /** Every instruction of the chain, oldest first; earlier ones are already applied to the input. */
  instructions: string[];
  asset: Pick<Asset, "id" | "kind" | "notes">;
};

/** The prompt sent with the image. Jan writes the instruction; it may be German. */
export function buildGenerativePrompt(p: GenerativePromptInput): string {
  const current = (p.instructions.at(-1) ?? "").trim();
  return [
    "Edit this image. It is a reference sketch for planning a tattoo with a tattoo artist.",
    "Apply exactly the change described below. Keep everything the instruction does not mention as it is:",
    "the style, the line work, the shading, the composition, the proportions and the background.",
    "Do not add a frame, text, a signature or a watermark.",
    "",
    "Change:",
    current,
  ].join("\n");
}

export type OpenAISettings = {
  apiKey: string;
  model: string;
  /** "high" keeps the input's style and features more faithfully; null leaves the API default. */
  inputFidelity: "high" | "low" | null;
  quality: "high" | "medium" | "low" | "auto";
};

export type EditFormInput = {
  image: Uint8Array;
  fileName: string;
  mimeType: string;
  prompt: string;
  settings: Pick<OpenAISettings, "model" | "inputFidelity" | "quality">;
};

/** Multipart body for POST /v1/images/edits: one image, one result, PNG out, size kept. */
export function buildEditForm(p: EditFormInput): FormData {
  const form = new FormData();
  form.set("model", p.settings.model);
  form.set("prompt", p.prompt);
  form.set("n", "1");
  form.set("size", "auto");
  form.set("quality", p.settings.quality);
  form.set("output_format", "png");
  if (p.settings.inputFidelity) form.set("input_fidelity", p.settings.inputFidelity);
  form.set("image", new Blob([p.image as BlobPart], { type: p.mimeType }), p.fileName);
  return form;
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
 * TATTOO_OPENAI_MODEL, TATTOO_OPENAI_FIDELITY (high | low | default), TATTOO_OPENAI_QUALITY.
 * Null without a key.
 */
export function openaiSettingsFromEnv(env: OpenAIEnv): OpenAISettings | null {
  const apiKey = (env.TATTOO_OPENAI_API_KEY ?? env.OPENAI_API_KEY ?? "").trim();
  if (!apiKey) return null;
  const fidelity = env.TATTOO_OPENAI_FIDELITY?.trim().toLowerCase();
  const quality = env.TATTOO_OPENAI_QUALITY?.trim().toLowerCase();
  return {
    apiKey,
    model: env.TATTOO_OPENAI_MODEL?.trim() || DEFAULT_OPENAI_MODEL,
    inputFidelity: fidelity === "low" ? "low" : fidelity === "default" ? null : "high",
    quality: quality === "medium" || quality === "low" || quality === "auto" ? quality : "high",
  };
}
