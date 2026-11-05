// The sample project (docs/adr/0012-project-folder.md, "Sample project"): samples/demo/ in the app
// folder, opened read-only. Its manifest names PNG files that do not exist; the server draws them on
// request (src/sample/placeholders.ts), and "Save as new project" writes them into the new folder.
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { MANIFEST_FILE } from "../../src/assets/manifest.ts";
import { PROJECT_FILE, PROJECT_FOLDERS, type Body } from "../../src/project/schema.ts";
import { updateProjectText } from "../../src/project/yamlDoc.ts";
import { motifForFile, PLACEHOLDER_SIZE, renderMotif, type MotifId } from "../../src/sample/placeholders.ts";
import { assetPath, parseManifestText } from "../assetsApi.ts";
import { encodePng } from "../png.ts";

/** Where the sample lives inside the app folder (the checkout, or app.asar in the desktop app). */
export const SAMPLE_FOLDER = path.join("samples", "demo");

export const SAMPLE_READ_ONLY =
  "The sample project is read-only. Save it as a new project (Settings → Project) to keep changes.";

const cache = new Map<MotifId, Buffer>();

/** The PNG bytes of a sample placeholder, or null when `file` names no motif. Cached per motif. */
export function placeholderPng(file: string): Buffer | null {
  const motif = motifForFile(file);
  if (!motif) return null;
  let png = cache.get(motif);
  if (!png) {
    png = encodePng(PLACEHOLDER_SIZE, PLACEHOLDER_SIZE, renderMotif(motif));
    cache.set(motif, png);
  }
  return png;
}

/** Files of the sample, relative, forward slashes: only YAML (the images are drawn, never shipped). */
async function sampleFiles(dir: string, rel = ""): Promise<string[]> {
  const out: string[] = [];
  for (const name of (await readdir(path.join(dir, rel))).sort()) {
    if (name.startsWith(".")) continue;
    const sub = rel ? `${rel}/${name}` : name;
    const s = await stat(path.join(dir, sub));
    if (s.isDirectory()) out.push(...(await sampleFiles(dir, sub)));
    else if (s.isFile() && name.endsWith(".yaml")) out.push(sub);
  }
  return out;
}

export type SampleCopy = { files: string[]; images: string[] };

/**
 * Copies the sample into `target` (an existing, empty folder): its YAML files, the standard project
 * folders, and every placeholder as a real PNG at the path its manifest entry names. project.yaml
 * gets the chosen name and body, keeping its comments. Never overwrites a file (flag "wx").
 * Reads with readFile/readdir/stat only, which also work inside the desktop app's app.asar.
 */
export async function copySample(
  sampleDir: string,
  target: string,
  fields: { name: string; body: Body },
): Promise<SampleCopy> {
  const files = await sampleFiles(sampleDir);
  for (const f of PROJECT_FOLDERS) await mkdir(path.join(target, f), { recursive: true });
  for (const rel of files) {
    let text = await readFile(path.join(sampleDir, rel), "utf8");
    if (rel === PROJECT_FILE) text = updateProjectText(text, { name: fields.name, body: fields.body });
    const dest = path.join(target, ...rel.split("/"));
    await mkdir(path.dirname(dest), { recursive: true });
    await writeFile(dest, text, { flag: "wx" });
  }
  const images: string[] = [];
  if (files.includes(MANIFEST_FILE)) {
    const parsed = parseManifestText(await readFile(path.join(sampleDir, MANIFEST_FILE), "utf8"));
    if ("error" in parsed) throw new Error(parsed.error);
    for (const asset of parsed.assets) {
      const png = placeholderPng(asset.file);
      const dest = assetPath(target, asset.file);
      if (!png || !dest.ok) continue;
      await mkdir(path.dirname(dest.path), { recursive: true });
      await writeFile(dest.path, png, { flag: "wx" });
      images.push(asset.file);
    }
  }
  return { files, images };
}
