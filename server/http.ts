// Small HTTP helpers shared by the API handlers (plain Node, no framework).
import type { IncomingMessage, ServerResponse } from "node:http";

export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Connect-style middleware, as Vite's dev and preview servers and `server/standalone.ts` mount it. */
export type Middleware = (req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void) => void;

/**
 * Handles one request below an endpoint prefix. `url` is the rest of the URL after the prefix
 * (`/entries/x?y`, or `/` for the prefix itself), as Connect's `use(prefix, fn)` passes it.
 */
export type Handler = (req: IncomingMessage, res: ServerResponse, url: string) => Promise<void>;

export function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

/** The path part of a handler's `url`, without the query. */
export function subPath(url: string): string {
  return url.split("?")[0] ?? "/";
}

export function readRawBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers["content-length"]);
    if (Number.isFinite(declared) && declared > limit) {
      reject(new HttpError(413, "file too large"));
      req.resume();
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new HttpError(413, "file too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/** Reads a JSON body; refuses another Content-Type (a foreign site's form cannot send JSON). */
export async function readJson(req: IncomingMessage, limit = 1_000_000): Promise<unknown> {
  if ((req.headers["content-type"] ?? "").split(";")[0]!.trim() !== "application/json")
    throw new HttpError(415, "JSON only");
  const raw = await readRawBody(req, limit);
  try {
    return JSON.parse(raw.toString("utf8"));
  } catch {
    throw new HttpError(400, "invalid JSON");
  }
}

/**
 * Only the planner page itself may write. Browsers send Sec-Fetch-Site; a request from another
 * site is refused. (The non-simple Content-Types also force a CORS preflight that is never granted.)
 */
export function isCrossSite(headers: IncomingMessage["headers"]): boolean {
  const site = headers["sec-fetch-site"];
  return site !== undefined && site !== "same-origin" && site !== "none";
}

/** Sends an error from a handler: HttpError keeps its status, anything else gets `fallback`. */
export function sendError(res: ServerResponse, e: unknown, fallback = 500) {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  const status = e instanceof HttpError ? e.status : fallback;
  send(res, status, { error: e instanceof Error ? e.message : String(e) });
}
