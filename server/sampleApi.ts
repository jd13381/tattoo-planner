// The read-only sample project in the API (docs/adr/0012-project-folder.md, "Sample project").
// Runs before the area handlers while the sample is open:
// - every write answers 409 with SAMPLE_READ_ONLY (layouts, projections, measurements, project
//   details, migration, asset scan and entry edits, the Image studio, exports);
// - GET /api/exports and GET /api/edits report exports and edits as unavailable, with the same reason;
// - GET /api/assets marks the drawn placeholders as present and GET /api/assets/image/<id> serves them,
//   or the shipped photo the entry names (docs/adr/0029).
// Opening, creating and closing projects, opening the sample and "Save as new project" stay allowed.
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AssetListing } from "../src/assets/types.ts";
import type { EditOverview } from "../src/edits/types.ts";
import type { ExportStatus } from "../src/export/names.ts";
import { listAssets } from "./assetsApi.ts";
import { serveImage } from "./assetsHandler.ts";
import { send, subPath } from "./http.ts";
import { placeholderPng, SAMPLE_READ_ONLY } from "./project/sample.ts";

/** POSTs below /api/project that switch or copy projects; they work while the sample is open. */
const PROJECT_SWITCHES = new Set(["/open", "/create", "/close", "/open-sample", "/save-sample"]);

/** Switching projects, or showing another person (docs/adr/0017-persons.md), changes no file. */
function isProjectSwitch(sub: string): boolean {
  return PROJECT_SWITCHES.has(sub) || /^\/persons\/[^/]+\/select$/.test(sub);
}

/** Whether a request would change the open project (and so is refused for the sample). */
export function isSampleWrite(method: string, url: string): boolean {
  const m = method.toUpperCase();
  if (m === "GET" || m === "HEAD") return false;
  const p = subPath(url).replace(/\/+$/, "");
  if (p === "/api/project" || p.startsWith("/api/project/"))
    return !(m === "POST" && isProjectSwitch(p.slice("/api/project".length)));
  return /^\/api\/(layouts|projections|assets|edits|exports|data-files)(\/|$)/.test(p);
}

const exportsOff: ExportStatus = { enabled: false, reason: SAMPLE_READ_ONLY };

function editsOff(): EditOverview {
  return {
    builtin: { enabled: false, reason: SAMPLE_READ_ONLY },
    generative: { enabled: false, reason: SAMPLE_READ_ONLY },
    jobs: [],
    sessions: [],
  };
}

/** The sample's manifest, with every entry whose placeholder the server draws marked as present. */
export async function sampleAssets(sampleDir: string): Promise<AssetListing> {
  const listing = await listAssets(sampleDir);
  if (listing.status !== "ok") return listing;
  return {
    ...listing,
    readOnly: true,
    assets: listing.assets.map((a) => (placeholderPng(a.file) ? { ...a, exists: true } : a)),
  };
}

async function serveSampleImage(req: IncomingMessage, res: ServerResponse, sampleDir: string, rawId: string) {
  let id: string;
  try {
    id = decodeURIComponent(rawId);
  } catch {
    return send(res, 400, { error: "invalid asset id" });
  }
  const listing = await listAssets(sampleDir);
  const asset = listing.status === "ok" ? listing.assets.find((a) => a.id === id) : undefined;
  const png = asset ? placeholderPng(asset.file) : null;
  // Not drawn: a photo shipped with the sample (docs/adr/0029), or 404.
  if (!png) return serveImage(req, res, sampleDir, id);
  res.statusCode = 200;
  res.setHeader("Content-Type", "image/png");
  res.setHeader("Content-Length", String(png.length));
  res.setHeader("Cache-Control", "private, no-cache");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.end(png);
}

/**
 * Answers a request for the open sample when it must differ from a normal project; returns false to
 * let the area handlers answer (reads of layouts, project status, the folder listing …).
 */
export async function handleSampleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  sampleDir: string,
): Promise<boolean> {
  const method = req.method ?? "GET";
  const url = req.url ?? "/";
  if (isSampleWrite(method, url)) {
    send(res, 409, { error: SAMPLE_READ_ONLY });
    return true;
  }
  if (method !== "GET") return false;
  const p = subPath(url).replace(/\/+$/, "");
  if (p === "/api/exports") {
    send(res, 200, exportsOff);
    return true;
  }
  if (p === "/api/edits") {
    send(res, 200, editsOff());
    return true;
  }
  if (p === "/api/assets") {
    send(res, 200, await sampleAssets(sampleDir));
    return true;
  }
  const image = /^\/api\/assets\/image\/([^/]+)$/.exec(p);
  if (image) {
    await serveSampleImage(req, res, sampleDir, image[1]!);
    return true;
  }
  return false;
}
