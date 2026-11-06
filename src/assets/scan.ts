// Catalogue images that Jan drops into the data folder (ADR 0003): every image in a known folder that
// no manifest entry references yet becomes a new entry with an id derived from its path.
import type { Asset } from "./manifest.ts";

/** Folders that `assets:scan` looks at, and the kind their images get. */
export const SCAN_FOLDERS: Readonly<Record<string, string>> = {
  // A project's folders (docs/adr/0012-project-folder.md) …
  images: "reference",
  photos: "arm-photo",
  // … and those of the older data folder, which stay valid.
  cards: "card-art",
  refs: "reference",
  existing: "existing",
  "arm-photos": "arm-photo",
};

/**
 * A person's own photo folders (docs/adr/0017-persons.md): persons/<id>/photos/ (body photos) and
 * persons/<id>/existing/ (existing tattoos). Their layouts and projections are YAML, never scanned.
 */
const PERSON_SCAN_FOLDERS: Readonly<Record<string, string>> = { photos: "arm-photo", existing: "existing" };

function personFolderKind(file: string): string | undefined {
  const parts = file.split("/");
  if (parts[0] !== "persons" || parts.length < 4) return undefined;
  return Object.hasOwn(PERSON_SCAN_FOLDERS, parts[2]!) ? PERSON_SCAN_FOLDERS[parts[2]!] : undefined;
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
    const kind = file.includes("/") ? (SCAN_FOLDERS[top] ?? personFolderKind(file)) : undefined;
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
