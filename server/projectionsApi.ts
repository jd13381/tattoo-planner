// API for photo projections in the project's projections/ (legacy data folder: config/projections/;
// docs/adr/0006-anubis-projection.md). Numbers only: the photos themselves stay in the data folder.
//   GET  /api/projections          → [{ name, text }]
//   PUT  /api/projections/<name>   body: { calibration } → validates, keeps comments, writes atomically.
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { projectionSchema } from "../src/projection/schema.ts";
import { newProjectionText, updateProjectionText } from "../src/projection/yamlDoc.ts";
import { HttpError, isCrossSite, readJson, send, sendError, subPath, type Handler } from "./http.ts";

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

/** Calibrations of the open project: GET lists them, PUT /<name> saves one. */
export function projectionsHandler(dir: () => Promise<string | null>): Handler {
  return async (req, res, url) => {
    try {
      const name = decodeURIComponent(subPath(url).replace(/^\//, ""));
      const folder = await dir();
      if (req.method === "GET" && name === "")
        return send(res, 200, folder ? await listProjections(folder) : []);
      if (req.method === "PUT" && name !== "") {
        if (isCrossSite(req.headers)) throw new HttpError(403, "cross-site request refused");
        if (!folder) throw new HttpError(409, "no project is open");
        const body = await readJson(req);
        return send(res, 200, { name, text: await saveProjection(folder, name, body) });
      }
      throw new HttpError(405, "method not allowed");
    } catch (e) {
      sendError(res, e, 400);
    }
  };
}
