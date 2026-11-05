// The user's planner config: which project is open and the recent ones (docs/adr/0012-project-folder.md).
// ~/.config/tattoo-planner/config.json, or $XDG_CONFIG_HOME/tattoo-planner/config.json. Unknown keys
// are kept, so a newer app can add settings without an older one dropping them.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export const MAX_RECENT = 8;

export type UserConfig = { project: string | null; recent: string[]; [key: string]: unknown };

export function userConfigFile(env: Record<string, string | undefined>, home: string): string {
  const xdg = env.XDG_CONFIG_HOME?.trim();
  const base = xdg && path.isAbsolute(xdg) ? xdg : path.join(home, ".config");
  return path.join(base, "tattoo-planner", "config.json");
}

/** A missing or broken file reads as an empty config (it is rewritten on the next change). */
export async function readUserConfig(file: string): Promise<UserConfig> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(file, "utf8"));
  } catch {
    return { project: null, recent: [] };
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { project: null, recent: [] };
  const obj = raw as Record<string, unknown>;
  const project = typeof obj.project === "string" && path.isAbsolute(obj.project) ? obj.project : null;
  const recent = Array.isArray(obj.recent)
    ? obj.recent.filter((p): p is string => typeof p === "string" && path.isAbsolute(p)).slice(0, MAX_RECENT)
    : [];
  return { ...obj, project, recent };
}

export async function writeUserConfig(file: string, config: UserConfig): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  await writeFile(tmp, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  await rename(tmp, file);
}

/** Puts a folder first in the recent list (no duplicates, at most MAX_RECENT). */
export function addRecent(recent: string[], dir: string): string[] {
  return [dir, ...recent.filter((p) => p !== dir)].slice(0, MAX_RECENT);
}
