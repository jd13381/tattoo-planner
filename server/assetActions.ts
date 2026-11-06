// The Assets tab's actions on several images (docs/adr/0020-asset-structure.md): where images are
// used, hide / unhide / move, move to the trash with undo, and importing a dropped file. Every
// manifest write runs under the one manifest lock and keeps comments; a delete never rewrites the
// other entries (removeManifestEntries) and never touches a file another entry still names.
import { randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  folderFor,
  isCategory,
  isPersonCategory,
  kindFor,
  type AssetCategory,
} from "../src/assets/category.ts";
import { MANIFEST_FILE, type Asset } from "../src/assets/manifest.ts";
import {
  fileKey,
  ManifestError,
  mergeManifest,
  removeManifestEntries,
  type EntryPatch,
} from "../src/assets/manifestDoc.ts";
import { assetReferences, deleteCheck, type UsageMap } from "../src/assets/references.ts";
import { assetIdFromPath, IMAGE_EXTENSIONS, UNSUPPORTED_IMAGE_EXTENSIONS } from "../src/assets/scan.ts";
import { MAX_BATCH, type BatchAction, type DeleteRefusal } from "../src/assets/types.ts";
import {
  assetPath,
  isInside,
  parseEntryPatch,
  parseManifestText,
  resolveInside,
  updateAssetEntries,
} from "./assetsApi.ts";
import { HttpError } from "./http.ts";
import { listLayouts } from "./layoutsApi.ts";
import { withManifestLock, writeAtomic } from "./manifestLock.ts";
import type { PersonDirs } from "./persons.ts";
import { listProjections } from "./projectionsApi.ts";
import type { PendingDeletes } from "./trash.ts";

/** Where every catalogued image is used: layouts and projections of every person, edits, sessions. */
export async function assetUsageMap(
  dataDir: string,
  persons: readonly PersonDirs[],
  sessions: readonly string[],
): Promise<UsageMap> {
  const assets = await manifestAssets(dataDir);
  const layouts = (
    await Promise.all(
      persons.map(async (p) =>
        p.layoutsDir ? (await listLayouts(p.layoutsDir)).map((l) => ({ person: p.id, ...l })) : [],
      ),
    )
  ).flat();
  const projections = (
    await Promise.all(
      persons.map(async (p) =>
        p.projectionsDir
          ? (await listProjections(p.projectionsDir)).map((l) => ({ person: p.id, ...l }))
          : [],
      ),
    )
  ).flat();
  return assetReferences({ assets, layouts, projections, sessions });
}

async function manifestText(dataDir: string): Promise<string | null> {
  try {
    return await readFile(path.join(dataDir, MANIFEST_FILE), "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

async function manifestAssets(dataDir: string): Promise<Asset[]> {
  const text = await manifestText(dataDir);
  if (text === null) return [];
  const parsed = parseManifestText(text);
  return "error" in parsed ? [] : parsed.assets;
}

export type BatchBody = { action: BatchAction; ids: string[]; patch?: EntryPatch; force: boolean };

/** Checks a batch request; throws HttpError 400 with the reason. */
export function parseBatch(body: unknown): BatchBody {
  const b = (body ?? {}) as Record<string, unknown>;
  const action = b.action;
  if (action !== "hide" && action !== "unhide" && action !== "set" && action !== "delete")
    throw new HttpError(400, "action must be hide, unhide, set or delete");
  const ids = b.ids;
  if (
    !Array.isArray(ids) ||
    ids.length === 0 ||
    !ids.every((i) => typeof i === "string" && /^[a-z0-9][a-z0-9-]*$/.test(i))
  )
    throw new HttpError(400, "ids must be a list of asset ids");
  if (ids.length > MAX_BATCH) throw new HttpError(400, `at most ${MAX_BATCH} images at once`);
  let patch: EntryPatch | undefined;
  if (action === "set") {
    const p = parseEntryPatch(b.patch);
    if (!p || Object.keys(p).length === 0) throw new HttpError(400, "patch must name the fields to change");
    patch = p;
  }
  return { action, ids: [...new Set(ids as string[])], patch, force: b.force === true };
}

/** Undo of a hide / unhide / move: the manifest text from before, restored when nothing changed since. */
export class EditUndo {
  private readonly entries = new Map<string, { dir: string; before: string; after: string; until: number }>();
  private readonly holdMs: number;

  constructor(holdMs = 60_000) {
    this.holdMs = holdMs;
  }

  remember(dir: string, before: string, after: string): { token: string; expiresAt: string } {
    const now = Date.now();
    for (const [k, v] of this.entries) if (v.until < now) this.entries.delete(k);
    const token = randomBytes(9).toString("hex");
    this.entries.set(token, { dir, before, after, until: now + this.holdMs });
    return { token, expiresAt: new Date(now + this.holdMs).toISOString() };
  }

  has(token: string): boolean {
    return this.entries.has(token);
  }

  undo(dir: string, token: string): Promise<void> {
    return withManifestLock(async () => {
      const e = this.entries.get(token);
      if (!e || e.dir !== dir || e.until < Date.now())
        throw new HttpError(410, "This can no longer be undone.");
      const file = path.join(dir, MANIFEST_FILE);
      const current = await readFile(file, "utf8");
      if (current !== e.after)
        throw new HttpError(409, "The catalogue changed meanwhile, so the change was not undone.");
      await writeAtomic(file, e.before);
      this.entries.delete(token);
    });
  }
}

export type BatchDeps = {
  persons: PersonDirs[];
  sessions: string[];
  pending: PendingDeletes;
  undo: EditUndo;
};

export type BatchOutcome =
  | { ok: true; changed: string[]; undo: { token: string; expiresAt: string } | null; files?: number }
  | { ok: false; status: number; body: DeleteRefusal | { error: string } };

/** Runs a batch on the open project's manifest. */
export async function runBatch(dataDir: string, req: BatchBody, deps: BatchDeps): Promise<BatchOutcome> {
  if (req.action === "delete") return deleteAssets(dataDir, req.ids, req.force, deps);
  const patch: EntryPatch =
    req.action === "hide" ? { hidden: true } : req.action === "unhide" ? { hidden: false } : req.patch!;
  if (patch.person !== undefined && patch.person !== null && !deps.persons.some((p) => p.id === patch.person))
    return { ok: false, status: 400, body: { error: `unknown person ${patch.person}` } };
  // The implicit person is the default: no field needed.
  const normalised: EntryPatch = { ...patch };
  if (patch.person === deps.persons[0]?.id) normalised.person = null;
  // Moving into the shared library: a photo's person no longer applies.
  if (isCategory(patch.category) && !isPersonCategory(patch.category) && patch.person === undefined)
    normalised.person = null;
  const r = await updateAssetEntries(
    dataDir,
    req.ids.map((id) => ({ id, patch: normalised })),
  );
  if (!r.ok) return { ok: false, status: r.status, body: { error: r.message } };
  if (r.before === r.after) return { ok: true, changed: [], undo: null };
  return { ok: true, changed: req.ids, undo: deps.undo.remember(dataDir, r.before, r.after) };
}

/** A sidecar text file next to an image (refs/foo.jpg + refs/foo.txt) holds its source; it goes with it. */
function sidecarOf(file: string): string {
  return file.replace(/\.[^./]+$/, ".txt");
}

async function isFile(abs: string): Promise<boolean> {
  try {
    return (await stat(abs)).isFile();
  } catch {
    return false;
  }
}

/**
 * Removes the entries and stages their files for the trash (undo for a while). Refused for images
 * open in the Image studio; photos that projections use only with `force`.
 */
export function deleteAssets(
  dataDir: string,
  ids: readonly string[],
  force: boolean,
  deps: BatchDeps,
): Promise<BatchOutcome> {
  return withManifestLock(async (): Promise<BatchOutcome> => {
    const before = await manifestText(dataDir);
    if (before === null) return { ok: false, status: 404, body: { error: "no manifest" } };
    const parsed = parseManifestText(before);
    if ("error" in parsed) return { ok: false, status: 409, body: { error: parsed.error } };
    const known = new Map(parsed.assets.map((a) => [a.id, a]));
    const unknown = ids.filter((id) => !known.has(id));
    if (unknown.length) return { ok: false, status: 404, body: { error: `unknown asset ${unknown[0]}` } };
    const usage = await assetUsageMap(dataDir, deps.persons, deps.sessions);
    const check = deleteCheck(ids, usage);
    if (check.inSession.length)
      return {
        ok: false,
        status: 409,
        body: {
          error: `${check.inSession.join(", ")} ${check.inSession.length === 1 ? "is" : "are"} open in the Image studio; close the session first.`,
          inSession: check.inSession,
          projections: check.projections,
        },
      };
    if (check.projections.length && !force)
      return {
        ok: false,
        status: 409,
        body: {
          error: "Projections use these photos; deleting them breaks the projection.",
          inSession: [],
          projections: check.projections,
        },
      };
    let after: string;
    try {
      after = removeManifestEntries(before, ids).text;
    } catch (e) {
      if (e instanceof ManifestError) return { ok: false, status: 409, body: { error: e.message } };
      throw e;
    }
    const removed = ids.map((id) => known.get(id)!);
    const remaining = new Set(parsed.assets.filter((a) => !ids.includes(a.id)).map((a) => fileKey(a.file)));
    const files = new Set<string>();
    for (const a of removed) {
      if (remaining.has(fileKey(a.file))) continue;
      const lexical = assetPath(dataDir, a.file);
      if (!lexical.ok) continue;
      const real = await resolveInside(dataDir, a.file);
      // A symlink leading out of the project is never followed; its own link is not touched either.
      if (!real.ok) continue;
      files.add(path.relative(dataDir, lexical.path).split(path.sep).join("/"));
      const side = sidecarOf(a.file);
      if (side !== a.file && !remaining.has(fileKey(side)) && (await isFile(path.join(dataDir, side))))
        files.add(side);
    }
    const undo = await deps.pending.stage(dataDir, {
      files: [...files],
      entries: removed,
      manifestBefore: before,
      manifestAfter: after,
    });
    return { ok: true, changed: [...ids], undo, files: files.size };
  });
}

export type ImportRequest = { name: string; category: AssetCategory; person: string | null };

/** Checks the query of an import: a plain file name with an image extension, a category, a person. */
export function parseImport(query: URLSearchParams, persons: readonly PersonDirs[]): ImportRequest {
  const raw = (query.get("name") ?? "").normalize("NFC");
  const name = raw.split(/[\\/]/).pop()!.trim();
  // eslint-disable-next-line no-control-regex
  if (!name || name.startsWith(".") || /[\u0000-\u001f]/.test(name) || name.length > 200)
    throw new HttpError(400, "invalid file name");
  const ext = path.extname(name).slice(1).toLowerCase();
  if (UNSUPPORTED_IMAGE_EXTENSIONS.includes(ext))
    throw new HttpError(415, `${name}: .${ext} cannot be shown in the browser; export it as JPEG or PNG`);
  if (!IMAGE_EXTENSIONS.includes(ext)) throw new HttpError(415, `${name}: not an image the planner shows`);
  const category = query.get("category");
  if (!isCategory(category) || category === "generated" || category === "edit")
    throw new HttpError(400, "category must be reference, background, measuring or existing");
  let person: string | null = null;
  if (isPersonCategory(category)) {
    person = query.get("person") || persons[0]?.id || null;
    if (!persons.some((p) => p.id === person)) throw new HttpError(400, `unknown person ${person}`);
  }
  return { name, category, person };
}

/** Copies a dropped image into its section's folder (never overwriting) and catalogues it. */
export function importAsset(
  dataDir: string,
  req: ImportRequest,
  bytes: Buffer,
  persons: readonly PersonDirs[],
): Promise<{ id: string; file: string }> {
  return withManifestLock(async () => {
    const defaultPerson = persons[0]?.id;
    const folder = folderFor(req.category, req.person, defaultPerson);
    const abs = path.join(dataDir, folder);
    if (!isInside(path.resolve(dataDir), path.resolve(abs))) throw new HttpError(400, "invalid folder");
    await mkdir(abs, { recursive: true });
    const before = await manifestText(dataDir);
    const parsed = before?.trim() ? parseManifestText(before) : { assets: [] as Asset[], warnings: [] };
    if ("error" in parsed) throw new HttpError(409, parsed.error);
    const taken = new Set([
      ...parsed.assets.map((a) => fileKey(a.file)),
      ...(await readdir(abs)).map((f) => fileKey(`${folder}/${f}`)),
    ]);
    const ext = path.extname(req.name);
    const stem = req.name.slice(0, req.name.length - ext.length);
    let file = `${folder}/${req.name}`;
    for (let n = 2; taken.has(fileKey(file)); n++) file = `${folder}/${stem}-${n}${ext}`;
    const entry: Asset = {
      id: assetIdFromPath(file),
      file,
      kind: kindFor(req.category),
      category: req.category,
      ...(req.person && req.person !== defaultPerson ? { person: req.person } : {}),
      tags: [],
    };
    const merged = mergeManifest(before?.trim() ? before : null, [entry]);
    const id = merged.added[0];
    if (!id) throw new HttpError(409, "the catalogue refused the new entry");
    const target = path.join(dataDir, file);
    await writeFile(target, bytes, { flag: "wx" });
    try {
      await writeAtomic(path.join(dataDir, MANIFEST_FILE), merged.text);
    } catch (e) {
      await rm(target, { force: true });
      throw e;
    }
    return { id, file };
  });
}
