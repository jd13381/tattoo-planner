// The in-browser folder picker's listing (GET /api/project/browse): sub-folders of one folder, never
// outside the user's home folder (also not through symlinks), hidden folders left out. A browser page
// cannot learn a real path, so it picks through this; the desktop app uses a native dialog instead.
import { readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import type { BrowseListing, FolderKind } from "../../src/project/schema.ts";
import { isInside } from "../assetsApi.ts";
import { expandUser } from "../dataDir.ts";
import { HttpError } from "../http.ts";
import { inspectFolder } from "./folder.ts";

export const MAX_BROWSE_ENTRIES = 500;

function within(home: string, p: string): boolean {
  return p === home || isInside(home, p);
}

async function kindOf(dir: string): Promise<FolderKind> {
  const state = await inspectFolder(dir);
  return state === "project" || state === "legacy" ? state : "folder";
}

export async function browseFolder(requested: string | undefined, home: string): Promise<BrowseListing> {
  const realHome = await realpath(home);
  const raw = requested?.trim() ? expandUser(requested.trim(), home) : home;
  if (raw.includes("\0") || !path.isAbsolute(raw)) throw new HttpError(400, "the path must be absolute");
  let real: string;
  try {
    real = await realpath(raw);
  } catch {
    throw new HttpError(404, "folder not found");
  }
  if (!within(realHome, real))
    throw new HttpError(403, "only folders inside your home folder can be browsed");
  if (!(await stat(real)).isDirectory()) throw new HttpError(400, "not a folder");

  const entries = await readdir(real, { withFileTypes: true });
  const folders: BrowseListing["folders"] = [];
  let truncated = false;
  let empty = true;
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (e.name.startsWith(".")) continue;
    empty = false;
    const child = path.join(real, e.name);
    if (e.isSymbolicLink()) {
      // A link is listed only when it leads to a folder that is still inside the home folder.
      try {
        const target = await realpath(child);
        if (!within(realHome, target) || !(await stat(target)).isDirectory()) continue;
      } catch {
        continue;
      }
    } else if (!e.isDirectory()) continue;
    if (folders.length >= MAX_BROWSE_ENTRIES) {
      truncated = true;
      break;
    }
    folders.push({ name: e.name, path: child, kind: await kindOf(child) });
  }
  return {
    path: real,
    home: realHome,
    parent: real === realHome ? null : path.dirname(real),
    kind: await kindOf(real),
    empty,
    folders,
    truncated,
  };
}
