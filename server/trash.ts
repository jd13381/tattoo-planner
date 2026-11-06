// "Move to Trash" for catalogued images (docs/adr/0020-asset-structure.md).
//
// A delete happens in two steps, so it can be undone for a few seconds:
// 1. stage: the files move into the project's hidden .trash-pending/<token>/ and the entries leave
//    manifest.yaml; pending.json there remembers both manifest texts and the entries.
// 2. commit: the files go to the real trash (the Trasher) and the pending folder is removed. That
//    happens when the page's undo toast closes, after a timeout, on the next request once a pending
//    delete is older than SWEEP_AFTER_MS, or when the server stops.
// Undo moves the files back and restores the manifest (byte for byte when nothing changed since).
//
// The Trasher is injected: the desktop app passes Electron's shell.trashItem; elsewhere macOS gets
// a move into ~/.Trash, and other systems the project's own .trash/<time>-<id>/ folder with an
// entry.yaml describing what was there. No npm dependency.
import { randomBytes } from "node:crypto";
import { copyFile, mkdir, readdir, readFile, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { stringify } from "yaml";
import type { Asset } from "../src/assets/manifest.ts";
import { MANIFEST_FILE } from "../src/assets/manifest.ts";
import { mergeManifest } from "../src/assets/manifestDoc.ts";
import type { TrashMode } from "../src/assets/types.ts";
import { HttpError } from "./http.ts";
import { withManifestLock, writeAtomic } from "./manifestLock.ts";

export const PENDING_FOLDER = ".trash-pending";
export const PROJECT_TRASH_FOLDER = ".trash";
/** A pending delete older than this is made final on the next request (or at start-up). */
export const SWEEP_AFTER_MS = 60_000;
/** The server makes a pending delete final by itself after this (the page's toast is shorter). */
export const COMMIT_AFTER_MS = 20_000;

export type TrashInfo = {
  projectDir: string;
  /** For the project trash folder's name: the first id. */
  label: string;
  entries: Asset[];
  /** The files' paths relative to the project, in `files` order. */
  relative: string[];
};

export type Trasher = {
  mode: TrashMode;
  trash: (files: string[], info: TrashInfo) => Promise<void>;
};

/** Moves a file, also across volumes (copy, then delete). */
export async function moveFile(from: string, to: string): Promise<void> {
  await mkdir(path.dirname(to), { recursive: true });
  try {
    await rename(from, to);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EXDEV") throw e;
    await copyFile(from, to);
    await unlink(from);
  }
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/** `name` or, when taken in `dir`, "name 2.ext", "name 3.ext" … as Finder does. */
export async function freeName(dir: string, name: string): Promise<string> {
  const ext = path.extname(name);
  const stem = name.slice(0, name.length - ext.length);
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? name : `${stem} ${n}${ext}`;
    if (!(await exists(path.join(dir, candidate)))) return path.join(dir, candidate);
  }
}

function stamp(d = new Date()): string {
  return d.toISOString().replace(/[:.]/g, "-");
}

/** The project's own .trash/<time>-<id>/ (with the folder structure and an entry.yaml). */
export const projectTrasher: Trasher = {
  mode: "project",
  trash: async (files, info) => {
    const folder = path.join(info.projectDir, PROJECT_TRASH_FOLDER, `${stamp()}-${info.label}`);
    await mkdir(folder, { recursive: true });
    for (const [i, file] of files.entries()) await moveFile(file, path.join(folder, info.relative[i]!));
    const note =
      "# Images moved to the trash by the Tattoo Planner, with their catalogue entries.\n" +
      "# To restore one, move its file back and press Look for new images in the Assets tab.\n";
    await writeFile(path.join(folder, "entry.yaml"), note + stringify({ assets: info.entries }), "utf8");
  },
};

/** macOS without Electron: a move into ~/.Trash, falling back to the project trash when refused. */
export function macTrasher(home: string): Trasher {
  return {
    mode: "system",
    trash: async (files, info) => {
      const bin = path.join(home, ".Trash");
      const left: number[] = [];
      for (const [i, file] of files.entries()) {
        try {
          await moveFile(file, await freeName(bin, path.basename(file)));
        } catch {
          left.push(i);
        }
      }
      if (left.length)
        await projectTrasher.trash(
          left.map((i) => files[i]!),
          { ...info, relative: left.map((i) => info.relative[i]!) },
        );
    },
  };
}

/** The desktop app: Electron's shell.trashItem (the system Trash with Put Back). */
export function systemTrasher(trashItem: (file: string) => Promise<void>): Trasher {
  return {
    mode: "system",
    trash: async (files) => {
      for (const f of files) await trashItem(f);
    },
  };
}

export function defaultTrasher(platform: NodeJS.Platform = process.platform, home = os.homedir()): Trasher {
  return platform === "darwin" ? macTrasher(home) : projectTrasher;
}

type PendingRecord = {
  token: string;
  createdAt: string;
  /** Paths relative to the project. */
  files: string[];
  entries: Asset[];
  manifestBefore: string;
  manifestAfter: string;
};

const TOKEN = /^[a-z0-9]{8,40}$/;

/** Pending deletes of every project this server touched. */
export class PendingDeletes {
  private readonly trasher: Trasher;
  private readonly projects = new Set<string>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(trasher: Trasher) {
    this.trasher = trasher;
  }

  get mode(): TrashMode {
    return this.trasher.mode;
  }

  private folder(projectDir: string, token: string): string {
    if (!TOKEN.test(token)) throw new HttpError(400, "invalid undo token");
    return path.join(projectDir, PENDING_FOLDER, token);
  }

  /**
   * Moves the files away and writes the new manifest; call under the manifest lock. `files` are
   * relative to the project. Returns the token for undo and commit.
   */
  async stage(
    projectDir: string,
    rec: Omit<PendingRecord, "token" | "createdAt">,
  ): Promise<{ token: string; expiresAt: string }> {
    const token = randomBytes(9).toString("hex");
    const folder = this.folder(projectDir, token);
    await mkdir(path.join(folder, "files"), { recursive: true });
    const record: PendingRecord = { token, createdAt: new Date().toISOString(), ...rec };
    await writeFile(path.join(folder, "pending.json"), JSON.stringify(record, null, 2), "utf8");
    const moved: string[] = [];
    try {
      for (const f of rec.files) {
        await moveFile(path.join(projectDir, f), path.join(folder, "files", f));
        moved.push(f);
      }
      await writeAtomic(path.join(projectDir, MANIFEST_FILE), rec.manifestAfter);
    } catch (e) {
      for (const f of moved) await moveFile(path.join(folder, "files", f), path.join(projectDir, f));
      await rm(folder, { recursive: true, force: true });
      throw e;
    }
    this.projects.add(projectDir);
    const timer = setTimeout(
      () => void this.commit(projectDir, token).catch(() => undefined),
      COMMIT_AFTER_MS,
    );
    timer.unref?.();
    this.timers.set(`${projectDir}\0${token}`, timer);
    return { token, expiresAt: new Date(Date.now() + COMMIT_AFTER_MS).toISOString() };
  }

  private async read(projectDir: string, token: string): Promise<PendingRecord | null> {
    try {
      return JSON.parse(
        await readFile(path.join(this.folder(projectDir, token), "pending.json"), "utf8"),
      ) as PendingRecord;
    } catch (e) {
      if (e instanceof HttpError) throw e;
      return null;
    }
  }

  private forget(projectDir: string, token: string) {
    const key = `${projectDir}\0${token}`;
    const t = this.timers.get(key);
    if (t) clearTimeout(t);
    this.timers.delete(key);
  }

  /** Puts files and entries back. Refused once the delete is final. */
  undo(projectDir: string, token: string): Promise<{ restored: string[] }> {
    return withManifestLock(async () => {
      const rec = await this.read(projectDir, token);
      if (!rec) throw new HttpError(410, "This can no longer be undone; the images are in the Trash.");
      this.forget(projectDir, token);
      const folder = this.folder(projectDir, token);
      for (const f of rec.files) {
        const target = path.join(projectDir, f);
        if (await exists(target)) throw new HttpError(409, `${f} exists again; nothing was restored`);
      }
      for (const f of rec.files) await moveFile(path.join(folder, "files", f), path.join(projectDir, f));
      const manifestPath = path.join(projectDir, MANIFEST_FILE);
      const current = await readFile(manifestPath, "utf8").catch(() => null);
      // Unchanged since the delete: the exact text from before. Otherwise add the entries again.
      const text =
        current === rec.manifestAfter
          ? rec.manifestBefore
          : mergeManifest(current?.trim() ? current : null, rec.entries, { matchById: true }).text;
      await writeAtomic(manifestPath, text);
      await rm(folder, { recursive: true, force: true });
      return { restored: rec.entries.map((e) => e.id) };
    });
  }

  /** Makes a pending delete final: its files go to the trash. Unknown tokens are fine (already done). */
  commit(projectDir: string, token: string): Promise<void> {
    // Under the manifest lock, so an undo and a commit of the same delete never interleave.
    return withManifestLock(() => this.commitNow(projectDir, token));
  }

  private async commitNow(projectDir: string, token: string): Promise<void> {
    const rec = await this.read(projectDir, token);
    this.forget(projectDir, token);
    if (!rec) return;
    const folder = this.folder(projectDir, token);
    // Claim the record first, so a second commit (timer and beacon at once) does nothing.
    try {
      await rename(path.join(folder, "pending.json"), path.join(folder, "committing.json"));
    } catch {
      return;
    }
    const files: string[] = [];
    const relative: string[] = [];
    for (const f of rec.files) {
      const p = path.join(folder, "files", f);
      if (await exists(p)) {
        files.push(p);
        relative.push(f);
      }
    }
    if (files.length)
      await this.trasher.trash(files, {
        projectDir,
        label: rec.entries[0]?.id ?? "image",
        entries: rec.entries,
        relative,
      });
    await rm(folder, { recursive: true, force: true });
  }

  /** Commits every pending delete of the project older than `olderThanMs` (also at start-up). */
  async sweep(projectDir: string, olderThanMs = SWEEP_AFTER_MS): Promise<void> {
    let tokens: string[];
    try {
      tokens = await readdir(path.join(projectDir, PENDING_FOLDER));
    } catch {
      return;
    }
    const now = Date.now();
    for (const token of tokens.filter((t) => TOKEN.test(t))) {
      const rec = await this.read(projectDir, token);
      if (rec && now - Date.parse(rec.createdAt) >= olderThanMs)
        await this.commit(projectDir, token).catch(() => undefined);
    }
  }

  /** Server shutdown: everything pending becomes final. */
  async commitAll(): Promise<void> {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    for (const dir of this.projects) await this.sweep(dir, 0);
  }
}
