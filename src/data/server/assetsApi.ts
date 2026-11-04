// Dev-server API for the asset manifest (<TATTOO_DATA_DIR>/manifest.yaml) and its images.
//   GET /api/assets             → AssetListing (src/assets/types.ts)
//   GET /api/assets/image/<id>  → the bytes of that manifest asset, images only
//   POST /api/assets/scan       → ScanReport: adds entries for new images, as `npm run assets:scan`
// Only files named in the manifest are served, and only when they resolve inside the data folder.
// The scan is the only write: it appends manifest entries and never touches an image.
import { createReadStream } from "node:fs";
import { readFile, realpath, stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import type { Plugin } from "vite";
import { parseDocument } from "yaml";
import { assetSchema, MANIFEST_FILE, type Asset } from "../../assets/manifest.ts";
import { ASSETS_ENDPOINT, type AssetInfo, type AssetListing } from "../../assets/types.ts";
import { scanDataFolder } from "./scanFolder.ts";

/** Image types a browser can show. HEIC/HEIF are named separately: Chrome cannot decode them. */
export const IMAGE_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
};
const UNSHOWABLE = new Set(["heic", "heif"]);

export type ContentTypeResult = { ok: true; type: string } | { ok: false; status: 415; message: string };

/** Content type from the file extension (case-insensitive). */
export function imageContentType(file: string): ContentTypeResult {
  const ext = path.posix.extname(file.replaceAll("\\", "/")).slice(1).toLowerCase();
  const type = IMAGE_TYPES[ext];
  if (type) return { ok: true, type };
  if (UNSHOWABLE.has(ext))
    return {
      ok: false,
      status: 415,
      message: `.${ext} cannot be shown in the browser; export it as JPEG or PNG`,
    };
  return { ok: false, status: 415, message: `not an image type the planner shows (.${ext || "none"})` };
}

/**
 * Lexical check of a manifest `file` value: relative, forward slashes, no `..`, inside the folder.
 * Returns the absolute path or an error message. Symlinks are checked by `resolveInside`.
 */
export function assetPath(
  dataDir: string,
  file: string,
): { ok: true; path: string } | { ok: false; message: string } {
  if (!file || file.includes("\0")) return { ok: false, message: "empty or invalid path" };
  if (file.includes("\\")) return { ok: false, message: "use forward slashes" };
  if (file.startsWith("/") || /^[a-zA-Z]:/.test(file) || file.startsWith("~"))
    return { ok: false, message: "path must be relative to the data folder" };
  if (file.split("/").some((seg) => seg === "..")) return { ok: false, message: "path must not contain .." };
  const root = path.resolve(dataDir);
  const abs = path.resolve(root, file);
  if (!isInside(root, abs)) return { ok: false, message: "path leaves the data folder" };
  return { ok: true, path: abs };
}

export function isInside(root: string, p: string): boolean {
  const rel = path.relative(root, p);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/** Follows symlinks and checks the real file still lies inside the real data folder. */
export async function resolveInside(
  dataDir: string,
  file: string,
): Promise<{ ok: true; path: string } | { ok: false; message: string }> {
  const lexical = assetPath(dataDir, file);
  if (!lexical.ok) return lexical;
  try {
    const [realRoot, realFile] = await Promise.all([realpath(dataDir), realpath(lexical.path)]);
    if (!isInside(realRoot, realFile)) return { ok: false, message: "path leaves the data folder (symlink)" };
    const s = await stat(realFile);
    if (!s.isFile()) return { ok: false, message: "not a file" };
    return { ok: true, path: realFile };
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    return { ok: false, message: code === "ENOENT" ? "file not found" : String(code ?? e) };
  }
}

/**
 * Parses the manifest leniently: invalid or duplicate entries become warnings and are skipped,
 * so one typo does not hide every image.
 */
export function parseManifestText(text: string): { assets: Asset[]; warnings: string[] } | { error: string } {
  const doc = parseDocument(text);
  if (doc.errors.length > 0) return { error: `${MANIFEST_FILE}: YAML syntax: ${doc.errors[0]!.message}` };
  const raw: unknown = doc.toJS() ?? {};
  if (typeof raw !== "object" || raw === null || Array.isArray(raw))
    return { error: `${MANIFEST_FILE}: expected a mapping with an assets list` };
  const warnings: string[] = [];
  const { version, assets: list, ...rest } = raw as Record<string, unknown>;
  if (version !== undefined && version !== 1) warnings.push(`unknown manifest version ${String(version)}`);
  for (const key of Object.keys(rest)) warnings.push(`unknown top-level key "${key}" ignored`);
  if (list !== undefined && !Array.isArray(list)) return { error: `${MANIFEST_FILE}: assets must be a list` };
  const assets: Asset[] = [];
  const seen = new Set<string>();
  (list ?? []).forEach((entry: unknown, i: number) => {
    const r = assetSchema.safeParse(entry);
    const label = `assets[${i}]${typeof (entry as { id?: unknown })?.id === "string" ? ` (${(entry as { id: string }).id})` : ""}`;
    if (!r.success) {
      warnings.push(
        `${label}: ${r.error.issues.map((x) => `${x.path.join(".") || "entry"}: ${x.message}`).join("; ")}`,
      );
      return;
    }
    if (seen.has(r.data.id)) {
      warnings.push(`${label}: duplicate id, first entry wins`);
      return;
    }
    seen.add(r.data.id);
    assets.push(r.data);
  });
  return { assets, warnings };
}

export async function listAssets(dataDir: string | null): Promise<AssetListing> {
  if (!dataDir) return { status: "unset" };
  let text: string;
  try {
    text = await readFile(path.join(dataDir, MANIFEST_FILE), "utf8");
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      try {
        const s = await stat(dataDir);
        if (!s.isDirectory()) return { status: "error", message: "the data folder is not a folder" };
      } catch {
        return { status: "error", message: "data folder not found" };
      }
      return { status: "ok", assets: [], manifestFound: false, warnings: [] };
    }
    return { status: "error", message: `cannot read ${MANIFEST_FILE}: ${String(code ?? e)}` };
  }
  const parsed = parseManifestText(text);
  if ("error" in parsed) return { status: "error", message: parsed.error };
  const warnings = [...parsed.warnings];
  const assets: AssetInfo[] = await Promise.all(
    parsed.assets.map(async (a) => {
      const r = await resolveInside(dataDir, a.file);
      if (!r.ok && r.message !== "file not found") warnings.push(`${a.id}: ${a.file}: ${r.message}`);
      return { ...a, exists: r.ok };
    }),
  );
  return { status: "ok", assets, manifestFound: true, warnings };
}

export type ImageLookup =
  { ok: true; path: string; type: string } | { ok: false; status: 400 | 404 | 415; message: string };

/** Finds the file for an asset id: only manifest entries, only images, only inside the data folder. */
export async function findAssetImage(dataDir: string, id: string): Promise<ImageLookup> {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) return { ok: false, status: 400, message: "invalid asset id" };
  const listing = await listAssets(dataDir);
  if (listing.status !== "ok") return { ok: false, status: 404, message: "no manifest" };
  const asset = listing.assets.find((a) => a.id === id);
  if (!asset) return { ok: false, status: 404, message: `unknown asset ${id}` };
  const type = imageContentType(asset.file);
  if (!type.ok) return type;
  const r = await resolveInside(dataDir, asset.file);
  if (!r.ok) return { ok: false, status: r.message === "file not found" ? 404 : 400, message: r.message };
  return { ok: true, path: r.path, type: type.type };
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

async function serveImage(req: IncomingMessage, res: ServerResponse, dataDir: string, id: string) {
  const found = await findAssetImage(dataDir, id);
  if (!found.ok) return sendJson(res, found.status, { error: found.message });
  const s = await stat(found.path);
  const lastModified = s.mtime.toUTCString();
  // Private: never stored by shared caches. Revalidated, so a re-ingested image shows up at once.
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

export function assetsPlugin(dataDir: string | null): Plugin {
  return {
    name: "tattoo-planner-assets",
    configureServer(server) {
      server.middlewares.use(ASSETS_ENDPOINT, (req, res) => {
        const sub = (req.url ?? "/").split("?")[0] ?? "/";
        const run = async () => {
          if (req.method === "POST" && sub === "/scan") {
            // Only the planner page itself may change the manifest.
            const site = req.headers["sec-fetch-site"];
            if (site !== undefined && site !== "same-origin" && site !== "none")
              return sendJson(res, 403, { error: "cross-site request refused" });
            if (!dataDir) return sendJson(res, 409, { error: "TATTOO_DATA_DIR is not set" });
            return sendJson(res, 200, await scanDataFolder(dataDir));
          }
          if (req.method !== "GET") return sendJson(res, 405, { error: "method not allowed" });
          if (sub === "/" || sub === "") return sendJson(res, 200, await listAssets(dataDir));
          const m = /^\/image\/([^/]+)$/.exec(sub);
          if (!m) return sendJson(res, 404, { error: "not found" });
          if (!dataDir) return sendJson(res, 404, { error: "TATTOO_DATA_DIR is not set" });
          let id: string;
          try {
            id = decodeURIComponent(m[1]!);
          } catch {
            return sendJson(res, 400, { error: "invalid asset id" });
          }
          return serveImage(req, res, dataDir, id);
        };
        run().catch((e: unknown) =>
          sendJson(res, 500, { error: e instanceof Error ? e.message : String(e) }),
        );
      });
    },
  };
}
