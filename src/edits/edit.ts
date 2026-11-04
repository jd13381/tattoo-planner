// Framework-free rules for editing reference images with `claude -p` (ADR 0007): the prompt, the
// command line, how Claude's progress stream becomes log lines, how a result PNG is checked, and
// the name and manifest entry of a kept edit. The dev-server endpoint (server/editsApi.ts) wires
// these to processes and files.
import type { Asset } from "../assets/manifest.ts";
import { EDITED_TAG, EDITS_FOLDER } from "./types.ts";

export const INPUT_BASENAME = "input";
export const OUTPUT_FILE = "output.png";
export const MAX_INSTRUCTION_CHARS = 2000;
export const MAX_OUTPUT_BYTES = 50 * 1024 * 1024;
/** Longest an edit may run before it is stopped. */
export const EDIT_TIMEOUT_MS = 15 * 60 * 1000;
/** Edits allowed at the same time; each one is a full Claude session. */
export const MAX_RUNNING = 2;
const MAX_VARIANTS = 999;

/** Tools Claude may use without asking. No web tools: the image must not leave the Mac (§10.2). */
export const ALLOWED_TOOLS = ["Bash", "Read", "Write", "Edit", "Glob", "Grep"] as const;
export const DISALLOWED_TOOLS = ["WebFetch", "WebSearch"] as const;

export type PromptInput = {
  /** File name of the image in the working folder, e.g. input.jpg. */
  inputFile: string;
  /** Every instruction of the chain, oldest first; earlier ones are already applied to the input. */
  instructions: string[];
  asset: Pick<Asset, "id" | "kind" | "notes" | "source">;
  /** Folder where Claude may keep a Python virtualenv between edits. */
  cacheDir: string;
};

/** The task given to `claude -p` (sent on stdin). */
export function buildEditPrompt(p: PromptInput): string {
  const current = p.instructions.at(-1) ?? "";
  const earlier = p.instructions.slice(0, -1);
  const context = [
    `asset id ${p.asset.id}, kind ${p.asset.kind}`,
    p.asset.source ? `source: ${p.asset.source}` : "",
    p.asset.notes ? `notes: ${p.asset.notes}` : "",
  ].filter(Boolean);
  return [
    "You are editing one reference image for a tattoo sketch tool, on the user's own computer.",
    "",
    `The image is ./${p.inputFile} in the current folder. It is a ${p.asset.kind} reference (${context.join("; ")}).`,
    earlier.length > 0
      ? `It has already been edited with these instructions, in order: ${earlier.map((s) => JSON.stringify(s)).join(", ")}.`
      : "",
    "",
    "Instruction from the user:",
    "<<<",
    current.trim(),
    ">>>",
    "",
    "Rules:",
    `- Write the result as ./${OUTPUT_FILE} (PNG; RGBA with real transparency wherever the background was removed). Keep the resolution unless the instruction says otherwise.`,
    `- Never change, move or delete ./${p.inputFile}. Work only in this folder and in ${p.cacheDir}.`,
    "- Do the edit with local tools only: Python (Pillow, numpy, OpenCV), ImageMagick, or for background removal `rembg`.",
    `  If a Python package is missing, create or reuse a virtualenv at ${p.cacheDir}/venv (python3 -m venv) and pip install it there. Never install system-wide.`,
    "- Never upload the image or any part of it to a website or online service. Downloading packages and models is fine.",
    `- Look at ./${p.inputFile} before you start and at ./${OUTPUT_FILE} when you are done, and fix the result if it does not do what was asked (e.g. leftover background, cut-off parts of the motif, halos).`,
    "- Work on the original pixels: cut, mask, retouch, adjust. Never redraw, re-render or replace the motif or parts of it with shapes you made up, and do not invent new design elements; this is a reference for a tattoo artist, not a new design.",
    "- Finish with two or three short sentences on what you changed and anything that did not work out.",
  ]
    .filter((line, i, all) => line !== "" || all[i - 1] !== "")
    .join("\n");
}

/** Arguments for `claude`; the prompt goes to stdin. */
export function claudeArgs(cacheDir: string, model?: string): string[] {
  return [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--permission-mode",
    "acceptEdits",
    "--no-session-persistence",
    "--strict-mcp-config",
    "--add-dir",
    cacheDir,
    ...(model ? ["--model", model] : []),
    "--allowedTools",
    ...ALLOWED_TOOLS,
    "--disallowedTools",
    ...DISALLOWED_TOOLS,
  ];
}

export type StreamEvent =
  { kind: "log"; lines: string[] } | { kind: "result"; ok: boolean; text: string } | { kind: "none" };

function oneLine(s: string, max = 200): string {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** Turns one line of `--output-format stream-json` into log lines or the final result. */
export function parseStreamLine(line: string): StreamEvent {
  if (!line.trim()) return { kind: "none" };
  let ev: unknown;
  try {
    ev = JSON.parse(line);
  } catch {
    return { kind: "log", lines: [oneLine(line)] };
  }
  if (typeof ev !== "object" || ev === null) return { kind: "none" };
  const e = ev as {
    type?: string;
    subtype?: string;
    is_error?: boolean;
    result?: unknown;
    message?: unknown;
  };
  if (e.type === "result") {
    const text = typeof e.result === "string" ? e.result.trim() : "";
    return {
      kind: "result",
      ok: e.subtype === "success" && !e.is_error,
      text: text || String(e.subtype ?? ""),
    };
  }
  if (e.type !== "assistant") return { kind: "none" };
  const content = (e.message as { content?: unknown } | undefined)?.content;
  if (!Array.isArray(content)) return { kind: "none" };
  const lines: string[] = [];
  for (const block of content as { type?: string; text?: unknown; name?: unknown; input?: unknown }[]) {
    if (block.type === "text" && typeof block.text === "string" && block.text.trim())
      lines.push(oneLine(block.text));
    else if (block.type === "tool_use" && typeof block.name === "string") {
      const input = (block.input ?? {}) as Record<string, unknown>;
      const detail =
        typeof input.description === "string"
          ? input.description
          : typeof input.command === "string"
            ? input.command
            : typeof input.file_path === "string"
              ? input.file_path.split("/").pop()!
              : "";
      lines.push(`→ ${block.name}${detail ? `: ${oneLine(detail, 160)}` : ""}`);
    }
  }
  return lines.length > 0 ? { kind: "log", lines } : { kind: "none" };
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export type PngInfo = { width: number; height: number; alpha: boolean };

/** Reads size and alpha from a PNG header; null when the bytes are not a PNG. */
export function readPngInfo(bytes: Uint8Array): PngInfo | null {
  if (bytes.length < 33) return null;
  if (!PNG_SIGNATURE.every((b, i) => bytes[i] === b)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunkType = String.fromCharCode(bytes[12]!, bytes[13]!, bytes[14]!, bytes[15]!);
  if (chunkType !== "IHDR") return null;
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (width === 0 || height === 0) return null;
  const colourType = bytes[25]!;
  // Colour types 4 and 6 carry alpha; palette or RGB images may carry a tRNS chunk instead.
  let alpha = colourType === 4 || colourType === 6;
  if (!alpha) {
    let pos = 8;
    while (pos + 8 <= bytes.length) {
      const len = view.getUint32(pos);
      const type = String.fromCharCode(bytes[pos + 4]!, bytes[pos + 5]!, bytes[pos + 6]!, bytes[pos + 7]!);
      if (type === "tRNS") alpha = true;
      if (type === "IDAT" || type === "IEND" || alpha) break;
      pos += 12 + len;
    }
  }
  return { width, height, alpha };
}

/** The original an edit chain belongs to: an edit's `derived_from`, else the asset itself. */
export function rootAssetId(asset: Pick<Asset, "id" | "derived_from">): string {
  return asset.derived_from ?? asset.id;
}

/**
 * Id and file of the next kept edit of `rootId`: `<root>-edit-N` in `edits/<root>-edit-N.png`,
 * the first N that neither the manifest nor the folder uses.
 */
export function nextVariant(
  rootId: string,
  takenIds: ReadonlySet<string>,
  takenFiles: ReadonlySet<string>,
): { id: string; file: string } {
  for (let n = 1; n <= MAX_VARIANTS; n++) {
    const id = `${rootId}-edit-${n}`;
    const file = `${EDITS_FOLDER}/${id}.png`;
    if (!takenIds.has(id) && !takenFiles.has(file.toLowerCase())) return { id, file };
  }
  throw new Error(`more than ${MAX_VARIANTS} edits of ${rootId}`);
}

/** Manifest entry for a kept edit: kind, source and tags of the original, plus the instructions. */
export function keptAsset(
  original: Asset,
  variant: { id: string; file: string },
  instructions: string[],
  sameSize: boolean,
): Asset {
  const notes = `Edited with claude -p: ${instructions.map((s) => JSON.stringify(oneLine(s, 300))).join(", then ")}`;
  return {
    id: variant.id,
    file: variant.file,
    kind: original.kind,
    derived_from: rootAssetId(original),
    ...(original.source ? { source: original.source } : {}),
    notes,
    tags: [...new Set([...original.tags, EDITED_TAG])],
    // The original's cut-out still fits when the size did not change.
    ...(sameSize && original.crop ? { crop: original.crop } : {}),
  };
}

/** Checks the instruction text; returns it trimmed or an error. */
export function checkInstruction(text: unknown): { ok: true; text: string } | { ok: false; message: string } {
  if (typeof text !== "string" || !text.trim()) return { ok: false, message: "the instruction is empty" };
  if (text.length > MAX_INSTRUCTION_CHARS)
    return { ok: false, message: `the instruction is longer than ${MAX_INSTRUCTION_CHARS} characters` };
  return { ok: true, text: text.trim() };
}
