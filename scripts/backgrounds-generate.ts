#!/usr/bin/env node
// Standard backgrounds (docs/adr/0019). Run by Node's type stripping:
//   npm run backgrounds:generate                 every entry of assets/backgrounds/backgrounds.yaml without a file
//   npm run backgrounds:generate -- clouds stars only these (replacing their files)
//   npm run backgrounds:generate -- --force      every entry, replacing existing files
// Sends each entry's fixed prompt to GPT Image (TATTOO_OPENAI_API_KEY from the shell or .env, the same
// engine as the Image studio), makes the result seamless, writes <name>.png (≤ 1024 px, ≤ 2 MB) and
// sets file / generated / licence in the catalogue. Commit the PNGs: they are the one image
// exception in git (CLAUDE.md, Jan, 2026-11-06). Each image is one paid API request.
import path from "node:path";
import { generateStandardBackgrounds } from "../server/backgrounds.ts";
import { readEnv } from "../server/context.ts";
import { openaiSettingsFromEnv } from "../src/edits/openai.ts";
import { STANDARD_FOLDER } from "../src/render/backgrounds/catalogue.ts";

const ROOT = path.resolve(import.meta.dirname, "..");

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const names = args.filter((a) => !a.startsWith("--"));
  const settings = openaiSettingsFromEnv(readEnv(ROOT));
  if (!settings) {
    console.error("error: no OpenAI key; set TATTOO_OPENAI_API_KEY in the shell or in .env (see README.md).");
    return 1;
  }
  try {
    const r = await generateStandardBackgrounds({
      folder: path.join(ROOT, STANDARD_FOLDER),
      settings,
      ...(names.length ? { names } : {}),
      force,
      log: (line) => console.log(line),
    });
    console.log(
      `${r.written.length} written, ${r.skipped.length} skipped, ${r.failed.length} failed` +
        (r.written.length ? `; review the tiles, then commit ${STANDARD_FOLDER}/` : ""),
    );
    return r.failed.length ? 1 : 0;
  } catch (e) {
    console.error(`error: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
}

process.exitCode = await main();
