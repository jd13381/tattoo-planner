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

/**
 * The second exception (docs/adr/0026, Jan, 2026-11-15): the README screenshots, written by
 * `npm run screenshots` from the shipped sample project only. WebP directly in that folder, at
 * most SCREENSHOT_MAX_BYTES each. Never a photo, a reference image or anything from a real project.
 */
export const SCREENSHOT_FOLDER = "docs/screenshots/";
export const SCREENSHOT_EXTENSIONS = ["webp"];
export const SCREENSHOT_MAX_BYTES = 500 * 1024;

/** Folders where images of the given kinds and size may be committed (flat, no subfolders). */
const SIZED_IMAGE_FOLDERS = [
  {
    folder: BACKGROUND_FOLDER,
    extensions: BACKGROUND_EXTENSIONS,
    maxBytes: BACKGROUND_MAX_BYTES,
    what: "standard background",
  },
  {
    folder: SCREENSHOT_FOLDER,
    extensions: SCREENSHOT_EXTENSIONS,
    maxBytes: SCREENSHOT_MAX_BYTES,
    what: "README screenshot",
  },
];

/** "2 MB", "500 KB". */
function formatBytes(n) {
  return n >= 1024 * 1024 ? `${n / 1024 / 1024} MB` : `${n / 1024} KB`;
}

/** Whether the file's size must be known to judge it (it lies in one of the sized image folders). */
export function needsSize(file) {
  const p = file.replaceAll("\\", "/");
  return SIZED_IMAGE_FOLDERS.some(({ folder }) => p.startsWith(folder));
}

/** Build output folders at the repo root that never go into git (the web build, the desktop app's). */
export const BUILD_DIRS = ["dist", "dist-desktop", "release"];

/**
 * Returns the reason a path is rejected, or null when it may be committed. `bytes` is the file's
 * size (checked in the sized image folders; unknown counts as too large there).
 */
export function rejectReason(file, bytes) {
  const p = file.replaceAll("\\", "/");
  if (ALLOW_PREFIXES.some((prefix) => p.startsWith(prefix))) return null;
  const ext = p.split("/").pop().split(".").slice(1).pop()?.toLowerCase();
  for (const { folder, extensions, maxBytes, what } of SIZED_IMAGE_FOLDERS) {
    if (!p.startsWith(folder) || p.slice(folder.length).includes("/")) continue;
    if (ext && extensions.includes(ext)) {
      if (bytes === undefined || bytes > maxBytes) return `${what} over ${formatBytes(maxBytes)}`;
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
    .map((f) => [f, rejectReason(f, needsSize(f) ? stagedBytes(f) : undefined)])
    .filter(([, reason]) => reason);
  if (offenders.length === 0) return 0;
  console.error(`check-binaries: ${offenders.length} file(s) must not be committed:`);
  for (const [f, reason] of offenders) console.error(`  ${f}  (${reason})`);
  console.error("Images, PDFs and exports belong in TATTOO_DATA_DIR (Seafile), not in git.");
  if (!all) console.error("Unstage them with: git restore --staged <file>");
  return 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) process.exit(main());
