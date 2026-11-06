// Moves a folder out of the project without destroying it (docs/adr/0017-persons.md): deleting a
// person puts its folder into the system trash, where the user can restore it.
// - macOS: ~/.Trash (a rename, so only on the same volume).
// - Linux and other freedesktop systems: ~/.local/share/Trash (files/ + info/<name>.trashinfo).
// - Anywhere that fails (another volume, Windows, no trash folder): <project>/.trash/, hidden from
//   the planner's scans but still in the project folder.
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export type TrashOptions = {
  home: string;
  /** The project: the fallback trash is <projectDir>/.trash. */
  projectDir: string;
  platform?: NodeJS.Platform;
  /** For tests. */
  now?: Date;
};

/** A name that does not clash with what is in the trash: "xenia 2026-11-06 14.03.12". */
function stampedName(base: string, now: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}.${pad(now.getMinutes())}.${pad(now.getSeconds())}`;
  return `${base} ${date} ${time}`;
}

async function tryRename(from: string, to: string): Promise<boolean> {
  try {
    await mkdir(path.dirname(to), { recursive: true });
    await rename(from, to);
    return true;
  } catch {
    return false;
  }
}

/**
 * Moves `dir` to the trash and returns where it went. `label` names it there (e.g. "xenia (Tattoo
 * Planner)"). Throws only when even the project's own .trash folder cannot take it.
 */
export async function moveToTrash(dir: string, label: string, opts: TrashOptions): Promise<string> {
  const now = opts.now ?? new Date();
  const name = stampedName(label.replace(/[/\\\0]/g, "-"), now);
  const platform = opts.platform ?? process.platform;
  if (platform === "darwin") {
    const to = path.join(opts.home, ".Trash", name);
    if (await tryRename(dir, to)) return to;
  } else if (platform !== "win32") {
    const trash = path.join(opts.home, ".local", "share", "Trash");
    const to = path.join(trash, "files", name);
    if (await tryRename(dir, to)) {
      const info = [
        "[Trash Info]",
        `Path=${encodeURI(dir)}`,
        `DeletionDate=${now.toISOString().slice(0, 19)}`,
        "",
      ].join("\n");
      await mkdir(path.join(trash, "info"), { recursive: true });
      await writeFile(path.join(trash, "info", `${name}.trashinfo`), info).catch(() => undefined);
      return to;
    }
  }
  const to = path.join(opts.projectDir, ".trash", name);
  await mkdir(path.dirname(to), { recursive: true });
  await rename(dir, to);
  return to;
}
