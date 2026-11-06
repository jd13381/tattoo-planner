// "Ink only": keeps the ink of a photographed tattoo and drops the skin, its shading and the body's
// shapes (docs/adr/0023-projection-cleanup.md). Plain TypeScript on float buffers and RGBA pixels, so it
// runs in the browser (projection patches, the Image studio's built-in engine) and in unit tests alike.
//
// 1. Flatten: the skin's brightness is estimated per pixel over a large window (a box mean of the
//    pixels that are not ink, refined twice, on a coarse grid); every pixel is divided by it. Bare skin
//    becomes 1 wherever it lies, in light or in shadow; ink stays darker than its surroundings.
// 2. Levels: the darkness left after flattening is cut by `strength`: weak marks (pores, hair, soft
//    shadow edges) drop out, lines and fills stay. The result is an ink amount 0..1 per pixel, used as
//    alpha, and the ink's tone (grey, or its colour with `keepColor`).
import type { Pixels } from "./builtinOps.ts";

export type InkOptions = {
  /** Radius of the window the skin brightness is estimated over, px; larger than the ink's lines. */
  radiusPx: number;
  /** 0 = keep faint ink and grey tones … 1 = only clear ink, as solid line art. */
  strength: number;
  /** Keep the ink's colour (and the photo's colour cast inside it); otherwise black and grey. */
  keepColor?: boolean;
};

/** A pixel this much darker than the skin estimate counts as ink while the skin is estimated. */
const INK_GAP = 0.12;
/** Refinement passes of the skin estimate (each one leaves out the ink the previous one found). */
const PASSES = 2;

/** Mean over a (2r + 1)² window ignoring NaN cells (NaN where the window has none); separable. */
function boxMeanNaN(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const pass = (a: Float32Array, horizontal: boolean) => {
    const out = new Float32Array(a.length);
    const [n, lines] = horizontal ? [w, h] : [h, w];
    for (let line = 0; line < lines; line++) {
      const at = (k: number) => (horizontal ? line * w + k : k * w + line);
      let sum = 0;
      let cnt = 0;
      const add = (k: number, sign: number) => {
        if (k < 0 || k >= n) return;
        const v = a[at(k)]!;
        if (Number.isNaN(v)) return;
        sum += sign * v;
        cnt += sign;
      };
      for (let k = 0; k < Math.min(n, r); k++) add(k, 1);
      for (let k = 0; k < n; k++) {
        add(k + r, 1);
        add(k - r - 1, -1);
        out[at(k)] = cnt > 0 ? sum / cnt : NaN;
      }
    }
    return out;
  };
  return pass(pass(src, true), false);
}

/** NaN-aware mean of `step` × `step` blocks. */
function shrink(src: Float32Array, w: number, h: number, step: number) {
  const sw = Math.max(1, Math.ceil(w / step));
  const sh = Math.max(1, Math.ceil(h / step));
  const sum = new Float32Array(sw * sh);
  const cnt = new Float32Array(sw * sh);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const v = src[y * w + x]!;
      if (Number.isNaN(v)) continue;
      const k = Math.floor(y / step) * sw + Math.floor(x / step);
      sum[k]! += v;
      cnt[k]! += 1;
    }
  const out = new Float32Array(sw * sh);
  for (let k = 0; k < out.length; k++) out[k] = cnt[k]! > 0 ? sum[k]! / cnt[k]! : NaN;
  return { data: out, w: sw, h: sh };
}

/** Bilinear interpolation of a coarse grid back to w × h (NaN cells skipped). */
function grow(small: Float32Array, sw: number, sh: number, w: number, h: number, step: number) {
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const fy = Math.min(sh - 1, Math.max(0, (y + 0.5) / step - 0.5));
    const y0 = Math.floor(fy);
    const y1 = Math.min(sh - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(sw - 1, Math.max(0, (x + 0.5) / step - 0.5));
      const x0 = Math.floor(fx);
      const x1 = Math.min(sw - 1, x0 + 1);
      const tx = fx - x0;
      let acc = 0;
      let ws = 0;
      const take = (xx: number, yy: number, wt: number) => {
        const v = small[yy * sw + xx]!;
        if (wt <= 0 || Number.isNaN(v)) return;
        acc += v * wt;
        ws += wt;
      };
      take(x0, y0, (1 - tx) * (1 - ty));
      take(x1, y0, tx * (1 - ty));
      take(x0, y1, (1 - tx) * ty);
      take(x1, y1, tx * ty);
      out[y * w + x] = ws > 0 ? acc / ws : NaN;
    }
  }
  return out;
}

/**
 * The skin's brightness at every pixel (NaN cells are unseen and stay NaN): the mean of the pixels
 * around that are not ink, over a window of `radiusPx`. Where a solid fill is wider than the window,
 * a three times wider window answers, then the mean of all skin.
 */
export function skinEstimate(values: Float32Array, w: number, h: number, radiusPx: number): Float32Array {
  const step = Math.max(1, Math.floor(radiusPx / 6));
  const r = Math.max(1, Math.round(radiusPx / step));
  const coarse = shrink(values, w, h, step);
  let bg = boxMeanNaN(coarse.data, coarse.w, coarse.h, r);
  const n = coarse.data.length;
  for (let pass = 0; pass < PASSES; pass++) {
    // Leave out what is clearly darker than the current estimate (ink); keep NaN where unseen.
    const skin = new Float32Array(n);
    let sum = 0;
    let cnt = 0;
    for (let k = 0; k < n; k++) {
      const v = coarse.data[k]!;
      const b = bg[k]!;
      const isSkin = !Number.isNaN(v) && !(v < b * (1 - INK_GAP));
      skin[k] = isSkin ? v : NaN;
      if (isSkin) {
        sum += v;
        cnt++;
      }
    }
    const near = boxMeanNaN(skin, coarse.w, coarse.h, r);
    const wide = boxMeanNaN(skin, coarse.w, coarse.h, 3 * r);
    const all = cnt > 0 ? sum / cnt : NaN;
    const next = new Float32Array(n);
    for (let k = 0; k < n; k++) {
      const a = near[k]!;
      const b = wide[k]!;
      next[k] = !Number.isNaN(a) ? a : !Number.isNaN(b) ? b : !Number.isNaN(all) ? all : bg[k]!;
    }
    bg = next;
  }
  const out = grow(bg, coarse.w, coarse.h, w, h, step);
  for (let k = 0; k < w * h; k++) if (Number.isNaN(values[k]!)) out[k] = NaN;
  return out;
}

const smoothstep = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** The darkness (0..1 below the skin) from which a pixel starts to count as ink, and the soft range. */
export function inkCut(strength: number): { from: number; to: number } {
  const s = Math.min(1, Math.max(0, strength));
  const from = 0.05 + 0.3 * s;
  return { from, to: from + 0.04 + 0.26 * (1 - s) };
}

export type InkLayer = {
  /** Ink amount 0..1 (NaN where unseen). */
  ink: Float32Array;
  /** The ink's tone 0..1 (1 = white), grey; what is multiplied onto the skin where there is ink. */
  tone: Float32Array;
  /** With keepColor: the ink's colour per channel 0..1, 3 values per pixel. */
  rgb: Float32Array | null;
};

/**
 * Ink of a brightness image (0..1, NaN = unseen) and, optionally, its colour channels (0..1, three per
 * pixel). Black-and-grey ink is darkened towards solid black with the strength, so strength 1 gives
 * line art; colour keeps its tone.
 */
export function inkLayer(
  gray: Float32Array,
  w: number,
  h: number,
  opts: InkOptions,
  rgb: Float32Array | null = null,
): InkLayer {
  const n = w * h;
  const s = Math.min(1, Math.max(0, opts.strength));
  const { from, to } = inkCut(s);
  const bg = skinEstimate(gray, w, h, opts.radiusPx);
  let bgRgb: Float32Array[] | null = null;
  if (opts.keepColor && rgb) {
    bgRgb = [0, 1, 2].map((c) => {
      const ch = new Float32Array(n);
      for (let k = 0; k < n; k++) ch[k] = Number.isNaN(gray[k]!) ? NaN : rgb[3 * k + c]!;
      return skinEstimate(ch, w, h, opts.radiusPx);
    });
  }
  const ink = new Float32Array(n);
  const tone = new Float32Array(n);
  const outRgb = bgRgb ? new Float32Array(3 * n) : null;
  for (let k = 0; k < n; k++) {
    const g = gray[k]!;
    const b = bg[k]!;
    if (Number.isNaN(g) || !(b > 0)) {
      ink[k] = NaN;
      tone[k] = 1;
      if (outRgb) outRgb.fill(1, 3 * k, 3 * k + 3);
      continue;
    }
    const flat = Math.min(1, g / b);
    let dark = 1 - flat;
    if (bgRgb && outRgb) {
      // Colour ink can be bright (yellow): the darkest channel tells it from skin.
      for (let c = 0; c < 3; c++) {
        const bc = bgRgb[c]![k]!;
        const v = bc > 0 ? Math.min(1, rgb![3 * k + c]! / bc) : 1;
        outRgb[3 * k + c] = v;
        dark = Math.max(dark, 1 - v);
      }
    }
    const a = smoothstep(from, to, dark);
    ink[k] = a;
    // Grey ink: its own tone at strength 0, solid black at strength 1.
    tone[k] = 1 - Math.min(1, (1 - flat) * (1 - s) + s);
  }
  return { ink, tone, rgb: outRgb };
}

/** Rec. 709 luminance, 0..1. */
const lum = (r: number, g: number, b: number) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

export type InkImageOptions = Omit<InkOptions, "radiusPx"> & {
  /** Window of the skin estimate as a share of the image's shorter side (0..1). */
  radiusShare: number;
};

/**
 * The Image studio's "Tattoo ink only": a new image with the ink on a transparent background (alpha =
 * ink); transparent pixels of the input stay transparent. Size and position are kept, so a projection
 * can use the result in place of its photo.
 */
export function inkOnlyImage(img: Pixels, opts: InkImageOptions): Pixels {
  const { width: w, height: h, data } = img;
  const n = w * h;
  const gray = new Float32Array(n);
  const rgb = opts.keepColor ? new Float32Array(3 * n) : null;
  for (let k = 0; k < n; k++) {
    const i = 4 * k;
    if (data[i + 3]! < 128) {
      gray[k] = NaN;
      continue;
    }
    gray[k] = lum(data[i]!, data[i + 1]!, data[i + 2]!);
    if (rgb) for (let c = 0; c < 3; c++) rgb[3 * k + c] = data[i + c]! / 255;
  }
  const radiusPx = Math.max(2, opts.radiusShare * Math.min(w, h));
  const layer = inkLayer(gray, w, h, { ...opts, radiusPx }, rgb);
  const out = new Uint8ClampedArray(4 * n);
  for (let k = 0; k < n; k++) {
    const a = layer.ink[k]!;
    const i = 4 * k;
    if (Number.isNaN(a)) continue; // transparent stays transparent
    if (layer.rgb) for (let c = 0; c < 3; c++) out[i + c] = Math.round(layer.rgb[3 * k + c]! * 255);
    else out[i] = out[i + 1] = out[i + 2] = Math.round(layer.tone[k]! * 255);
    out[i + 3] = Math.round(a * 255);
  }
  return { width: w, height: h, data: out };
}
