// The asset manifest (<project>/manifest.yaml) and its images: paths, the lenient listing and entry
// edits. The HTTP routes are in server/assetsHandler.ts, the actions that move files (delete, undo,
// import) in server/assetActions.ts.
// Only files named in the manifest are served, and only when they resolve inside the data folder.
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { parseDocument } from "yaml";
import { categoryOf, inheritPersons, isCategory, personOf } from "../src/assets/category.ts";
import { assetSchema, MANIFEST_FILE, type Asset } from "../src/assets/manifest.ts";
import { ManifestError, updateManifestEntries, type EntryPatch } from "../src/assets/manifestDoc.ts";
import { projectionPhotoKeys } from "../src/assets/references.ts";
import type { AssetInfo, AssetListing, TrashMode } from "../src/assets/types.ts";
import { PERSON_ID } from "../src/project/persons.ts";
import { withManifestLock, writeAtomic } from "./manifestLock.ts";
import { folderPersons, type PersonDirs } from "./persons.ts";
import { listProjections } from "./projectionsApi.ts";

/** Image types a browser can show. HEIC/HEIF are named separately: Chrome cannot decode them. */
export const IMAGE_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
};
const UNSHOWABLE = new Set(["heic", "heif"]);

export type ContentTypeResult = { ok: true; type: string } | { ok: false; status: 415; message: string };

/** Content type from the file extension (case-insensitive). */
export function imageContentType(file: string): ContentTypeResult {
  const ext = path.posix.extname(file.replaceAll("\\", "/")).slice(1).toLowerCase();
  const type = IMAGE_TYPES[ext];
  if (type) return { ok: true, type };
  if (UNSHOWABLE.has(ext))
    return {
      ok: false,
      status: 415,
      message: `.${ext} cannot be shown in the browser; export it as JPEG or PNG`,
    };
  return { ok: false, status: 415, message: `not an image type the planner shows (.${ext || "none"})` };
}

/**
 * Lexical check of a manifest `file` value: relative, forward slashes, no `..`, inside the folder.
 * Returns the absolute path or an error message. Symlinks are checked by `resolveInside`.
 */
export function assetPath(
  dataDir: string,
  file: string,
): { ok: true; path: string } | { ok: false; message: string } {
  if (!file || file.includes("\0")) return { ok: false, message: "empty or invalid path" };
  if (file.includes("\\")) return { ok: false, message: "use forward slashes" };
  if (file.startsWith("/") || /^[a-zA-Z]:/.test(file) || file.startsWith("~"))
    return { ok: false, message: "path must be relative to the data folder" };
  if (file.split("/").some((seg) => seg === "..")) return { ok: false, message: "path must not contain .." };
  const root = path.resolve(dataDir);
  const abs = path.resolve(root, file);
  if (!isInside(root, abs)) return { ok: false, message: "path leaves the data folder" };
  return { ok: true, path: abs };
}

export function isInside(root: string, p: string): boolean {
  const rel = path.relative(root, p);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/** Follows symlinks and checks the real file still lies inside the real data folder. */
export async function resolveInside(
  dataDir: string,
  file: string,
): Promise<{ ok: true; path: string } | { ok: false; message: string }> {
  const lexical = assetPath(dataDir, file);
  if (!lexical.ok) return lexical;
  try {
    const [realRoot, realFile] = await Promise.all([realpath(dataDir), realpath(lexical.path)]);
    if (!isInside(realRoot, realFile)) return { ok: false, message: "path leaves the data folder (symlink)" };
    const s = await stat(realFile);
    if (!s.isFile()) return { ok: false, message: "not a file" };
    return { ok: true, path: realFile };
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    return { ok: false, message: code === "ENOENT" ? "file not found" : String(code ?? e) };
  }
}

/**
 * Parses the manifest leniently: invalid or duplicate entries become warnings and are skipped,
 * so one typo does not hide every image.
 */
export function parseManifestText(text: string): { assets: Asset[]; warnings: string[] } | { error: string } {
  const doc = parseDocument(text);
  if (doc.errors.length > 0) return { error: `${MANIFEST_FILE}: YAML syntax: ${doc.errors[0]!.message}` };
  const raw: unknown = doc.toJS() ?? {};
  if (typeof raw !== "object" || raw === null || Array.isArray(raw))
    return { error: `${MANIFEST_FILE}: expected a mapping with an assets list` };
  const warnings: string[] = [];
  const { version, assets: list, ...rest } = raw as Record<string, unknown>;
  if (version !== undefined && version !== 1) warnings.push(`unknown manifest version ${String(version)}`);
  for (const key of Object.keys(rest)) warnings.push(`unknown top-level key "${key}" ignored`);
  if (list !== undefined && !Array.isArray(list)) return { error: `${MANIFEST_FILE}: assets must be a list` };
  const assets: Asset[] = [];
  const seen = new Set<string>();
  (list ?? []).forEach((entry: unknown, i: number) => {
    const r = assetSchema.safeParse(entry);
    const label = `assets[${i}]${typeof (entry as { id?: unknown })?.id === "string" ? ` (${(entry as { id: string }).id})` : ""}`;
    if (!r.success) {
      warnings.push(
        `${label}: ${r.error.issues.map((x) => `${x.path.join(".") || "entry"}: ${x.message}`).join("; ")}`,
      );
      return;
    }
    if (seen.has(r.data.id)) {
      warnings.push(`${label}: duplicate id, first entry wins`);
      return;
    }
    seen.add(r.data.id);
    assets.push(r.data);
  });
  return { assets, warnings };
}

/** What the listing needs besides the manifest: the persons (for their projections) and the trash. */
export type ListContext = {
  /** Default: the implicit person with the folder's own layouts/ and projections/. */
  persons?: PersonDirs[];
  trash?: TrashMode;
};

/** fileKey()s of the photos every person's projections use (they make a body photo a tattoo photo). */
export async function projectionKeys(persons: readonly PersonDirs[]): Promise<Set<string>> {
  const files = await Promise.all(
    persons.map((p) => (p.projectionsDir ? listProjections(p.projectionsDir) : Promise.resolve([]))),
  );
  return projectionPhotoKeys(files.flat());
}

/** The manifest with an existence check per file and each entry's section (category, person). */
export async function listAssets(dataDir: string | null, ctx: ListContext = {}): Promise<AssetListing> {
  if (!dataDir) return { status: "unset" };
  const persons = ctx.persons ?? folderPersons(dataDir);
  const extra = {
    persons: persons.map(({ id, name, implicit }) => ({ id, name, implicit })),
    ...(ctx.trash ? { trash: ctx.trash } : {}),
  };
  let text: string;
  try {
    text = await readFile(path.join(dataDir, MANIFEST_FILE), "utf8");
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      try {
        const s = await stat(dataDir);
        if (!s.isDirectory()) return { status: "error", message: "the data folder is not a folder" };
      } catch {
        return { status: "error", message: "data folder not found" };
      }
      return { status: "ok", assets: [], manifestFound: false, warnings: [], ...extra };
    }
    return { status: "error", message: `cannot read ${MANIFEST_FILE}: ${String(code ?? e)}` };
  }
  const parsed = parseManifestText(text);
  if ("error" in parsed) return { status: "error", message: parsed.error };
  const warnings = [...parsed.warnings];
  const keys = await projectionKeys(persons);
  const defaultPerson = persons[0]?.id;
  const listed: AssetInfo[] = await Promise.all(
    parsed.assets.map(async (a) => {
      const r = await resolveInside(dataDir, a.file);
      if (!r.ok && r.message !== "file not found") warnings.push(`${a.id}: ${a.file}: ${r.message}`);
      const effectiveCategory = categoryOf(a, keys);
      return {
        ...a,
        exists: r.ok,
        effectiveCategory,
        effectivePerson: personOf(a, effectiveCategory, defaultPerson),
      };
    }),
  );
  // Studio edits of a body photo belong to its person (src/assets/category.ts, inheritPersons).
  const assets = inheritPersons(listed);
  return { status: "ok", assets, manifestFound: true, warnings, ...extra };
}

export type ImageLookup =
  { ok: true; path: string; type: string } | { ok: false; status: 400 | 404 | 415; message: string };

/** Finds the file for an asset id: only manifest entries, only images, only inside the data folder. */
export async function findAssetImage(dataDir: string, id: string): Promise<ImageLookup> {
  if (!ASSET_ID.test(id)) return { ok: false, status: 400, message: "invalid asset id" };
  let text: string;
  try {
    text = await readFile(path.join(dataDir, MANIFEST_FILE), "utf8");
  } catch {
    return { ok: false, status: 404, message: "no manifest" };
  }
  const parsed = parseManifestText(text);
  if ("error" in parsed) return { ok: false, status: 404, message: "no manifest" };
  const asset = parsed.assets.find((a) => a.id === id);
  if (!asset) return { ok: false, status: 404, message: `unknown asset ${id}` };
  const type = imageContentType(asset.file);
  if (!type.ok) return type;
  const r = await resolveInside(dataDir, asset.file);
  if (!r.ok) return { ok: false, status: r.message === "file not found" ? 404 : 400, message: r.message };
  return { ok: true, path: r.path, type: type.type };
}

export const ASSET_ID = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Checks the body of an entry update: tags (strings), notes (string or null), hidden (boolean),
 * category (a known category or null) and person (a person id or null). Anything else: null.
 */
export function parseEntryPatch(body: unknown): EntryPatch | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const { tags, notes, hidden, category, person, ...rest } = body as Record<string, unknown>;
  if (Object.keys(rest).length > 0) return null;
  if (
    tags !== undefined &&
    !(Array.isArray(tags) && tags.length <= 100 && tags.every((t) => typeof t === "string" && t.length <= 64))
  )
    return null;
  if (notes !== undefined && notes !== null && (typeof notes !== "string" || notes.length > 4000))
    return null;
  if (hidden !== undefined && typeof hidden !== "boolean") return null;
  if (category !== undefined && category !== null && !isCategory(category)) return null;
  if (person !== undefined && person !== null && !(typeof person === "string" && PERSON_ID.test(person)))
    return null;
  return {
    ...(tags !== undefined ? { tags: tags as string[] } : {}),
    ...(notes !== undefined ? { notes: notes as string | null } : {}),
    ...(hidden !== undefined ? { hidden } : {}),
    ...(category !== undefined ? { category: category as string | null } : {}),
    ...(person !== undefined ? { person: person as string | null } : {}),
  };
}

export type EntryUpdateResult =
  { ok: true; before: string; after: string } | { ok: false; status: 400 | 404 | 409; message: string };

/**
 * Writes entry updates into manifest.yaml (atomically, under the manifest lock); a broken manifest
 * is never overwritten and an update that changes nothing writes nothing. All or nothing.
 */
export function updateAssetEntries(
  dataDir: string,
  updates: readonly { id: string; patch: EntryPatch }[],
): Promise<EntryUpdateResult> {
  return withManifestLock(async () => {
    if (updates.some((u) => !ASSET_ID.test(u.id)))
      return { ok: false, status: 400, message: "invalid asset id" } as const;
    const file = path.join(dataDir, MANIFEST_FILE);
    let original: string;
    try {
      original = await readFile(file, "utf8");
    } catch {
      return { ok: false, status: 404, message: "no manifest" } as const;
    }
    let text: string;
    try {
      text = updateManifestEntries(original, updates);
    } catch (e) {
      if (e instanceof ManifestError)
        return {
          ok: false,
          status: e.message.startsWith("no asset") ? 404 : 409,
          message: e.message,
        } as const;
      throw e;
    }
    if (text !== original) await writeAtomic(file, text);
    return { ok: true, before: original, after: text } as const;
  });
}

/** One entry update (PATCH /api/assets/entries/<id>). */
export async function updateAssetEntry(
  dataDir: string,
  id: string,
  patch: EntryPatch,
): Promise<{ ok: true } | { ok: false; status: 400 | 404 | 409; message: string }> {
  const r = await updateAssetEntries(dataDir, [{ id, patch }]);
  return r.ok ? { ok: true } : r;
}
