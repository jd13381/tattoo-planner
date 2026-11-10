// Words the Image studio shows for versions and its run button. Plain language instead of the session's
// internal numbering (v0, v1, …): the start is "the original", later steps are "version 1", "version 2".
// Pure, so the wording is tested and the page stays thin.
import type { EditEngine } from "./types.ts";

/** "the original" for 0, "version 3" for 3: inside a sentence. */
export function versionName(index: number): string {
  return index === 0 ? "the original" : `version ${index}`;
}

/** "Original", "Version 3": a label on its own (version strip, tile heads). */
export function versionTitle(index: number): string {
  return index === 0 ? "Original" : `Version ${index}`;
}

/** The start of a new image is an empty artboard, not an original. */
export function versionTitleFor(index: number, creating: boolean): string {
  return index === 0 && creating ? "Blank" : versionTitle(index);
}

/** The first sentence of an operation's hint: its one-line description in the list. */
export function firstSentence(text: string): string {
  const m = /^(.+?[.!?])(\s|$)/.exec(text.trim());
  return m ? m[1]! : text.trim();
}

export type RunWords = {
  /** A new image without any version yet. */
  creatingNew: boolean;
  /** The version the run starts from (0: the original). */
  version: number;
  engine: EditEngine;
  /** Generative results asked for in one run. */
  count: number;
  /** Built-in: the operation's label. */
  opLabel?: string;
};

/** The run button: what happens to which version, in plain words. */
export function runButtonLabel(c: RunWords): string {
  if (c.creatingNew) return c.count > 1 ? `Create ${c.count} variants` : "Create with GPT Image";
  const onLater = c.version > 0 ? ` of ${versionName(c.version)}` : "";
  if (c.engine === "openai")
    return c.count > 1
      ? `Make ${c.count} variants${onLater}`
      : c.version > 0
        ? `Edit ${versionName(c.version)} with GPT Image`
        : "Edit with GPT Image";
  const op = c.opLabel ?? "operation";
  return c.version > 0 ? `Apply ${op} to ${versionName(c.version)}` : `Apply ${op}`;
}

type Availability = { enabled: true } | { enabled: false; reason: string };

/**
 * Why generative runs are off: "key" when only the OpenAI key is missing (Settings can fix it), "same"
 * when the same reason stops the built-in tools too (a read-only sample, no project), null when on.
 */
export function generativeBlock(
  builtin: Availability | undefined,
  generative: Availability | undefined,
): "key" | "same" | null {
  if (!generative || generative.enabled) return null;
  if (builtin && !builtin.enabled && builtin.reason === generative.reason) return "same";
  return "key";
}
