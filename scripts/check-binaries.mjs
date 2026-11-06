#!/usr/bin/env node
// Pre-commit guard (PROJECT_BRIEF.md §12.5): rejects images, PDFs and exports.
// Default: checks the files staged for commit. `--all` checks every tracked file (used in CI).
// Exit code 1 lists the offending paths; 0 means the commit may proceed.
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

/** File extensions that never go into git, compared case-insensitively. */
export const BLOCKED_EXTENSIONS = [
  "png",
  "jpg",
  "jpeg",
  "webp",
  "heic",
  "heif",
  "gif",
  "avif",
  "tif",
  "tiff",
  "bmp",
  "psd",
  "pdf",
  // Desktop app build output (docs/adr/0015-desktop-app.md).
  "dmg",
  "icns",
  "asar",
];

/**
 * Explicit exceptions, e.g. UI icons drawn for this repo. Each entry is a path prefix.
 * Adding an entry needs Jan's OK; never add one to get a reference image or export in.
 */
export const ALLOW_PREFIXES = ["public/icons/"];

/**
 * The one exception for images: the standard backgrounds (docs/adr/0019), tileable PNG/WebP tiles
 * generated with GPT Image by `npm run backgrounds:generate` (Jan, 2026-11-06). Only directly in
 * that folder, only those formats, and each at most BACKGROUND_MAX_BYTES. Never a reference image,
 * photo or export.
 */
export const BACKGROUND_FOLDER = "assets/backgrounds/";
export const BACKGROUND_EXTENSIONS = ["png", "webp"];
export const BACKGROUND_MAX_BYTES = 2 * 1024 * 1024;

/** Build output folders at the repo root that never go into git (the web build, the desktop app's). */
export const BUILD_DIRS = ["dist", "dist-desktop", "release"];

/**
 * Returns the reason a path is rejected, or null when it may be committed. `bytes` is the file's
 * size (checked for the standard backgrounds; unknown counts as too large there).
 */
export function rejectReason(file, bytes) {
  const p = file.replaceAll("\\", "/");
  if (ALLOW_PREFIXES.some((prefix) => p.startsWith(prefix))) return null;
  const ext = p.split("/").pop().split(".").slice(1).pop()?.toLowerCase();
  if (p.startsWith(BACKGROUND_FOLDER) && !p.slice(BACKGROUND_FOLDER.length).includes("/")) {
    if (ext && BACKGROUND_EXTENSIONS.includes(ext)) {
      if (bytes === undefined || bytes > BACKGROUND_MAX_BYTES)
        return `standard background over ${BACKGROUND_MAX_BYTES / 1024 / 1024} MB`;
      return null;
    }
  }
  if (p === "exports" || p.startsWith("exports/") || p.includes("/exports/")) return "export";
  const top = p.split("/")[0];
  if (BUILD_DIRS.includes(top)) return "build output";
  if (ext && BLOCKED_EXTENSIONS.includes(ext)) return `.${ext} file`;
  return null;
}

function listFiles(all) {
  const args = all ? ["ls-files", "-z"] : ["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"];
  return execFileSync("git", args, { encoding: "utf8" }).split("\0").filter(Boolean);
}

/** The size of the file as staged (the index holds every tracked file too). */
function stagedBytes(file) {
  try {
    return Number(execFileSync("git", ["cat-file", "-s", `:${file}`], { encoding: "utf8" }).trim());
  } catch {
    return undefined;
  }
}

function main() {
  const all = process.argv.includes("--all");
  const offenders = listFiles(all)
    .map((f) => [f, rejectReason(f, f.startsWith(BACKGROUND_FOLDER) ? stagedBytes(f) : undefined)])
    .filter(([, reason]) => reason);
  if (offenders.length === 0) return 0;
  console.error(`check-binaries: ${offenders.length} file(s) must not be committed:`);
  for (const [f, reason] of offenders) console.error(`  ${f}  (${reason})`);
  console.error("Images, PDFs and exports belong in TATTOO_DATA_DIR (Seafile), not in git.");
  if (!all) console.error("Unstage them with: git restore --staged <file>");
  return 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) process.exit(main());
