// Resolves and lists the data folder (TATTOO_DATA_DIR). Same rules as Job Radar's data folder:
// the shell environment wins over .env, `~` expands to the home folder, relative paths resolve
// against the repo root. Nothing here ever writes into the data folder.
import { readdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DATA_DIR_VAR, type DataFile, type DataListing } from "../src/data/types.ts";

export function expandUser(p: string, home = os.homedir()): string {
  if (p === "~") return home;
  if (p.startsWith("~/")) return path.join(home, p.slice(2));
  return p;
}

/** Returns the absolute data folder path, or null when the variable is unset or empty. */
export function resolveDataDir(
  env: Record<string, string | undefined>,
  root: string,
  home?: string,
): string | null {
  const raw = env[DATA_DIR_VAR]?.trim();
  if (!raw) return null;
  return path.resolve(root, expandUser(raw, home));
}

export type ListOptions = { maxFiles?: number; maxDepth?: number };

/**
 * Lists the files in the data folder recursively, sorted by path.
 * Skips dot files and folders (.DS_Store, .seafile-data) and follows no symlinks.
 */
export async function listDataFiles(dir: string, opts: ListOptions = {}): Promise<DataListing> {
  const maxFiles = opts.maxFiles ?? 2000;
  const maxDepth = opts.maxDepth ?? 6;
  try {
    const info = await stat(dir);
    if (!info.isDirectory()) return { status: "error", dir, message: "not a folder" };
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    return { status: "error", dir, message: code === "ENOENT" ? "folder not found" : String(code ?? e) };
  }

  const files: DataFile[] = [];
  let truncated = false;
  async function walk(rel: string, depth: number): Promise<void> {
    const entries = await readdir(path.join(dir, rel), { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (depth < maxDepth) await walk(childRel, depth + 1);
      } else if (entry.isFile()) {
        if (files.length >= maxFiles) {
          truncated = true;
          return;
        }
        const s = await stat(path.join(dir, childRel));
        files.push({ path: childRel, size: s.size, modified: s.mtime.toISOString() });
      }
    }
  }
  await walk("", 0);
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { status: "ok", dir, files, truncated };
}
