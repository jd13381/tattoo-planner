// HTTP routes of the image catalogue (docs/adr/0020-asset-structure.md):
//   GET   /api/assets                 → AssetListing (src/assets/types.ts), with each entry's section
//   GET   /api/assets/usage           → UsageListing: where each image is used
//   GET   /api/assets/image/<id>      → the bytes of that manifest asset, images only
//   POST  /api/assets/scan            → ScanReport: adds entries for new images, as `npm run assets:scan`
//   PATCH /api/assets/entries/<id>    body EntryPatch → the updated AssetListing
//   POST  /api/assets/batch           body BatchRequest → BatchResult (hide, unhide, set, delete)
//   POST  /api/assets/undo/<token>    undoes a batch (within a few seconds) → AssetListing
//   POST  /api/assets/commit/<token>  makes a pending delete final now (also by sendBeacon) → {}
//   POST  /api/assets/import?name&category&person  body: the image bytes → ImportResult
// Writes change manifest.yaml (keeping comments) and, for delete and import, move or add image
// files; nothing is ever overwritten. The sample project refuses all of them (server/sampleApi.ts).
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { MAX_IMPORT_BYTES } from "../src/assets/types.ts";
import { assetUsageMap, EditUndo, importAsset, parseBatch, parseImport, runBatch } from "./assetActions.ts";
import { findAssetImage, listAssets, parseEntryPatch, updateAssetEntry } from "./assetsApi.ts";
import {
  HttpError,
  isCrossSite,
  readJson,
  readRawBody,
  send,
  sendError,
  subPath,
  type Handler,
} from "./http.ts";
import type { PersonDirs } from "./persons.ts";
import { scanDataFolder } from "./scanFolder.ts";
import type { PendingDeletes } from "./trash.ts";

export type AssetsDeps = {
  /** The open project's folder, or null. */
  dir: () => Promise<string | null>;
  /** Its persons (server/persons.ts); the implicit one first. */
  persons: () => Promise<PersonDirs[]>;
  /** Asset ids open in the Image studio for that folder. */
  sessions: (dir: string) => string[];
  pending: PendingDeletes;
  undo?: EditUndo;
};

export async function serveImage(req: IncomingMessage, res: ServerResponse, dataDir: string, id: string) {
  const found = await findAssetImage(dataDir, id);
  if (!found.ok) return send(res, found.status, { error: found.message });
  const s = await stat(found.path);
  const lastModified = s.mtime.toUTCString();
  // Private: never stored by shared caches. Revalidated, so a replaced image shows up at once.
  res.setHeader("Cache-Control", "private, no-cache");
  res.setHeader("Last-Modified", lastModified);
  res.setHeader("X-Content-Type-Options", "nosniff");
  const since = req.headers["if-modified-since"];
  if (since && Date.parse(since) >= Math.floor(s.mtimeMs / 1000) * 1000) {
    res.statusCode = 304;
    res.end();
    return;
  }
  res.statusCode = 200;
  res.setHeader("Content-Type", found.type);
  res.setHeader("Content-Length", String(s.size));
  createReadStream(found.path).pipe(res);
}

function decodeId(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    throw new HttpError(400, "invalid asset id");
  }
}

/** The image catalogue of the open project. */
export function assetsHandler(deps: AssetsDeps): Handler {
  const undo = deps.undo ?? new EditUndo();
  return async (req, res, url) => {
    try {
      const sub = subPath(url);
      const dataDir = await deps.dir();
      // Pending deletes older than a minute become final now (also right after a restart).
      if (dataDir) await deps.pending.sweep(dataDir);
      const listing = async () =>
        listAssets(dataDir, { persons: await deps.persons(), trash: deps.pending.mode });

      if (req.method === "GET") {
        if (sub === "/" || sub === "") return send(res, 200, await listing());
        if (sub === "/usage")
          return send(res, 200, {
            usage: dataDir ? await assetUsageMap(dataDir, await deps.persons(), deps.sessions(dataDir)) : {},
          });
        const m = /^\/image\/([^/]+)$/.exec(sub);
        if (!m) return send(res, 404, { error: "not found" });
        if (!dataDir) return send(res, 404, { error: "no project is open" });
        return await serveImage(req, res, dataDir, decodeId(m[1]!));
      }

      // Only the planner page itself may change the catalogue.
      if (isCrossSite(req.headers)) return send(res, 403, { error: "cross-site request refused" });
      if (req.method === "POST" && sub === "/scan") {
        if (!dataDir) return send(res, 409, { error: "no project is open" });
        return send(res, 200, await scanDataFolder(dataDir));
      }
      const entry = /^\/entries\/([^/]+)$/.exec(sub);
      if (req.method === "PATCH" && entry) {
        if (req.headers["content-type"] !== "application/json") return send(res, 415, { error: "JSON only" });
        if (!dataDir) return send(res, 409, { error: "no project is open" });
        const patch = parseEntryPatch(await readJson(req, 20_000).catch(() => undefined));
        if (!patch)
          return send(res, 400, { error: "expected { tags?, notes?, hidden?, category?, person? }" });
        if (patch.person && !(await deps.persons()).some((p) => p.id === patch.person))
          return send(res, 400, { error: `unknown person ${patch.person}` });
        const r = await updateAssetEntry(dataDir, decodeId(entry[1]!), patch);
        if (!r.ok) return send(res, r.status, { error: r.message });
        return send(res, 200, await listing());
      }
      if (req.method !== "POST") return send(res, 405, { error: "method not allowed" });
      if (!dataDir) return send(res, 409, { error: "no project is open" });

      if (sub === "/batch") {
        const body = parseBatch(await readJson(req, 200_000));
        const r = await runBatch(dataDir, body, {
          persons: await deps.persons(),
          sessions: deps.sessions(dataDir),
          pending: deps.pending,
          undo,
        });
        if (!r.ok) return send(res, r.status, r.body);
        return send(res, 200, {
          listing: await listing(),
          changed: r.changed,
          undo: r.undo,
          ...(r.files !== undefined ? { files: r.files } : {}),
        });
      }
      const undoMatch = /^\/undo\/([a-z0-9]+)$/.exec(sub);
      if (undoMatch) {
        const token = undoMatch[1]!;
        if (undo.has(token)) await undo.undo(dataDir, token);
        else await deps.pending.undo(dataDir, token);
        return send(res, 200, await listing());
      }
      const commit = /^\/commit\/([a-z0-9]+)$/.exec(sub);
      if (commit) {
        // sendBeacon sends text/plain; there is no body to read.
        req.resume();
        await deps.pending.commit(dataDir, commit[1]!);
        return send(res, 200, {});
      }
      if (sub === "/import") {
        // Raw image bytes only: a foreign page's form can send neither of these without a preflight.
        const type = (req.headers["content-type"] ?? "").split(";")[0]!.trim();
        if (!type.startsWith("image/") && type !== "application/octet-stream")
          return send(res, 415, { error: "send the image bytes" });
        const persons = await deps.persons();
        const query = new URLSearchParams(url.split("?")[1] ?? "");
        const request = parseImport(query, persons);
        const bytes = await readRawBody(req, MAX_IMPORT_BYTES);
        if (bytes.length === 0) throw new HttpError(400, "empty file");
        const r = await importAsset(dataDir, request, bytes, persons);
        return send(res, 200, { listing: await listing(), ...r });
      }
      return send(res, 404, { error: "not found" });
    } catch (e) {
      sendError(res, e, 500);
    }
  };
}
