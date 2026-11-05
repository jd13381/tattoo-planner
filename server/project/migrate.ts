// Moves the app's old config (layouts, projections, measurements in the checkout's config/) into a
// project folder (docs/adr/0012-project-folder.md). Copies only, never overwrites, and writes
// project.yaml when it is missing. Used by "Move into project" and `npm run migrate -- <folder>`.
import { constants } from "node:fs";
import { copyFile, mkdir, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { PROJECT_FILE, type Body, type MigrationReport } from "../../src/project/schema.ts";
import { newProjectText } from "../../src/project/yamlDoc.ts";

export const MEASUREMENTS_FILE = "measurements.yaml";

/** The config sub-folders that move into the project under the same name. */
const FOLDERS = ["layouts", "projections"] as const;

async function yamlFiles(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir, { withFileTypes: true }))
      .filter((e) => e.isFile() && e.name.endsWith(".yaml"))
      .map((e) => e.name)
      .sort();
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
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

/** Whether the old config holds anything to move. */
export async function hasLegacyConfig(configDir: string | null): Promise<boolean> {
  if (!configDir) return false;
  if (await exists(path.join(configDir, MEASUREMENTS_FILE))) return true;
  for (const f of FOLDERS) if ((await yamlFiles(path.join(configDir, f))).length > 0) return true;
  return false;
}

export type MigrateOptions = {
  /** The checkout's config/ folder; null copies nothing and only writes project.yaml. */
  configDir: string | null;
  /** For a new project.yaml; default: the folder's name and the male body (Jan's sleeve). */
  name?: string;
  body?: Body;
};

export async function migrateFolder(dir: string, opts: MigrateOptions): Promise<MigrationReport> {
  if (!(await stat(dir)).isDirectory()) throw new Error(`not a folder: ${dir}`);
  const copied: string[] = [];
  const skipped: string[] = [];
  const copy = async (from: string, rel: string) => {
    const to = path.join(dir, ...rel.split("/"));
    await mkdir(path.dirname(to), { recursive: true });
    try {
      // COPYFILE_EXCL: fails instead of replacing a file that is already there.
      await copyFile(from, to, constants.COPYFILE_EXCL);
      copied.push(rel);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      skipped.push(rel);
    }
  };
  if (opts.configDir) {
    for (const folder of FOLDERS) {
      for (const f of await yamlFiles(path.join(opts.configDir, folder)))
        await copy(path.join(opts.configDir, folder, f), `${folder}/${f}`);
    }
    const measurements = path.join(opts.configDir, MEASUREMENTS_FILE);
    if (await exists(measurements)) await copy(measurements, MEASUREMENTS_FILE);
  }
  for (const folder of FOLDERS) await mkdir(path.join(dir, folder), { recursive: true });
  let projectFile: MigrationReport["projectFile"] = "kept";
  const text = newProjectText({
    name: opts.name ?? path.basename(path.resolve(dir)),
    body: opts.body ?? "male",
  });
  try {
    await writeFile(path.join(dir, PROJECT_FILE), text, { flag: "wx" });
    projectFile = "created";
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
  }
  return { projectFile, copied, skipped };
}

/** One line per file, for the command line and the project screen. */
export function migrationSummary(r: MigrationReport): string[] {
  return [
    `${PROJECT_FILE}: ${r.projectFile === "created" ? "created" : "already there, kept"}`,
    ...r.copied.map((f) => `copied ${f}`),
    ...r.skipped.map((f) => `kept ${f} (already in the project, not overwritten)`),
  ];
}
