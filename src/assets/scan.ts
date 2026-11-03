// Catalogue images that Jan drops into the data folder (ADR 0003): every image in a known folder that
// no manifest entry references yet becomes a new entry with an id derived from its path.
import type { Asset } from "./manifest.ts";
import { slug } from "./ideasLayout.ts";

/** Folders that `assets:scan` looks at, and the kind their images get. */
export const SCAN_FOLDERS: Readonly<Record<string, string>> = {
  cards: "card-art",
  refs: "reference",
  existing: "existing",
  "arm-photos": "arm-photo",
};

/** Formats the browser can show; other image files are reported but not catalogued. */
export const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "gif", "avif"];
export const UNSUPPORTED_IMAGE_EXTENSIONS = ["heic", "heif", "tif", "tiff", "bmp", "psd"];

function extension(file: string): string {
  const name = file.split("/").pop() ?? "";
  return name.includes(".") ? (name.split(".").pop() ?? "").toLowerCase() : "";
}

/** Id for a scanned file: its path without extension, e.g. cards/Rhonas.jpg → cards-rhonas. */
export function assetIdFromPath(file: string): string {
  const withoutExt = file.replace(/\.[^./]+$/, "");
  return slug(withoutExt) || "asset";
}

export type ScanResult = { candidates: Asset[]; unsupported: string[] };

/** Manifest candidates for the given data-folder paths (forward slashes, relative to the folder). */
export function scanCandidates(files: string[]): ScanResult {
  const candidates: Asset[] = [];
  const unsupported: string[] = [];
  for (const file of [...files].sort()) {
    const top = file.split("/")[0]!;
    const kind = SCAN_FOLDERS[top];
    if (!kind || !file.includes("/")) continue;
    const ext = extension(file);
    if (IMAGE_EXTENSIONS.includes(ext)) candidates.push({ id: assetIdFromPath(file), file, kind, tags: [] });
    else if (UNSUPPORTED_IMAGE_EXTENSIONS.includes(ext)) unsupported.push(file);
  }
  return { candidates, unsupported };
}
