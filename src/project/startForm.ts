// Framework-free helpers for the start screen, the new-project form and the folder picker
// (src/project/StartScreen.tsx, FolderPicker.tsx): short paths, what the form still needs, the
// default location and a clash with a folder that is already there.
import { folderNameFor } from "./folders.ts";
import type { BrowseListing, FolderKind } from "./schema.ts";

/** The suggested name of a new project. */
export const DEFAULT_PROJECT_NAME = "My tattoo";

/**
 * A path for display: the home folder becomes "~". Without a known home, the usual home roots of
 * macOS and Linux (/Users/<name>, /home/<name>) are shortened.
 */
export function shortPath(p: string, home?: string | null): string {
  const clean = p.length > 1 ? p.replace(/\/+$/, "") : p;
  if (home) {
    const h = home.replace(/\/+$/, "");
    if (clean === h) return "~";
    if (clean.startsWith(`${h}/`)) return `~${clean.slice(h.length)}`;
    return clean;
  }
  return clean.replace(/^\/(?:Users|home)\/[^/]+(?=\/|$)/, "~");
}

/** The folder that holds `p`, for the second line of a recent project. */
export function parentPath(p: string): string {
  const clean = p.replace(/\/+$/, "");
  const i = clean.lastIndexOf("/");
  return i <= 0 ? "/" : clean.slice(0, i);
}

export type NewProjectInput = {
  name: string;
  body: string | null;
  location: string | null;
  /** A folder named like the new one that is a project already blocks creating. */
  clash?: FolderClash | null;
};

/** What the new-project form still needs before it can create, in plain words; null when ready. */
export function missingForCreate(f: NewProjectInput): string | null {
  const missing: string[] = [];
  if (!f.name.trim()) missing.push("a name");
  if (!f.body) missing.push("a body");
  if (!f.location) missing.push("a location");
  if (missing.length > 0) {
    const list =
      missing.length === 1
        ? missing[0]
        : `${missing.slice(0, -1).join(", ")} and ${missing[missing.length - 1]}`;
    return `Add ${list} to continue.`;
  }
  if (f.clash?.blocking) return f.clash.message;
  return null;
}

/** Where a new project goes by default: Documents in the home folder when there is one, else home. */
export function defaultLocation(home: Pick<BrowseListing, "path" | "folders">): string {
  const docs = home.folders.find((f) => f.name === "Documents" && f.kind === "folder");
  return docs ? docs.path : home.path;
}

export type FolderClash = { blocking: boolean; message: string };

/**
 * Whether the new project's folder name is taken in the listed location. A project there blocks
 * (the server refuses it); another folder is only a warning, because an empty one is fine.
 */
export function folderClash(
  listing: Pick<BrowseListing, "folders"> | null,
  folderName: string,
): FolderClash | null {
  const n = folderNameFor(folderName);
  if (!listing || !n) return null;
  const hit = listing.folders.find((f) => f.name.toLowerCase() === n.toLowerCase());
  if (!hit) return null;
  const kinds: Record<FolderKind, FolderClash> = {
    project: { blocking: true, message: `“${hit.name}” is a project already. Choose another name.` },
    legacy: {
      blocking: false,
      message: `“${hit.name}” is an older planner folder; it will be moved into the new project.`,
    },
    folder: {
      blocking: false,
      message: `A folder “${hit.name}” is already there. It can only be used if it is empty.`,
    },
  };
  return kinds[hit.kind];
}
