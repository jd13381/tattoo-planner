// Compositing background layers into the unwrap texture (docs/adr/0019), on plain pixel buffers so
// it is tested without a canvas. The texture is the "vase" unwrap (docs/adr/0002): row j (0 = the
// region's end) holds the skin of one ring, as wide as its circumference, centred on `centerU`.
//
// Per layer: coverage alpha (whole region, or the area with its feathered edge) × opacity × the
// source's own alpha × (1 − knockout), where the knockout is the motifs on top, grown by the layer's
// gap. Sources are sampled in skin cm: s around the ring from the seam line u = SEAM_U (growing in the
// screen direction), y down from the region's end, so a pattern stays put on the skin whichever line
// the editor centres, and the cross-fade at the seam closes every ring.
import type { RegionProfile } from "../../body/profile.ts";
import { screenSign, wrapU } from "../../body/uv.ts";
import { layerCovers, strokeYRange, areaYRange, type ResolvedLayer } from "../../layout/areas.ts";
import type { BlendMode } from "../../layout/schema.ts";
import { seamCrossfade } from "./seam.ts";
import { sampleTile, type Tile } from "./tile.ts";

/** The line the background pattern starts from and closes on (the texture seam on arms). */
export const SEAM_U = 0.5;

/** Row geometry of an unwrap image. */
export type UnwrapRows = {
  width: number;
  height: number;
  pxPerCm: number;
  centerU: number;
  sign: 1 | -1;
  length: number;
  maxCircumference: number;
  /** Per row: y in cm from the region's start, circumference, first and last skin pixel. */
  y: Float64Array;
  c: Float64Array;
  i0: Int32Array;
  i1: Int32Array;
};

export function unwrapRows(profile: RegionProfile, pxPerCm: number, centerU = 0): UnwrapRows {
  const width = Math.ceil(profile.maxCircumference * pxPerCm);
  const height = Math.ceil(profile.length * pxPerCm);
  const y = new Float64Array(height);
  const c = new Float64Array(height);
  const i0 = new Int32Array(height);
  const i1 = new Int32Array(height);
  for (let j = 0; j < height; j++) {
    y[j] = profile.length - (j + 0.5) / pxPerCm;
    c[j] = profile.circumferenceAt(y[j]!);
    // Pixel centres with |sx| ≤ c / 2 are skin (as in classify()).
    const half = c[j]! / 2;
    i0[j] = Math.max(0, Math.ceil((profile.maxCircumference / 2 - half) * pxPerCm - 0.5));
    i1[j] = Math.min(width - 1, Math.floor((profile.maxCircumference / 2 + half) * pxPerCm - 0.5));
  }
  return {
    width,
    height,
    pxPerCm,
    centerU,
    sign: screenSign(profile),
    length: profile.length,
    maxCircumference: profile.maxCircumference,
    y,
    c,
    i0,
    i1,
  };
}

/** u of pixel i in row j. */
export function pixelU(g: UnwrapRows, j: number, i: number): number {
  const sx = (i + 0.5) / g.pxPerCm - g.maxCircumference / 2;
  return wrapU(g.centerU + (g.sign * sx) / g.c[j]!);
}

/** Pattern coordinate around the ring: cm from the seam line in the screen direction, 0 ≤ s < c. */
export function patternS(g: UnwrapRows, u: number, c: number): number {
  return wrapU(-g.sign * (SEAM_U - u)) * c;
}

/**
 * Coverage of a layer (0..1 per pixel), or null for the whole region. The hard-edged area is
 * blurred by the feather radius, so the edge fades over about 2 × feather.
 */
export function layerAlpha(r: ResolvedLayer, g: UnwrapRows, featherCm = 0): Float32Array | null {
  if (r.shapes === null) return null;
  const a = new Float32Array(g.width * g.height);
  const pad = featherCm * 2;
  for (let j = 0; j < g.height; j++) {
    const y = g.y[j]!;
    if (y < r.y0 - pad || y > r.y1 + pad) continue;
    // Only the shapes and strokes that reach this row.
    const row: ResolvedLayer = {
      ...r,
      shapes: r.shapes.filter((s) => {
        const [lo, hi] = areaYRange(s);
        return y >= lo && y <= hi;
      }),
      strokes: r.strokes.filter((s) => {
        const [lo, hi] = strokeYRange(s);
        return y >= lo && y <= hi;
      }),
    };
    if (row.shapes!.length === 0 && !row.strokes.some((s) => !s.erase)) continue;
    const c = g.c[j]!;
    for (let i = g.i0[j]!; i <= g.i1[j]!; i++)
      if (layerCovers(row, pixelU(g, j, i), y, c)) a[j * g.width + i] = 1;
  }
  if (featherCm > 0) blurAlpha(a, g, featherCm * g.pxPerCm);
  return a;
}

/** Index of the pixel k steps round the ring from pixel i in row j (wrapping at the seam). */
function ringIndex(g: UnwrapRows, j: number, i: number, k: number): number {
  const n = g.i1[j]! - g.i0[j]! + 1;
  return g.i0[j]! + ((((i - g.i0[j]! + k) % n) + n) % n);
}

/**
 * Box blur, twice in each direction (close to a Gaussian): round each ring with wrap-around, and
 * along the region averaging only skin pixels. In place.
 */
export function blurAlpha(a: Float32Array, g: UnwrapRows, radiusPx: number): void {
  const r = Math.max(1, Math.round(radiusPx / 2));
  const tmp = new Float32Array(a.length);
  const sums = new Float64Array(g.height + 1);
  const counts = new Int32Array(g.height + 1);
  for (let pass = 0; pass < 2; pass++) {
    // Around the ring.
    for (let j = 0; j < g.height; j++) {
      const n = g.i1[j]! - g.i0[j]! + 1;
      if (n <= 0) continue;
      const rr = Math.min(r, Math.floor((n - 1) / 2));
      let sum = 0;
      for (let k = -rr; k <= rr; k++) sum += a[j * g.width + ringIndex(g, j, g.i0[j]!, k)]!;
      for (let i = g.i0[j]!; i <= g.i1[j]!; i++) {
        tmp[j * g.width + i] = sum / (2 * rr + 1);
        sum += a[j * g.width + ringIndex(g, j, i, rr + 1)]! - a[j * g.width + ringIndex(g, j, i, -rr)]!;
      }
    }
    // Along the region: columns, skin pixels only (prefix sums of value and count).
    for (let i = 0; i < g.width; i++) {
      sums[0] = 0;
      counts[0] = 0;
      for (let j = 0; j < g.height; j++) {
        const skin = i >= g.i0[j]! && i <= g.i1[j]!;
        sums[j + 1] = sums[j]! + (skin ? tmp[j * g.width + i]! : 0);
        counts[j + 1] = counts[j]! + (skin ? 1 : 0);
      }
      for (let j = 0; j < g.height; j++) {
        if (i < g.i0[j]! || i > g.i1[j]!) continue;
        const lo = Math.max(0, j - r);
        const hi = Math.min(g.height, j + r + 1);
        const n = counts[hi]! - counts[lo]!;
        a[j * g.width + i] = n > 0 ? (sums[hi]! - sums[lo]!) / n : 0;
      }
    }
  }
}

/** Lightness below which a motif pixel counts as no ink at all (paper white, faint scan noise). */
const PAPER = 0.92;
/** Lightness at and below which a motif pixel fully covers the background. */
const FULL_INK = 0.45;

/**
 * The knockout of motifs drawn as RGBA (docs/adr/0019): how much each pixel hides the background
 * layers, 0..1. Motifs are multiplied onto the skin, so white paper around a motif is see-through;
 * it lets the background show instead of cutting a rectangle out of it. Coverage is the pixel's
 * alpha × its ink (0 at paper white, 1 from mid grey down), so transparent PNGs and white-backed
 * scans both knock out only where there is ink.
 */
export function motifKnockout(rgba: Uint8ClampedArray): Float32Array {
  const n = rgba.length / 4;
  const out = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    const a = rgba[k * 4 + 3]! / 255;
    if (a === 0) continue;
    const l = (0.2126 * rgba[k * 4]! + 0.7152 * rgba[k * 4 + 1]! + 0.0722 * rgba[k * 4 + 2]!) / 255;
    const ink = Math.min(1, Math.max(0, (PAPER - l) / (PAPER - FULL_INK)));
    out[k] = a * ink;
  }
  return out;
}

/** Grows an alpha mask by `radiusPx` (max filter, round each ring with wrap-around and along). */
export function dilateAlpha(a: Float32Array, g: UnwrapRows, radiusPx: number): Float32Array {
  const r = Math.round(radiusPx);
  if (r <= 0) return a;
  const tmp = new Float32Array(a.length);
  for (let j = 0; j < g.height; j++)
    for (let i = g.i0[j]!; i <= g.i1[j]!; i++) {
      let m = 0;
      for (let k = -r; k <= r && m < 1; k++) m = Math.max(m, a[j * g.width + ringIndex(g, j, i, k)]!);
      tmp[j * g.width + i] = m;
    }
  const out = new Float32Array(a.length);
  for (let j = 0; j < g.height; j++)
    for (let i = g.i0[j]!; i <= g.i1[j]!; i++) {
      let m = 0;
      for (let k = Math.max(0, j - r); k <= Math.min(g.height - 1, j + r) && m < 1; k++)
        if (i >= g.i0[k]! && i <= g.i1[k]!) m = Math.max(m, tmp[k * g.width + i]!);
      out[j * g.width + i] = m;
    }
  return out;
}

/** A layer's picture on the skin: RGBA (0..255) at s cm around from the seam line, y cm down. */
export type LayerSampler = (s: number, yDown: number, out: Float32Array) => void;

/** Samples a seamless tile: `tileCm` is its width on the skin; rotation and offset as in the layout. */
export function tileSampler(
  tile: Tile,
  tileCm: number,
  rotationDeg = 0,
  offset: { x: number; y: number } = { x: 0, y: 0 },
): LayerSampler {
  const k = tile.width / tileCm;
  const rot = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  return (s, yDown, out) => {
    const x = s - offset.x;
    const y = yDown + offset.y;
    // Counter-clockwise as seen (y down): turn the point the other way into the tile.
    sampleTile(tile, (x * cos - y * sin) * k, (x * sin + y * cos) * k, out);
  };
}

/**
 * Samples an RGBA strip painted in skin cm (x = s + marginCm, y = yDown − y0Cm, at pxPerCm), used for
 * the line patterns of former fillers. Outside the strip: transparent.
 */
export function stripSampler(
  strip: { width: number; height: number; data: Uint8ClampedArray },
  pxPerCm: number,
  marginCm: number,
  y0Cm: number,
): LayerSampler {
  return (s, yDown, out) => {
    const x = Math.floor((s + marginCm) * pxPerCm);
    const y = Math.floor((yDown - y0Cm) * pxPerCm);
    if (x < 0 || y < 0 || x >= strip.width || y >= strip.height) {
      out[0] = out[1] = out[2] = out[3] = 0;
      return;
    }
    const i = (y * strip.width + x) * 4;
    out[0] = strip.data[i]!;
    out[1] = strip.data[i + 1]!;
    out[2] = strip.data[i + 2]!;
    out[3] = strip.data[i + 3]!;
  };
}

export type CompositeLayer = {
  sample: LayerSampler;
  /** 0..1 */
  opacity: number;
  blend: BlendMode;
  /** Coverage per pixel (layerAlpha), null = the whole region. */
  alpha: Float32Array | null;
  /** Motifs on top (0..1 per pixel), already grown by the gap; null = none. */
  knockout: Float32Array | null;
};

/** Composites one layer into RGBA pixels of the unwrap, in place. Only skin pixels change. */
export function compositeLayer(dst: Uint8ClampedArray, g: UnwrapRows, layer: CompositeLayer): void {
  const a = new Float32Array(4);
  const b = new Float32Array(4);
  const { opacity, alpha, knockout, blend, sample } = layer;
  if (opacity <= 0) return;
  for (let j = 0; j < g.height; j++) {
    const c = g.c[j]!;
    const yDown = g.length - g.y[j]!;
    for (let i = g.i0[j]!; i <= g.i1[j]!; i++) {
      const k = j * g.width + i;
      let m = opacity;
      if (alpha) m *= alpha[k]!;
      if (knockout) m *= 1 - knockout[k]!;
      if (m <= 0) continue;
      const s = patternS(g, pixelU(g, j, i), c);
      sample(s, yDown, a);
      const fade = seamCrossfade(s, c);
      if (fade.w > 0) {
        sample(fade.s2, yDown, b);
        const aw = a[3]! * (1 - fade.w);
        const bw = b[3]! * fade.w;
        const t = aw + bw;
        for (let q = 0; q < 3; q++) a[q] = t > 0 ? (a[q]! * aw + b[q]! * bw) / t : 0;
        a[3] = t;
      }
      const sa = (a[3]! / 255) * m;
      if (sa <= 0) continue;
      const p = k * 4;
      for (let q = 0; q < 3; q++) {
        const d = dst[p + q]!;
        const src = blend === "multiply" ? (d * a[q]!) / 255 : a[q]!;
        dst[p + q] = d + (src - d) * sa;
      }
    }
  }
}
