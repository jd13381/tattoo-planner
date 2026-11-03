#!/usr/bin/env node
// Pre-commit guard (PROJECT_BRIEF.md §12.5): rejects images, PDFs and exports.
// Default: checks the files staged for commit. `--all` checks every tracked file (used in CI).
// Exit code 1 lists the offending paths; 0 means the commit may proceed.
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

/** File extensions that never go into git, compared case-insensitively. */
export const BLOCKED_EXTENSIONS = [
  "png", "jpg", "jpeg", "webp", "heic", "heif", "gif", "avif", "tif", "tiff", "bmp", "psd", "pdf",
];

/**
 * Explicit exceptions, e.g. UI icons drawn for this repo. Each entry is a path prefix.
 * Adding an entry needs Jan's OK; never add one to get a reference image or export in.
 */
export const ALLOW_PREFIXES = ["public/icons/"];

/** Returns the reason a path is rejected, or null when it may be committed. */
export function rejectReason(file) {
  const p = file.replaceAll("\\", "/");
  if (ALLOW_PREFIXES.some((prefix) => p.startsWith(prefix))) return null;
  if (p === "exports" || p.startsWith("exports/") || p.includes("/exports/")) return "export";
  const ext = p.split("/").pop().split(".").slice(1).pop()?.toLowerCase();
  if (ext && BLOCKED_EXTENSIONS.includes(ext)) return `.${ext} file`;
  return null;
}

function listFiles(all) {
  const args = all
    ? ["ls-files", "-z"]
    : ["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"];
  return execFileSync("git", args, { encoding: "utf8" }).split("\0").filter(Boolean);
}

function main() {
  const all = process.argv.includes("--all");
  const offenders = listFiles(all)
    .map((f) => [f, rejectReason(f)])
    .filter(([, reason]) => reason);
  if (offenders.length === 0) return 0;
  console.error(`check-binaries: ${offenders.length} file(s) must not be committed:`);
  for (const [f, reason] of offenders) console.error(`  ${f}  (${reason})`);
  console.error("Images, PDFs and exports belong in SLEEVE_DATA_DIR (Seafile), not in git.");
  if (!all) console.error("Unstage them with: git restore --staged <file>");
  return 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) process.exit(main());
