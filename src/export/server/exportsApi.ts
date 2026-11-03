// Dev-server endpoint that writes exports into <TATTOO_DATA_DIR>/exports/ (never into the repo).
//   GET  /api/exports          → ExportStatus: can exports be written at all?
//   POST /api/exports          body { layout, date } → ExportReservation: a fresh name for today's
//                              export (`-2`, `-3`, … when one exists); creates its PNG folder
//   PUT  /api/exports/<path>   raw bytes, Content-Type application/pdf or image/png → WrittenFile
//                              <path> = `<base>.pdf` or `<base>/<name>.png` of a reserved base
// Files are never overwritten, never leave exports/ (also not through symlinks) and are checked for
// type (extension, Content-Type and magic bytes) and size. Local dev server only.
import { lstat, mkdir, realpath, stat, unlink, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import type { Plugin } from "vite";
import { isInside } from "../../data/server/assetsApi.ts";
import {
  CONTENT_TYPES,
  EXPORTS_ENDPOINT,
  EXPORTS_FOLDER,
  exportBase,
  isIsoDate,
  isSlug,
  MAX_PDF_BYTES,
  MAX_PNG_BYTES,
  MAX_SUFFIX,
  parseExportPath,
  type ExportReservation,
  type ExportStatus,
  type WrittenFile,
} from "../names.ts";

export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const UNSET_REASON =
  "TATTOO_DATA_DIR is not set: exports go only into <data folder>/exports, never into the repo. Set it in .env and restart npm run dev.";

export async function exportStatus(dataDir: string | null): Promise<ExportStatus> {
  if (!dataDir) return { enabled: false, reason: UNSET_REASON };
  try {
    const s = await stat(dataDir);
    if (!s.isDirectory()) return { enabled: false, reason: `the data folder is not a folder: ${dataDir}` };
  } catch {
    return { enabled: false, reason: `data folder not found: ${dataDir}` };
  }
  return { enabled: true };
}

/**
 * The real path of <dataDir>/exports, created when missing. Refused when it is a symlink (or a
 * file) that leads out of the data folder.
 */
export async function exportsDir(dataDir: string): Promise<string> {
  const status = await exportStatus(dataDir);
  if (!status.enabled) throw new HttpError(409, status.reason);
  const root = await realpath(dataDir);
  const dir = path.join(root, EXPORTS_FOLDER);
  await mkdir(dir, { recursive: false }).catch((e: NodeJS.ErrnoException) => {
    if (e.code !== "EEXIST") throw e;
  });
  const real = await realpath(dir);
  if (!isInside(root, real)) throw new HttpError(403, "exports/ leads out of the data folder");
  if (!(await stat(real)).isDirectory()) throw new HttpError(409, "exports is not a folder");
  return real;
}

async function exists(p: string): Promise<boolean> {
  try {
    await lstat(p);
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw e;
  }
}

/**
 * Picks the first free `<layout>-<date>[-N]` (neither the PDF nor the folder exists) and creates
 * its folder. mkdir is atomic, so two exports at the same moment get different names.
 */
export async function reserveExport(
  dataDir: string | null,
  layout: unknown,
  date: unknown,
): Promise<ExportReservation> {
  if (!dataDir) throw new HttpError(409, UNSET_REASON);
  if (typeof layout !== "string" || !isSlug(layout)) throw new HttpError(400, "invalid layout name");
  if (typeof date !== "string" || !isIsoDate(date)) throw new HttpError(400, "date must be YYYY-MM-DD");
  const dir = await exportsDir(dataDir);
  for (let n = 1; n <= MAX_SUFFIX; n++) {
    const base = exportBase(layout, date, n);
    if (await exists(path.join(dir, `${base}.pdf`))) continue;
    try {
      await mkdir(path.join(dir, base));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "EEXIST") continue;
      throw e;
    }
    return { base, pdf: `${EXPORTS_FOLDER}/${base}.pdf`, folder: `${EXPORTS_FOLDER}/${base}/` };
  }
  throw new HttpError(409, `more than ${MAX_SUFFIX} exports of ${layout} on ${date}`);
}

const MAGIC = {
  pdf: Buffer.from("%PDF-", "latin1"),
  png: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
};

/** Checks name, type and size of one export file; returns the absolute target path. */
export function checkExportFile(
  exportsRoot: string,
  rel: string,
  contentType: string | undefined,
  bytes: Uint8Array,
): { path: string; kind: "pdf" | "png"; base: string } {
  const target = parseExportPath(rel);
  if (!target) throw new HttpError(400, `invalid export path ${JSON.stringify(rel)}`);
  const type = (contentType ?? "").split(";")[0]!.trim().toLowerCase();
  if (type !== CONTENT_TYPES[target.kind]) throw new HttpError(415, `expected ${CONTENT_TYPES[target.kind]}`);
  const max = target.kind === "pdf" ? MAX_PDF_BYTES : MAX_PNG_BYTES;
  if (bytes.length === 0) throw new HttpError(400, "empty file");
  if (bytes.length > max) throw new HttpError(413, "file too large");
  const magic = MAGIC[target.kind];
  if (!Buffer.from(bytes.buffer, bytes.byteOffset, magic.length).equals(magic))
    throw new HttpError(415, `not a ${target.kind.toUpperCase()} file`);
  const abs = path.resolve(exportsRoot, ...rel.split("/"));
  if (!isInside(exportsRoot, abs)) throw new HttpError(400, "path leaves exports/");
  return { path: abs, kind: target.kind, base: target.base };
}

/**
 * Writes one file of a reserved export. Its folder must exist (reserveExport made it), so nothing
 * is written for a name that was not reserved; an existing file is never replaced.
 */
export async function writeExportFile(
  dataDir: string | null,
  rel: string,
  contentType: string | undefined,
  bytes: Uint8Array,
): Promise<WrittenFile> {
  if (!dataDir) throw new HttpError(409, UNSET_REASON);
  const root = await exportsDir(dataDir);
  const file = checkExportFile(root, rel, contentType, bytes);
  const folder = path.join(root, file.base);
  let realFolder: string;
  try {
    realFolder = await realpath(folder);
  } catch {
    throw new HttpError(409, `export ${file.base} was not reserved`);
  }
  if (realFolder !== folder || !(await stat(realFolder)).isDirectory())
    throw new HttpError(403, `exports/${file.base} is not a plain folder`);
  try {
    // "wx": fail when the file exists, so an export never replaces another one.
    await writeFile(file.path, bytes, { flag: "wx" });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST") throw new HttpError(409, `${rel} exists already`);
    await unlink(file.path).catch(() => undefined);
    throw e;
  }
  return { path: `${EXPORTS_FOLDER}/${rel}`, absolute: file.path, bytes: bytes.length };
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

/**
 * Only the planner page itself may write. Browsers send Sec-Fetch-Site; a request from another
 * site is refused. (The non-simple Content-Types also force a CORS preflight that Vite never grants.)
 */
export function isCrossSite(headers: IncomingMessage["headers"]): boolean {
  const site = headers["sec-fetch-site"];
  return site !== undefined && site !== "same-origin" && site !== "none";
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

export function exportsPlugin(dataDir: string | null): Plugin {
  return {
    name: "tattoo-planner-exports",
    configureServer(server) {
      server.middlewares.use(EXPORTS_ENDPOINT, (req, res) => {
        const sub = ((req.url ?? "/").split("?")[0] ?? "/").replace(/^\//, "");
        const run = async () => {
          if (req.method === "GET" && sub === "") return send(res, 200, await exportStatus(dataDir));
          if (isCrossSite(req.headers)) throw new HttpError(403, "cross-site request refused");
          if (req.method === "POST" && sub === "") {
            if (req.headers["content-type"] !== "application/json") throw new HttpError(415, "JSON only");
            let body: { layout?: unknown; date?: unknown };
            try {
              body = JSON.parse((await readRawBody(req, 10_000)).toString("utf8")) as typeof body;
            } catch (e) {
              throw e instanceof HttpError ? e : new HttpError(400, "invalid JSON");
            }
            return send(res, 200, await reserveExport(dataDir, body?.layout, body?.date));
          }
          if (req.method === "PUT" && sub !== "") {
            let rel: string;
            try {
              rel = decodeURIComponent(sub);
            } catch {
              throw new HttpError(400, "invalid path");
            }
            const limit = rel.endsWith(".pdf") ? MAX_PDF_BYTES : MAX_PNG_BYTES;
            const bytes = await readRawBody(req, limit);
            return send(res, 200, await writeExportFile(dataDir, rel, req.headers["content-type"], bytes));
          }
          throw new HttpError(405, "method not allowed");
        };
        run().catch((e: unknown) => {
          const status = e instanceof HttpError ? e.status : 500;
          send(res, status, { error: e instanceof Error ? e.message : String(e) });
        });
      });
    },
  };
}
