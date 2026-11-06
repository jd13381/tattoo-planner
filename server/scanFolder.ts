// Catalogues new images in the data folder (ADR 0003, `assets:scan`): shared by the npm script and the
// planner's Reload buttons (POST /api/assets/scan). Only adds manifest entries; Jan's entries,
// comments and edits stay as they are, and an unchanged manifest is not rewritten.
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { MANIFEST_FILE } from "../src/assets/manifest.ts";
import { mergeManifest } from "../src/assets/manifestDoc.ts";
import { scanCandidates } from "../src/assets/scan.ts";
import type { ScanReport } from "../src/assets/types.ts";
import { listDataFiles } from "./dataDir.ts";
import { withManifestLock, writeAtomic } from "./manifestLock.ts";

/** Serialised with every other manifest write of this process, so two quick Reloads do not race. */
export function scanDataFolder(dir: string): Promise<ScanReport> {
  return withManifestLock(() => scanNow(dir));
}

async function scanNow(dir: string): Promise<ScanReport> {
  const listing = await listDataFiles(dir);
  if (listing.status !== "ok") throw new Error(`cannot list ${dir}`);
  const paths = listing.files.map((f) => f.path);
  const present = new Set(paths);
  const { candidates, unsupported, outside } = scanCandidates(paths);
  for (const asset of candidates) {
    // A sidecar text file next to an image (refs/foo.jpg + refs/foo.txt) holds its source.
    const sidecar = asset.file.replace(/\.[^./]+$/, ".txt");
    if (!present.has(sidecar)) continue;
    const text = (await readFile(path.join(dir, sidecar), "utf8")).replace(/\s+/g, " ").trim();
    if (text) asset.source = text;
  }
  const file = path.join(dir, MANIFEST_FILE);
  const original = existsSync(file) ? await readFile(file, "utf8") : null;
  const result = mergeManifest(original?.trim() ? original : null, candidates, {});
  if (result.changed) await writeAtomic(file, result.text);
  return {
    found: candidates.length,
    added: result.added,
    unsupported,
    outside,
    truncated: listing.truncated,
  };
}
