// Dev-server API for config/measurements.yaml (numbers only, inside the repo).
//   GET /api/measurements   → { text }
//   PUT /api/measurements   body: { text } → validates against the schema, writes atomically, returns { text }.
// The page builds the new text itself (src/config/measurementsDoc.ts keeps the comments), so the
// server only checks it and writes it.
import { readFile, rename, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { parseMeasurements } from "../../config/loadMeasurements.ts";

export const MEASUREMENTS_ENDPOINT = "/api/measurements";
const MAX_BYTES = 200_000;

export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Validates and writes the new text of measurements.yaml (temp file + rename). Returns the text. */
export async function saveMeasurements(file: string, body: unknown): Promise<string> {
  const text = (body as { text?: unknown } | null)?.text;
  if (typeof text !== "string") throw new HttpError(400, "text missing");
  if (text.length > MAX_BYTES) throw new HttpError(413, "text too large");
  const parsed = parseMeasurements(text);
  if (!parsed.ok) throw new HttpError(400, parsed.error);
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
      if (data.length > MAX_BYTES * 2) reject(new HttpError(413, "body too large"));
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

export function measurementsPlugin(file: string): Plugin {
  return {
    name: "tattoo-planner-measurements",
    configureServer(server) {
      server.middlewares.use(MEASUREMENTS_ENDPOINT, (req, res) => {
        const sub = (req.url ?? "/").split("?")[0];
        const run = async () => {
          if (sub !== "/" && sub !== "") throw new HttpError(404, "not found");
          if (req.method === "GET") return send(res, 200, { text: await readFile(file, "utf8") });
          if (req.method === "PUT") {
            // Same-origin only: the page sends this header, a foreign site's form cannot.
            if (req.headers["content-type"] !== "application/json") throw new HttpError(415, "JSON only");
            return send(res, 200, { text: await saveMeasurements(file, await readBody(req)) });
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
