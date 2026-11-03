// Dev-server API for layout variants in config/layouts/ (text YAML only, inside the repo).
//   GET  /api/layouts          → [{ name, text }]
//   PUT  /api/layouts/<name>   body: { layout, from? } → validates, keeps comments, writes atomically.
//        `from` (a new variant only): start from that variant's file, so its comments are copied too.
import { readdir, readFile, rename, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import type { Plugin } from "vite";
import { layoutSchema } from "../../layout/schema.ts";
import { newLayoutText, updateLayoutText } from "../../layout/yamlDoc.ts";

export const LAYOUTS_ENDPOINT = "/api/layouts";
const NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;

export type StoredLayout = { name: string; text: string };

export async function listLayouts(dir: string): Promise<StoredLayout[]> {
  const files = (await readdir(dir)).filter((f) => f.endsWith(".yaml")).sort();
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
  const tmp = `${file}.tmp-${process.pid}`;
  await writeFile(tmp, text, "utf8");
  await rename(tmp, file);
  return text;
}

class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
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

export function layoutsPlugin(dir: string): Plugin {
  return {
    name: "tattoo-planner-layouts",
    configureServer(server) {
      server.middlewares.use(LAYOUTS_ENDPOINT, (req, res) => {
        const name = decodeURIComponent((req.url ?? "/").replace(/^\//, "").split("?")[0] ?? "");
        const run = async () => {
          if (req.method === "GET" && name === "") return send(res, 200, await listLayouts(dir));
          if (req.method === "PUT" && name !== "") {
            // Same-origin only: the page sends this header, a foreign site's form cannot.
            if (req.headers["content-type"] !== "application/json") throw new HttpError(415, "JSON only");
            return send(res, 200, { name, text: await saveLayout(dir, name, await readBody(req)) });
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
