// What a folder on disk is, as far as projects go (docs/adr/0012-project-folder.md).
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { MANIFEST_FILE } from "../../src/assets/manifest.ts";
import { PROJECT_FILE, type ProjectMeta } from "../../src/project/schema.ts";
import { parseProjectText } from "../../src/project/yamlDoc.ts";

/**
 * - project: has project.yaml
 * - legacy: an old data folder (manifest.yaml, no project.yaml)
 * - empty: a folder with nothing but hidden files (.DS_Store …)
 * - other: a folder with other content
 * - file / missing: not a folder
 */
export type FolderState = "project" | "legacy" | "empty" | "other" | "file" | "missing";

async function isFile(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isFile();
  } catch {
    return false;
  }
}

export async function inspectFolder(dir: string): Promise<FolderState> {
  try {
    if (!(await stat(dir)).isDirectory()) return "file";
  } catch {
    return "missing";
  }
  if (await isFile(path.join(dir, PROJECT_FILE))) return "project";
  if (await isFile(path.join(dir, MANIFEST_FILE))) return "legacy";
  const entries = await readdir(dir);
  return entries.some((e) => !e.startsWith(".")) ? "other" : "empty";
}

export type ReadProject = { ok: true; project: ProjectMeta } | { ok: false; error: string };

export async function readProjectFile(dir: string): Promise<ReadProject> {
  let text: string;
  try {
    text = await readFile(path.join(dir, PROJECT_FILE), "utf8");
  } catch (e) {
    return {
      ok: false,
      error: `cannot read ${PROJECT_FILE}: ${(e as NodeJS.ErrnoException).code ?? String(e)}`,
    };
  }
  return parseProjectText(text);
}
