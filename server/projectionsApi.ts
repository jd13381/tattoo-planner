// API for photo projections in the project's projections/ (legacy data folder: config/projections/;
// docs/adr/0006-anubis-projection.md). Numbers only: the photos themselves stay in the data folder.
//   GET  /api/projections          → [{ name, text }]
//   PUT  /api/projections/<name>   body: { calibration } → validates, keeps comments, writes atomically.
//   DELETE /api/projections/<name> body: { removeFrom?: [layout names] } → the file goes to the trash
//        (server/trash.ts, as deleted images do); the `existing` elements showing it leave those layouts.
import { mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseLayout, updateLayoutText } from "../src/layout/yamlDoc.ts";
import { projectionSchema } from "../src/projection/schema.ts";
import { newProjectionText, updateProjectionText } from "../src/projection/yamlDoc.ts";
import type { TrashMode } from "../src/assets/types.ts";
import { HttpError, isCrossSite, readJson, send, sendError, subPath, type Handler } from "./http.ts";
import type { StoredLayout } from "./layoutsApi.ts";
import type { Trasher } from "./trash.ts";

export const PROJECTIONS_ENDPOINT = "/api/projections";
const NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;

export type StoredProjection = { name: string; text: string };

export async function listProjections(dir: string): Promise<StoredProjection[]> {
  let files: string[];
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith(".yaml")).sort();
  } catch {
    return [];
  }
  return Promise.all(
    files.map(async (f) => ({
      name: f.slice(0, -".yaml".length),
      text: await readFile(path.join(dir, f), "utf8"),
    })),
  );
}

/** Writes a calibration, keeping the comments of the existing file. Returns the new text. */
export async function saveProjection(dir: string, name: string, body: unknown): Promise<string> {
  if (!NAME.test(name)) throw new HttpError(400, "invalid projection name");
  const calibration = projectionSchema.parse((body as { calibration?: unknown })?.calibration);
  if (calibration.name !== name) throw new HttpError(400, "projection name must match the file name");
  const file = path.join(dir, `${name}.yaml`);
  const original = await readFile(file, "utf8").catch(() => null);
  const text =
    original === null ? newProjectionText(calibration) : updateProjectionText(original, calibration);
  await mkdir(dir, { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  await writeFile(tmp, text, "utf8");
  await rename(tmp, file);
  return text;
}

async function writeText(file: string, text: string) {
  const tmp = `${file}.tmp-${process.pid}`;
  await writeFile(tmp, text, "utf8");
  await rename(tmp, file);
}

export type DeletedProjection = {
  name: string;
  /** Where the file went: the system Trash or the project's .trash folder. */
  trash: TrashMode;
  /** The layouts the tattoo was taken out of, with their new text. */
  layouts: StoredLayout[];
  /** Layouts asked for but left as they are, and why. */
  skipped: { name: string; reason: string }[];
};

/** Where a person's projections and layouts are (server/project/store.ts paths()). */
export type ProjectionFolders = {
  /** The project folder: the trash keeps the file's path relative to it. */
  dir: string | null;
  projectionsDir: string | null;
  layoutsDir: string | null;
};

/**
 * Moves a projection's file to the trash and takes the `existing` elements that show it out of the
 * layouts named in `removeFrom` (comments kept). Layouts left out keep their element, which then shows
 * "projection … not found". The layouts are read and checked before anything moves.
 */
export async function deleteProjection(
  folders: ProjectionFolders,
  name: string,
  removeFrom: readonly string[],
  trasher: Trasher,
): Promise<DeletedProjection> {
  const { dir, projectionsDir, layoutsDir } = folders;
  if (!dir || !projectionsDir) throw new HttpError(409, "no project is open");
  if (!NAME.test(name)) throw new HttpError(400, "invalid projection name");
  const file = path.join(projectionsDir, `${name}.yaml`);
  try {
    if (!(await stat(file)).isFile()) throw new Error("not a file");
  } catch {
    throw new HttpError(404, `no projection ${name}`);
  }
  const changed: StoredLayout[] = [];
  const skipped: DeletedProjection["skipped"] = [];
  for (const layoutName of new Set(removeFrom)) {
    if (!NAME.test(layoutName) || !layoutsDir) throw new HttpError(400, `invalid layout name ${layoutName}`);
    const text = await readFile(path.join(layoutsDir, `${layoutName}.yaml`), "utf8").catch(() => null);
    if (text === null) {
      skipped.push({ name: layoutName, reason: "not found" });
      continue;
    }
    const parsed = parseLayout(text);
    if (!parsed.ok) {
      skipped.push({ name: layoutName, reason: "the file has errors" });
      continue;
    }
    const elements = parsed.layout.elements.filter((e) => !(e.type === "existing" && e.projection === name));
    if (elements.length === parsed.layout.elements.length) continue;
    changed.push({ name: layoutName, text: updateLayoutText(text, { ...parsed.layout, elements }) });
  }
  const rel = path.relative(dir, file);
  await trasher.trash([file], {
    projectDir: dir,
    label: `projection-${name}`,
    entries: [],
    // Outside the project only for a legacy data folder (its projections are in the app's config/).
    relative: [rel.startsWith("..") || path.isAbsolute(rel) ? `projections/${name}.yaml` : rel],
    note:
      "# A projection (an existing tattoo's calibration) moved to the trash by the Tattoo Planner.\n" +
      "# To restore it, move the .yaml file back into the projections folder it came from.\n",
  });
  for (const l of changed) await writeText(path.join(layoutsDir!, `${l.name}.yaml`), l.text);
  return { name, trash: trasher.mode, layouts: changed, skipped };
}

/** Calibrations of the open project: GET lists them, PUT /<name> saves one, DELETE /<name> trashes one. */
export function projectionsHandler(folders: () => Promise<ProjectionFolders>, trasher: Trasher): Handler {
  return async (req, res, url) => {
    try {
      const name = decodeURIComponent(subPath(url).replace(/^\//, ""));
      const paths = await folders();
      const folder = paths.projectionsDir;
      if (req.method === "GET" && name === "")
        return send(res, 200, folder ? await listProjections(folder) : []);
      if (req.method === "PUT" && name !== "") {
        if (isCrossSite(req.headers)) throw new HttpError(403, "cross-site request refused");
        if (!folder) throw new HttpError(409, "no project is open");
        const body = await readJson(req);
        return send(res, 200, { name, text: await saveProjection(folder, name, body) });
      }
      if (req.method === "DELETE" && name !== "") {
        if (isCrossSite(req.headers)) throw new HttpError(403, "cross-site request refused");
        const body = req.headers["content-type"] ? await readJson(req) : {};
        const removeFrom = (body as { removeFrom?: unknown })?.removeFrom ?? [];
        if (!Array.isArray(removeFrom) || !removeFrom.every((x) => typeof x === "string"))
          throw new HttpError(400, "removeFrom must be a list of layout names");
        return send(res, 200, await deleteProjection(paths, name, removeFrom as string[], trasher));
      }
      throw new HttpError(405, "method not allowed");
    } catch (e) {
      sendError(res, e, 400);
    }
  };
}
