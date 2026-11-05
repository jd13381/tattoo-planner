// API for the layout variants in the project's layouts/ (a legacy data folder: the repo's config/layouts/).
//   GET  /api/layouts          → [{ name, text }]
//   PUT  /api/layouts/<name>   body: { layout, from? } → validates, keeps comments, writes atomically.
//        `from` (a new variant only): start from that variant's file, so its comments are copied too.
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { layoutSchema } from "../src/layout/schema.ts";
import { newLayoutText, updateLayoutText } from "../src/layout/yamlDoc.ts";
import { HttpError, isCrossSite, readJson, send, sendError, subPath, type Handler } from "./http.ts";

export const LAYOUTS_ENDPOINT = "/api/layouts";
const NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;

export type StoredLayout = { name: string; text: string };

export async function listLayouts(dir: string): Promise<StoredLayout[]> {
  let files: string[];
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith(".yaml")).sort();
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
  return Promise.all(
    files.map(async (f) => ({
      name: f.slice(0, -".yaml".length),
      text: await readFile(path.join(dir, f), "utf8"),
    })),
  );
}

async function readOrNull(file: string): Promise<string | null> {
  try {
    return await readFile(file, "utf8");
  } catch {
    return null;
  }
}

/**
 * Writes a layout, keeping the comments of an existing file. A new variant with `from` starts from
 * the text of that variant (comments included) under a note saying where it came from.
 * Returns the new text.
 */
export async function saveLayout(dir: string, name: string, body: unknown): Promise<string> {
  if (!NAME.test(name)) throw new HttpError(400, "invalid layout name");
  const layout = layoutSchema.parse((body as { layout?: unknown })?.layout);
  if (layout.name !== name) throw new HttpError(400, "layout name must match the file name");
  const from = (body as { from?: unknown }).from;
  if (from !== undefined && (typeof from !== "string" || !NAME.test(from)))
    throw new HttpError(400, "invalid source layout name");
  const file = path.join(dir, `${name}.yaml`);
  let original = await readOrNull(file);
  if (original === null && from !== undefined && from !== name) {
    const source = await readOrNull(path.join(dir, `${from}.yaml`));
    if (source !== null)
      original = `# Variant ${name}, duplicated from ${from}; the comments below come from ${from}.\n${source}`;
  }
  const text = original === null ? newLayoutText(layout) : updateLayoutText(original, layout);
  await mkdir(dir, { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  await writeFile(tmp, text, "utf8");
  await rename(tmp, file);
  return text;
}

/** Layout variants of the open project: GET lists them, PUT /<name> saves one. `dir` null = no project. */
export function layoutsHandler(dir: () => Promise<string | null>): Handler {
  return async (req, res, url) => {
    try {
      const name = decodeURIComponent(subPath(url).replace(/^\//, ""));
      const folder = await dir();
      if (req.method === "GET" && name === "") return send(res, 200, folder ? await listLayouts(folder) : []);
      if (req.method === "PUT" && name !== "") {
        if (isCrossSite(req.headers)) throw new HttpError(403, "cross-site request refused");
        if (!folder) throw new HttpError(409, "no project is open");
        const body = await readJson(req);
        return send(res, 200, { name, text: await saveLayout(folder, name, body) });
      }
      throw new HttpError(405, "method not allowed");
    } catch (e) {
      sendError(res, e, 400);
    }
  };
}
