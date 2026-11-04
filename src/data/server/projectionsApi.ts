// Dev-server API for photo projections in config/projections/ (text YAML only, inside the repo;
// docs/adr/0006-anubis-projection.md). Numbers only: the photos themselves stay in the data folder.
//   GET  /api/projections          → [{ name, text }]
//   PUT  /api/projections/<name>   body: { calibration } → validates, keeps comments, writes atomically.
import { readdir, readFile, rename, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import type { Plugin } from "vite";
import { projectionSchema } from "../../projection/schema.ts";
import { newProjectionText, updateProjectionText } from "../../projection/yamlDoc.ts";

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

export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
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
  const tmp = `${file}.tmp-${process.pid}`;
  await writeFile(tmp, text, "utf8");
  await rename(tmp, file);
  return text;
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => {
      data += chunk;
      if (data.length > 1_000_000) reject(new HttpError(413, "body too large"));
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new HttpError(400, "invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

export function projectionsPlugin(dir: string): Plugin {
  return {
    name: "tattoo-planner-projections",
    configureServer(server) {
      server.middlewares.use(PROJECTIONS_ENDPOINT, (req, res) => {
        const name = decodeURIComponent((req.url ?? "/").replace(/^\//, "").split("?")[0] ?? "");
        const run = async () => {
          if (req.method === "GET" && name === "") return send(res, 200, await listProjections(dir));
          if (req.method === "PUT" && name !== "") {
            // Same-origin only: the page sends this header, a foreign site's form cannot.
            if (req.headers["content-type"] !== "application/json") throw new HttpError(415, "JSON only");
            return send(res, 200, { name, text: await saveProjection(dir, name, await readBody(req)) });
          }
          throw new HttpError(405, "method not allowed");
        };
        run().catch((e: unknown) => {
          const status = e instanceof HttpError ? e.status : 400;
          send(res, status, { error: e instanceof Error ? e.message : String(e) });
        });
      });
    },
  };
}
