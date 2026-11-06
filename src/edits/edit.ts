// Framework-free rules shared by the Image studio engines: how a result PNG is checked, and the name
// and manifest entry of a kept edit or new image (ADR 0007, 0009, 0013). The dev-server endpoint
// (server/editsApi.ts) wires these to requests and files.
import type { Asset } from "../assets/manifest.ts";
import { EDITED_TAG, EDITS_FOLDER, GENERATED_FOLDER, GENERATED_KIND, GENERATED_TAG } from "./types.ts";

export const INPUT_BASENAME = "input";
export const OUTPUT_FILE = "output.png";
export const MAX_INSTRUCTION_CHARS = 2000;
export const MAX_OUTPUT_BYTES = 50 * 1024 * 1024;
/** Largest result in pixels (width × height) the studio takes, about 100 megapixels. */
export const MAX_OUTPUT_PIXELS = 100_000_000;
/** Longest a generative request may run before it is stopped. */
export const EDIT_TIMEOUT_MS = 15 * 60 * 1000;
const MAX_VARIANTS = 999;

function oneLine(s: string, max = 200): string {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
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

/** Whether the bytes end with an IEND chunk, i.e. the PNG was not cut off. */
export function endsWithIend(bytes: Uint8Array): boolean {
  const n = bytes.length;
  if (n < 12) return false;
  const tail = bytes.subarray(n - 12);
  const isIend = String.fromCharCode(tail[4]!, tail[5]!, tail[6]!, tail[7]!) === "IEND";
  return isIend && tail[0] === 0 && tail[1] === 0 && tail[2] === 0 && tail[3] === 0;
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
  /** Kept new images: `<name>-N` in `generated/` instead of `<root>-edit-N` in `edits/`. */
  kind: "edit" | "created" = "edit",
): { id: string; file: string } {
  for (let n = 1; n <= MAX_VARIANTS; n++) {
    const id = kind === "created" ? `${rootId}-${n}` : `${rootId}-edit-${n}`;
    const file = `${kind === "created" ? GENERATED_FOLDER : EDITS_FOLDER}/${id}.png`;
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
  /** Tool of each step, same order as `instructions`. */
  tools: readonly string[],
): Asset {
  const toolOf = (i: number) => tools[i] ?? "unknown tool";
  const sameTool = instructions.every((_, i) => toolOf(i) === toolOf(0));
  const steps = instructions.map(
    (s, i) => `${JSON.stringify(oneLine(s, 300))}${sameTool ? "" : ` (${toolOf(i)})`}`,
  );
  // An edit of a kept edit names the image it started from; that entry's notes hold the earlier steps.
  const from = original.derived_from ? `From ${original.id}. ` : "";
  const notes = sameTool
    ? `${from}Edited with ${toolOf(0)}: ${steps.join(", then ")}`
    : `${from}Edited: ${steps.join(", then ")}`;
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

/** Manifest-safe name of a new image: lowercase letters, digits and dashes, at most 40 characters. */
export function slugName(name: unknown): string {
  const slug = (typeof name === "string" ? name : "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  return slug || "generated";
}

/** Manifest entry for a kept new image: kind idea, tag generated, the prompts and references in notes. */
export function createdAsset(
  variant: { id: string; file: string },
  instructions: string[],
  tools: readonly string[],
  references: readonly string[],
): Asset {
  const steps = instructions.map(
    (s, i) => `${JSON.stringify(oneLine(s, 300))} (${tools[i] ?? "unknown tool"})`,
  );
  const refs = references.length > 0 ? `; references: ${references.join(", ")}` : "";
  return {
    id: variant.id,
    file: variant.file,
    kind: GENERATED_KIND,
    notes: `Generated: ${steps.join(", then ")}${refs}`,
    tags: [GENERATED_TAG],
  };
}

/** Kinds and folders the Image studio does not offer: arm photos and photos of existing tattoos. */
const STUDIO_HIDDEN_KINDS = new Set(["arm-photo", "existing"]);
const STUDIO_HIDDEN_FOLDERS = ["arm-photos/", "existing/"];

/** Whether an asset belongs in the Image studio's picker (to edit or as a reference); hidden ones do not. */
export function showInStudio(
  asset: Pick<Asset, "kind" | "file"> & { effectiveCategory?: string; hidden?: boolean },
): boolean {
  if (asset.hidden) return false;
  // The catalogue's section, when known (docs/adr/0020): body photos stay out.
  if (asset.effectiveCategory)
    return asset.effectiveCategory !== "measuring" && asset.effectiveCategory !== "existing";
  const file = asset.file.replaceAll("\\", "/").toLowerCase();
  return !STUDIO_HIDDEN_KINDS.has(asset.kind) && !STUDIO_HIDDEN_FOLDERS.some((f) => file.startsWith(f));
}
