#!/usr/bin/env node
// Asset script (PROJECT_BRIEF.md §12.3; ADR 0003). Run by Node's type stripping:
//   npm run assets:scan  add manifest entries for new images in cards/, refs/, existing/, arm-photos/
// It only adds to the manifest; Jan's entries, comments and edits stay as they are. The Reload button
// in the planner runs the same scan. (The ideas.pdf ingestion was removed, see roadmap §3.)
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseEnv } from "node:util";
import { MANIFEST_FILE } from "../src/assets/manifest.ts";
import { ManifestError } from "../src/assets/manifestDoc.ts";
import { resolveDataDir } from "../server/dataDir.ts";
import { scanDataFolder } from "../server/scanFolder.ts";
import { DATA_DIR_VAR } from "../src/data/types.ts";

const ROOT = path.resolve(import.meta.dirname, "..");

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

async function scan(dir: string): Promise<void> {
  const r = await scanDataFolder(dir);
  if (r.truncated) console.warn("warning: the data folder has more files than listed; some may be missed");
  console.log(`scan: ${r.found} image(s) in cards/, refs/, existing/, arm-photos/`);
  for (const f of r.unsupported) console.warn(`  skipped (format the browser cannot show): ${f}`);
  for (const f of r.outside) console.warn(`  not catalogued (outside the scanned folders): ${f}`);
  console.log(`${MANIFEST_FILE}: ${r.added.length} added${r.added.length ? "" : " (unchanged)"}`);
  for (const id of r.added) console.log(`  + ${id}`);
}

const COMMANDS: Record<string, (dir: string) => Promise<void>> = { scan };

async function main(): Promise<number> {
  const command = COMMANDS[process.argv[2] ?? ""];
  if (!command) {
    console.error("usage: node scripts/assets.ts scan");
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
