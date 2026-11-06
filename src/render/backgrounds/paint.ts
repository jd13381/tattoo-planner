// Background layers in the reference renderer (docs/adr/0019): turns each layer's source into a
// sampler (procedural tile, catalogue or project image, or a line pattern painted in skin cm) and
// composites the visible layers under the motifs. The canvas work (decoding images, the line
// painters) happens here; the pixel maths lives in composite.ts, tile.ts and procedural.ts.
import type { RegionProfile } from "../../body/profile.ts";
import { resolveLayer, visibleLayers } from "../../layout/areas.ts";
import type { BackgroundLayer, Layout } from "../../layout/schema.ts";
import { cpu2d, cpuCanvas } from "../cpuCanvas.ts";
import { getPattern, seedFromId } from "../patterns/index.ts";
import { naturalTileCm, type StandardBackground } from "./catalogue.ts";
import {
  compositeLayer,
  dilateAlpha,
  layerAlpha,
  stripSampler,
  tileSampler,
  type LayerSampler,
  type UnwrapRows,
} from "./composite.ts";
import { isProcedural, proceduralTile } from "./procedural.ts";
import { SEAM_BLEND_CM } from "./seam.ts";
import { downscaleTile, paperToInk, parseHex, type Tile } from "./tile.ts";

/** A decoded image (asset or catalogue), as the reference renderer keeps them. */
export type ReadyImage = { image: CanvasImageSource; width: number; height: number; version: number };

export type BackgroundSources = {
  /** Project images by asset id (only "ready" ones are used). */
  image: (assetId: string) => ReadyImage | null;
  /** Standard backgrounds by name, and their decoded catalogue images. */
  standard: ReadonlyMap<string, StandardBackground>;
  standardImage: (name: string) => ReadyImage | null;
};

export const DEFAULT_INK = "#1d1b19";
const INK_RGB: [number, number, number] = [29, 27, 25];
const DEFAULT_DENSITY = 0.5;
/** Former fillers' density default (docs/claude-decisions.md, Phase 4). */
const LINE_DENSITY = 0.3;

// Small LRU of tiles and strips: moving a motif re-composites without regenerating the patterns.
const LIMIT = 32;
const cache = new Map<string, unknown>();
function cached<T>(key: string, make: () => T): T {
  if (cache.has(key)) {
    const hit = cache.get(key) as T;
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const made = make();
  cache.set(key, made);
  if (cache.size > LIMIT) cache.delete(cache.keys().next().value!);
  return made;
}

function imageTile(key: string, img: ReadyImage, tileCm: number, ppc: number): Tile {
  return cached(`img|${key}|${img.version}|${tileCm}|${ppc}`, () => {
    const c = cpuCanvas(img.width, img.height);
    const ctx = cpu2d(c);
    ctx.drawImage(img.image, 0, 0);
    const d = ctx.getImageData(0, 0, img.width, img.height);
    const tile = paperToInk({ width: img.width, height: img.height, data: d.data });
    // Pre-shrunk to about twice the render resolution, so sampling it does not alias.
    return downscaleTile(tile, img.width / tileCm / (ppc * 2));
  });
}

function procedural(
  name: string,
  layer: BackgroundLayer,
  tileCm: number,
  density: number,
  ink: string | undefined,
  ppc: number,
): Tile | null {
  const tilePpc = Math.min(40, Math.max(16, ppc * 1.5));
  return cached(`proc|${name}|${seedFromId(layer.id)}|${tileCm}|${density}|${ink}|${tilePpc}`, () =>
    proceduralTile(name, {
      density,
      seed: seedFromId(layer.id),
      ink: parseHex(ink, INK_RGB),
      tileCm,
      pxPerCm: tilePpc,
    }),
  );
}

/** A line pattern (former filler patterns) painted over the layer's rows in skin cm, as a strip. */
function lineStrip(
  layer: BackgroundLayer,
  profile: RegionProfile,
  g: UnwrapRows,
  y0: number,
  y1: number,
): LayerSampler {
  const src = layer.source as Extract<BackgroundLayer["source"], { pattern: string }>;
  const ppc = g.pxPerCm;
  const margin = SEAM_BLEND_CM + 0.5;
  // Rows from the top of the area (y1) down to its bottom (y0), in cm from the region's end.
  const top = Math.max(0, profile.length - Math.min(profile.length, y1));
  const bottom = Math.min(profile.length, profile.length - Math.max(0, y0));
  const w = Math.ceil((profile.maxCircumference + 2 * margin) * ppc);
  const h = Math.max(1, Math.ceil((bottom - top) * ppc));
  const strip = cached(
    `strip|${layer.id}|${src.pattern}|${src.density}|${src.scale}|${src.ink}|${ppc}|${w}|${h}|${top}`,
    () => {
      const c = cpuCanvas(w, h);
      const ctx = cpu2d(c);
      getPattern(src.pattern)({
        ctx,
        x: 0,
        y: 0,
        w,
        h,
        pxPerCm: ppc * (src.scale ?? 1),
        density: src.density ?? LINE_DENSITY,
        seed: seedFromId(layer.id),
        ink: src.ink ?? DEFAULT_INK,
      });
      const d = ctx.getImageData(0, 0, w, h);
      return { width: w, height: h, data: d.data };
    },
  );
  return stripSampler(strip, ppc, margin, top);
}

/** The sampler of a layer's source, or why it cannot be drawn. */
export function layerSampler(
  layer: BackgroundLayer,
  profile: RegionProfile,
  g: UnwrapRows,
  sources: BackgroundSources,
  rows: [number, number],
): { sampler: LayerSampler } | { missing: string } {
  const s = layer.source;
  const rot = s.rotation_deg ?? 0;
  const off = s.offset_cm;
  const ppc = g.pxPerCm;
  if ("pattern" in s) {
    if (!isProcedural(s.pattern)) return { sampler: lineStrip(layer, profile, g, rows[0], rows[1]) };
    const tileCm = naturalTileCm(s.pattern) * (s.scale ?? 1);
    const tile = procedural(s.pattern, layer, tileCm, s.density ?? DEFAULT_DENSITY, s.ink, ppc);
    return tile
      ? { sampler: tileSampler(tile, tileCm, rot, off) }
      : { missing: `unknown pattern ${s.pattern}` };
  }
  if ("standard" in s) {
    const info = sources.standard.get(s.standard);
    const tileCm = s.tile_cm ?? info?.tileCm ?? naturalTileCm(s.standard);
    const img = sources.standardImage(s.standard);
    if (img)
      return { sampler: tileSampler(imageTile(`std:${s.standard}`, img, tileCm, ppc), tileCm, rot, off) };
    const name = info?.fallback ?? s.standard;
    const tile = isProcedural(name)
      ? procedural(name, layer, tileCm, s.density ?? DEFAULT_DENSITY, s.ink, ppc)
      : null;
    return tile
      ? { sampler: tileSampler(tile, tileCm, rot, off) }
      : { missing: `unknown standard background ${s.standard}` };
  }
  const img = sources.image(s.image);
  if (!img) return { missing: `${s.image}: image not loaded` };
  return { sampler: tileSampler(imageTile(s.image, img, s.tile_cm, ppc), s.tile_cm, rot, off) };
}

/**
 * Composites the visible background layers into `dst` (RGBA of the unwrap, skin already painted).
 * `knockout` is the motifs' coverage (0..1 per pixel) or null; each layer grows it by its gap.
 * Returns the ids of layers that could not be drawn, with the reason.
 */
export function paintBackgrounds(
  dst: Uint8ClampedArray,
  layout: Layout,
  profile: RegionProfile,
  g: UnwrapRows,
  sources: BackgroundSources,
  knockout: Float32Array | null,
): Map<string, string> {
  const missing = new Map<string, string>();
  const grown = new Map<number, Float32Array | null>();
  for (const layer of visibleLayers(layout)) {
    const r = resolveLayer(layer, profile);
    if (r.shapes !== null && r.y1 < r.y0) continue; // an empty area
    const feather = layer.feather_cm ?? 0;
    const sampler = layerSampler(layer, profile, g, sources, [r.y0 - feather * 2, r.y1 + feather * 2]);
    if ("missing" in sampler) {
      missing.set(layer.id, sampler.missing);
      continue;
    }
    const gapPx = Math.round((layer.gap_cm ?? 0) * g.pxPerCm);
    if (!grown.has(gapPx))
      grown.set(gapPx, knockout && gapPx > 0 ? dilateAlpha(knockout, g, gapPx) : knockout);
    compositeLayer(dst, g, {
      sample: sampler.sampler,
      opacity: layer.opacity ?? 1,
      blend: layer.blend ?? "multiply",
      alpha: layerAlpha(r, g, feather),
      knockout: grown.get(gapPx) ?? null,
    });
  }
  return missing;
}
