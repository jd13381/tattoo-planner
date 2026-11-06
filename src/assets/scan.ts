// Catalogue images that Jan drops into the data folder (ADR 0003): every image in a known folder that
// no manifest entry references yet becomes a new entry with an id derived from its path.
import { PERSON_ID, PERSONS_FOLDER } from "../project/persons.ts";
import type { Asset } from "./manifest.ts";

/** Top-level folders that `assets:scan` looks at, and the kind their images get. */
export const SCAN_FOLDERS: Readonly<Record<string, string>> = {
  // A project's folders (docs/adr/0012-project-folder.md, docs/adr/0020-asset-structure.md) …
  images: "reference",
  photos: "arm-photo",
  backgrounds: "background",
  // … and those of the older data folder, which stay valid.
  cards: "card-art",
  refs: "reference",
  existing: "existing",
  "arm-photos": "arm-photo",
};

/**
/**
 * The kind a scanned file gets, by its path; null when the scan leaves it alone. Rules: never inside
 * dot folders (.trash, .trash-pending); photos/existing/ → existing; photos/ → arm-photo; a person's
 * persons/<id>/photos/ and persons/<id>/existing/ (docs/adr/0017-persons.md) the same way; otherwise
 * by the top-level folder (SCAN_FOLDERS). Images loose in the project root are not catalogued.
 */
export function scanKind(file: string): string | null {
  const parts = file.split("/");
  if (parts.length < 2 || parts.some((p) => p.startsWith("."))) return null;
  let rest = parts;
  if (parts[0] === PERSONS_FOLDER) {
    if (parts.length < 4 || !PERSON_ID.test(parts[1]!)) return null;
    if (parts[2] !== "photos" && parts[2] !== "existing") return null;
    rest = parts.slice(2);
  }
  if (rest[0] === "photos" && rest.length > 2 && rest[1] === "existing") return "existing";
  return SCAN_FOLDERS[rest[0]!] ?? null;
}

/** Formats the browser can show; other image files are reported but not catalogued. */
export const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "gif", "avif"];
export const UNSUPPORTED_IMAGE_EXTENSIONS = ["heic", "heif", "tif", "tiff", "bmp", "psd"];

function extension(file: string): string {
  const name = file.split("/").pop() ?? "";
  return name.includes(".") ? (name.split(".").pop() ?? "").toLowerCase() : "";
}

/** Lowercase, digits and dashes only, as asset ids and tags need. */
export function slug(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Id for a scanned file: its path without extension, e.g. cards/Rhonas.jpg → cards-rhonas. */
export function assetIdFromPath(file: string): string {
  const withoutExt = file.replace(/\.[^./]+$/, "");
  return slug(withoutExt) || "asset";
}

/** Folders the planner fills itself (images extracted from ideas.pdf in the past, kept edits, new images, exports): never scanned. */
export const MANAGED_FOLDERS = ["ideas", "edits", "generated", "exports"];

export type ScanResult = {
  candidates: Asset[];
  unsupported: string[];
  /** Images outside the scanned and managed folders (e.g. loose in the data folder): not catalogued. */
  outside: string[];
};

/** Manifest candidates for the given data-folder paths (forward slashes, relative to the folder). */
export function scanCandidates(files: string[]): ScanResult {
  const candidates: Asset[] = [];
  const unsupported: string[] = [];
  const outside: string[] = [];
  for (const file of [...files].sort()) {
    const top = file.split("/")[0]!;
    const kind = scanKind(file);
    const ext = extension(file);
    if (!kind) {
      const managed = file.includes("/") && MANAGED_FOLDERS.includes(top);
      if (!managed && !top.startsWith(".") && IMAGE_EXTENSIONS.includes(ext)) outside.push(file);
      continue;
    }
    if (IMAGE_EXTENSIONS.includes(ext)) candidates.push({ id: assetIdFromPath(file), file, kind, tags: [] });
    else if (UNSUPPORTED_IMAGE_EXTENSIONS.includes(ext)) unsupported.push(file);
  }
  return { candidates, unsupported, outside };
}
