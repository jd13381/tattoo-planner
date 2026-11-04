#!/usr/bin/env node
// Asset scripts (PROJECT_BRIEF.md §10.1 F11, §12.3; ADR 0003). Run by Node's type stripping:
//   npm run ingest       split <TATTOO_DATA_DIR>/ideas.pdf into ideas/page-NN-img-MM.(png|jpg) and
//                        ideas/page-NN.txt, and add the images to manifest.yaml
//   npm run assets:scan  add manifest entries for new images in cards/, refs/, existing/, arm-photos/
// Both only add to the manifest; Jan's entries, comments and edits stay as they are.
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseEnv } from "node:util";
import {
  analyseIdeas,
  cleanPageText,
  ideaAsset,
  ideaImageBase,
  ideaTextFile,
} from "../src/assets/ideasLayout.ts";
import { MANIFEST_FILE, type Asset } from "../src/assets/manifest.ts";
import { ManifestError, mergeManifest, type MergeOptions } from "../src/assets/manifestDoc.ts";
import { resolveDataDir } from "../src/data/server/dataDir.ts";
import { scanDataFolder } from "../src/data/server/scanFolder.ts";
import { DATA_DIR_VAR } from "../src/data/types.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
const PDF_FILE = "ideas.pdf";

class UsageError extends Error {}

async function dataDir(): Promise<string> {
  let fromFile: Record<string, string | undefined> = {};
  const envPath = path.join(ROOT, ".env");
  if (existsSync(envPath)) fromFile = parseEnv(await readFile(envPath, "utf8"));
  // Variables set in the shell win over .env, as in vite.config.ts.
  const dir = resolveDataDir({ ...fromFile, ...process.env }, ROOT);
  if (!dir) throw new UsageError(`${DATA_DIR_VAR} is not set (shell or .env); see README.md.`);
  if (!existsSync(dir)) throw new UsageError(`${DATA_DIR_VAR} folder not found: ${dir}`);
  return dir;
}

/** Writes only when the content differs; returns whether it wrote. Atomic via a temp file. */
async function writeIfChanged(file: string, data: string | Uint8Array): Promise<boolean> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  if (existsSync(file) && Buffer.compare(await readFile(file), bytes) === 0) return false;
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  await writeFile(tmp, bytes);
  await rename(tmp, file);
  return true;
}

async function updateManifest(dir: string, incoming: Asset[], opts: MergeOptions): Promise<void> {
  const file = path.join(dir, MANIFEST_FILE);
  const original = existsSync(file) ? await readFile(file, "utf8") : null;
  const result = mergeManifest(original?.trim() ? original : null, incoming, opts);
  if (result.changed) await writeIfChanged(file, result.text);
  const parts = [`${result.added.length} added`, `${result.updated.length} updated`];
  console.log(`${MANIFEST_FILE}: ${parts.join(", ")}${result.changed ? "" : " (unchanged)"}`);
  for (const id of result.added) console.log(`  + ${id}`);
  for (const id of result.updated) console.log(`  ~ ${id}`);
}

async function ingest(dir: string): Promise<void> {
  const pdfPath = path.join(dir, PDF_FILE);
  if (!existsSync(pdfPath)) throw new UsageError(`${PDF_FILE} not found in ${dir}`);
  // Loaded here so that assets:scan does not start the WebAssembly module.
  const { openPdf } = await import("../src/assets/server/pdfExtract.ts");
  const pdf = openPdf(new Uint8Array(await readFile(pdfPath)));
  const pages = Array.from({ length: pdf.pageCount }, (_, i) => pdf.readPage(i + 1));

  let written = 0;
  let texts = 0;
  for (const page of pages) {
    const text = cleanPageText(page.text);
    if (text && (await writeIfChanged(path.join(dir, ideaTextFile(page.page)), text))) texts++;
  }

  const assets: Asset[] = [];
  for (const img of analyseIdeas(pages)) {
    const page = pages[img.page - 1]!;
    const { ext, bytes } = page.encodeImage(img.imageIndex);
    const file = `ideas/${ideaImageBase(img.page, img.number)}.${ext}`;
    if (await writeIfChanged(path.join(dir, file), bytes)) written++;
    assets.push(ideaAsset(img, file, PDF_FILE));
  }
  console.log(
    `${PDF_FILE}: ${pages.length} pages, ${assets.length} images ` +
      `(${written} written, ${assets.length - written} unchanged), ${texts} page text file(s) written`,
  );
  await updateManifest(dir, assets, { refresh: ["page", "bbox"], matchById: true });
}

async function scan(dir: string): Promise<void> {
  const r = await scanDataFolder(dir);
  if (r.truncated) console.warn("warning: the data folder has more files than listed; some may be missed");
  console.log(`scan: ${r.found} image(s) in cards/, refs/, existing/, arm-photos/`);
  for (const f of r.unsupported) console.warn(`  skipped (format the browser cannot show): ${f}`);
  for (const f of r.outside) console.warn(`  not catalogued (outside the scanned folders): ${f}`);
  console.log(`${MANIFEST_FILE}: ${r.added.length} added${r.added.length ? "" : " (unchanged)"}`);
  for (const id of r.added) console.log(`  + ${id}`);
}

const COMMANDS: Record<string, (dir: string) => Promise<void>> = { ingest, scan };

async function main(): Promise<number> {
  const command = COMMANDS[process.argv[2] ?? ""];
  if (!command) {
    console.error("usage: node scripts/assets.ts ingest|scan");
    return 2;
  }
  try {
    await command(await dataDir());
    return 0;
  } catch (e) {
    if (e instanceof UsageError || e instanceof ManifestError) {
      console.error(`error: ${e.message}`);
      if (e instanceof ManifestError)
        console.error(`${MANIFEST_FILE} was left unchanged; fix it and run again.`);
      return 1;
    }
    throw e;
  }
}

process.exitCode = await main();
