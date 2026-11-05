#!/usr/bin/env node
// Moves the checkout's config/ (layouts, projections, measurements) into a project folder
// (docs/adr/0012-project-folder.md): `npm run migrate -- <folder>`, default TATTOO_DATA_DIR.
// Copies only, never overwrites, writes project.yaml when it is missing, and prints what it did.
// "Move into project" in Settings → Project does the same.
import { existsSync } from "node:fs";
import path from "node:path";
import { readEnv } from "../server/context.ts";
import { resolveDataDir } from "../server/dataDir.ts";
import { inspectFolder } from "../server/project/folder.ts";
import { migrateFolder, migrationSummary } from "../server/project/migrate.ts";

const ROOT = path.resolve(import.meta.dirname, "..");

async function main(): Promise<number> {
  const env = readEnv(ROOT);
  const arg = process.argv[2];
  const dir = arg ? resolveDataDir({ TATTOO_DATA_DIR: arg }, process.cwd()) : resolveDataDir(env, ROOT);
  if (!dir) {
    console.error("usage: npm run migrate -- <project folder>   (default: TATTOO_DATA_DIR)");
    return 2;
  }
  const state = await inspectFolder(dir);
  if (state === "missing" || state === "file") {
    console.error(`error: not a folder: ${dir}`);
    return 1;
  }
  if (state === "other") {
    console.error(`error: ${dir} has other files but no manifest.yaml or project.yaml; refusing to mix.`);
    return 1;
  }
  const configDir = path.join(ROOT, "config");
  const report = await migrateFolder(dir, { configDir: existsSync(configDir) ? configDir : null });
  console.log(`project: ${dir}`);
  for (const line of migrationSummary(report)) console.log(`  ${line}`);
  if (report.copied.length === 0 && report.skipped.length === 0)
    console.log("  (nothing to copy from config/)");
  console.log("The planner now reads layouts, projections and measurements from this folder.");
  return 0;
}

process.exitCode = await main();
