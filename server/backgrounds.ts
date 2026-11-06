// Seamless background tiles from GPT Image (docs/adr/0019): the seam fix on a returned PNG, and the
// generator behind `npm run backgrounds:generate`, which fills assets/backgrounds/ from the fixed
// prompts in its catalogue. The pixel work is framework-free (src/render/backgrounds/seam.ts).
import { existsSync } from "node:fs";
import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { stringify } from "yaml";
import { BACKGROUND_SIZE, buildBackgroundPrompt } from "../src/edits/background.ts";
import {
  buildGenerationBody,
  OPENAI_GENERATIONS_URL,
  parseEditResponse,
  type OpenAISettings,
} from "../src/edits/openai.ts";
import {
  CATALOGUE_NAME,
  GENERATED_LICENCE,
  parseCatalogue,
  type CatalogueEntry,
} from "../src/render/backgrounds/catalogue.ts";
import { makeSeamless } from "../src/render/backgrounds/seam.ts";
import { downscaleTile, type Tile } from "../src/render/backgrounds/tile.ts";
import { decodePng, encodeGreyPng, encodePng } from "./png.ts";

/** Longest side of a stored tile, in pixels (a 14 cm tile then has ~70 px/cm, more than the planner draws). */
export const MAX_TILE_PX = 1024;
/** Size cap of one committed tile (the pre-commit guard checks the same). */
export const MAX_TILE_BYTES = 2 * 1024 * 1024;

/**
 * Makes a PNG tile seamless (offset-and-blend), scales it down to at most `maxPx` and encodes it,
 * greyscale when it has no colour or alpha, halving the size again while it is over `maxBytes`.
 */
export function seamlessPng(
  bytes: Uint8Array,
  { maxPx = MAX_TILE_PX, maxBytes = MAX_TILE_BYTES }: { maxPx?: number; maxBytes?: number } = {},
): { png: Buffer; width: number; height: number } {
  const img = decodePng(bytes);
  let tile: Tile = makeSeamless({
    width: img.width,
    height: img.height,
    data: new Uint8ClampedArray(img.rgba.buffer, img.rgba.byteOffset, img.rgba.byteLength),
  });
  const first = Math.ceil(Math.max(tile.width, tile.height) / maxPx);
  if (first > 1) tile = downscaleTile(tile, first);
  for (;;) {
    const png = encodeTile(tile);
    if (png.length <= maxBytes || Math.min(tile.width, tile.height) < 64)
      return { png, width: tile.width, height: tile.height };
    tile = downscaleTile(tile, 2);
  }
}

function encodeTile(t: Tile): Buffer {
  const n = t.width * t.height;
  const d = t.data;
  let grey = true;
  for (let k = 0; k < n && grey; k++)
    grey =
      d[k * 4 + 3] === 255 &&
      Math.abs(d[k * 4]! - d[k * 4 + 1]!) <= 2 &&
      Math.abs(d[k * 4 + 1]! - d[k * 4 + 2]!) <= 2;
  if (!grey) return encodePng(t.width, t.height, new Uint8Array(d.buffer, d.byteOffset, d.byteLength));
  const g = new Uint8Array(n);
  for (let k = 0; k < n; k++) g[k] = Math.round((d[k * 4]! + d[k * 4 + 1]! + d[k * 4 + 2]!) / 3);
  return encodeGreyPng(t.width, t.height, g);
}

export type GenerateOptions = {
  /** The folder with backgrounds.yaml; the PNGs are written next to it. */
  folder: string;
  settings: OpenAISettings;
  /** Only these entries (default: every entry without a file, or all with `force`). */
  names?: readonly string[];
  /** Regenerate entries that already have a file. */
  force?: boolean;
  fetchImpl?: typeof fetch;
  log?: (line: string) => void;
  /** The date written to `generated` (tests pass a fixed one). */
  today?: string;
};

export type GenerateResult = {
  written: string[];
  skipped: string[];
  failed: { name: string; error: string }[];
};

/**
 * Sends each chosen catalogue prompt to GPT Image, makes the result seamless, writes <name>.png and
 * sets `file`, `generated` and `licence` on the entry (the rest of the YAML, comments included, stays).
 */
export async function generateStandardBackgrounds(o: GenerateOptions): Promise<GenerateResult> {
  const doFetch = o.fetchImpl ?? fetch;
  const log = o.log ?? (() => {});
  const catalogueFile = path.join(o.folder, CATALOGUE_NAME);
  const text = await readFile(catalogueFile, "utf8");
  const parsed = parseCatalogue(text);
  if (!parsed.ok) throw new Error(`${CATALOGUE_NAME}: ${parsed.error}`);
  const unknown = (o.names ?? []).filter((n) => !parsed.catalogue.backgrounds.some((e) => e.name === n));
  if (unknown.length) throw new Error(`not in ${CATALOGUE_NAME}: ${unknown.join(", ")}`);
  const updates = new Map<string, Record<string, string>>();
  const result: GenerateResult = { written: [], skipped: [], failed: [] };
  const today = o.today ?? new Date().toISOString().slice(0, 10);

  for (const entry of parsed.catalogue.backgrounds) {
    const chosen = o.names ? o.names.includes(entry.name) : true;
    const has = !!entry.file && existsSync(path.join(o.folder, entry.file));
    if (!chosen || (has && !o.force && !o.names)) {
      if (chosen) log(`${entry.name}: has ${entry.file} (use --force to replace it)`);
      result.skipped.push(entry.name);
      continue;
    }
    log(`${entry.name}: asking ${o.settings.model}…`);
    try {
      const png = await generateOne(entry, o.settings, doFetch);
      const file = `${entry.name}.png`;
      const tmp = path.join(o.folder, `.${file}.tmp`);
      await writeFile(tmp, png.png);
      await rename(tmp, path.join(o.folder, file));
      updates.set(entry.name, {
        file,
        generated: `${o.settings.model}, ${today}`,
        licence: GENERATED_LICENCE,
      });
      result.written.push(file);
      log(
        `${entry.name}: wrote ${file} (${png.width} × ${png.height} px, ${Math.round(png.png.length / 1024)} KB)`,
      );
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      result.failed.push({ name: entry.name, error });
      log(`${entry.name}: failed: ${error}`);
    }
  }
  if (result.written.length) {
    const tmp = `${catalogueFile}.tmp`;
    const next = setEntryKeys(text, updates);
    if (!parseCatalogue(next).ok)
      throw new Error(`could not update ${CATALOGUE_NAME}; the images were written`);
    await writeFile(tmp, next, "utf8");
    await rename(tmp, catalogueFile);
  }
  return result;
}

const GENERATED_KEYS = ["file", "generated", "licence"];

/**
 * Sets the generated keys on catalogue entries by editing lines, so the folded prompts, comments and
 * key order stay byte for byte (a YAML round trip would re-fold them). The keys go before `prompt:`.
 */
export function setEntryKeys(text: string, updates: ReadonlyMap<string, Record<string, string>>): string {
  const out: string[] = [];
  let current: Record<string, string> | undefined;
  for (const line of text.split("\n")) {
    const start = /^ {2}- name: (\S+)\s*$/.exec(line);
    if (start) current = updates.get(start[1]!);
    else if (/^\S/.test(line) || /^ {2}- /.test(line)) current = undefined;
    if (current) {
      const key = /^ {4}([a-z_]+):/.exec(line)?.[1];
      if (key && GENERATED_KEYS.includes(key)) continue;
      if (key === "prompt")
        for (const k of GENERATED_KEYS)
          if (current[k] !== undefined) out.push(`    ${k}: ${stringify(current[k]).trimEnd()}`);
    }
    out.push(line);
  }
  return out.join("\n");
}

async function generateOne(entry: CatalogueEntry, settings: OpenAISettings, doFetch: typeof fetch) {
  const r = await doFetch(OPENAI_GENERATIONS_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${settings.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(
      buildGenerationBody({
        prompt: buildBackgroundPrompt(entry.prompt),
        settings,
        size: BACKGROUND_SIZE,
        background: "opaque",
      }),
    ),
  });
  const answer = parseEditResponse(r.status, await r.json().catch(() => ({})));
  if (!answer.ok) throw new Error(answer.message);
  return seamlessPng(answer.png);
}
