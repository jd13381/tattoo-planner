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

/**
 * The person last shown per project (docs/adr/0017-persons.md): `currentPerson` maps a project's
 * path to a person id. Kept here, not in project.yaml, because it is this computer's view, and a
 * project folder shared between two people (or synced) should not flip between them.
 */
export function rememberedPerson(config: UserConfig, dir: string): string | null {
  const map = config.currentPerson;
  if (typeof map !== "object" || map === null || Array.isArray(map)) return null;
  const id = (map as Record<string, unknown>)[dir];
  return typeof id === "string" ? id : null;
}

export function withRememberedPerson(config: UserConfig, dir: string, id: string | null): UserConfig {
  const old = config.currentPerson;
  const entries =
    typeof old === "object" && old !== null && !Array.isArray(old) ? Object.entries(old) : [];
  const kept = entries.filter(([k]) => k !== dir);
  return { ...config, currentPerson: Object.fromEntries(id === null ? kept : [...kept, [dir, id]]) };
}
