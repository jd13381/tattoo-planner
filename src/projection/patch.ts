// Builds the combined skin patch of an existing tattoo from several calibrated photos
// (docs/adr/0006-anubis-projection.md; any body region, docs/adr/0014-guided-projection.md). Plain TypeScript on pixel arrays, no DOM, so it runs in the
// browser, in Node and in tests alike.
//
// For every patch pixel (u, v) and every photo: project into the photo (src/projection/model.ts),
// sample its brightness and weigh it by cos(viewing angle)^exponent. Each photo's brightness is
// divided by its local skin brightness (a max filter over `white_radius_cm`, smoothed), which evens
// out exposure differences between photos and the shading towards the silhouette: skin becomes 1,
// ink stays dark. The photos are then averaged with their weights.
import type { RegionProfile } from "../body/profile.ts";
import {
  acrossSilhouette,
  photoFrame,
  sectionView,
  silhouetteAt,
  turnedSize,
  turnedToStored,
  twistReach,
  viewWeight,
} from "./model.ts";
import { inkLayer } from "../render/inkOnly.ts";
import type { ProjectionCalibration } from "./schema.ts";

/** RGBA pixels of a photo as stored, already turned upright by its EXIF orientation. */
export type PhotoPixels = {
  width: number;
  height: number;
  data: Uint8ClampedArray;
  /**
   * An edited version of the photo (`cleaned`, docs/adr/0023): its transparent parts are bare skin, not
   * unseen, and `frame` is the size of the photo the calibration points were placed on (the edit is
   * stretched onto it), when known.
   */
  cleaned?: { frame: { width: number; height: number } | null };
};

/**
 * The patch, in skin coordinates. Row 0 is the region's end side (v1), column 0 the u1 end: the left
 * arm's unwrap seen from outside. On a mirrored region (src/body/uv.ts screenSign) the unwrap runs the
 * other way, so the renderer mirrors the columns.
 */
export type ProjectedPatch = {
  u0: number;
  u1: number;
  v0: number;
  v1: number;
  width: number;
  height: number;
  pxPerCm: number;
  /** Brightness 0..255 (255 = bare skin). */
  gray: Uint8ClampedArray;
  /** With `cleanup.keep_color`: the ink's colour, 3 values (RGB 0..255) per pixel; else absent. */
  rgb?: Uint8ClampedArray;
  /** Where any photo sees the skin, 0..255, feathered at the patch border. */
  alpha: Uint8ClampedArray;
  /** The tattoo's area for blockout and metrics: 1 inside, 0 outside. */
  footprint: Uint8Array;
  /** Per photo: share of the patch's seen pixels where it has the largest weight. */
  share: number[];
};

const lum = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** Below this alpha a photo pixel counts as not photographed (a cut-out PNG's transparent background). */
const OPAQUE_MIN = 128;

/**
 * Bilinear brightness at a stored-photo point in pixels; NaN outside the photo or on transparent pixels
 * (on an edited photo, transparent pixels are white skin instead). With `rgb`, the colour channels are
 * written there too.
 */
export function sampleLum(img: PhotoPixels, x: number, y: number, rgb?: Float32Array, at3 = 0): number {
  const fx = x - 0.5;
  const fy = y - 0.5;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  if (x0 < 0 || y0 < 0 || x0 + 1 >= img.width || y0 + 1 >= img.height) return NaN;
  const tx = fx - x0;
  const ty = fy - y0;
  const d = img.data;
  const cleaned = !!img.cleaned;
  const at = (xx: number, yy: number, c: number) => {
    const i = (yy * img.width + xx) * 4;
    const a = d[i + 3]!;
    if (cleaned) {
      // An edit with the skin cut away: composite onto white skin.
      const k = a / 255;
      const v = c < 0 ? lum(d[i]!, d[i + 1]!, d[i + 2]!) : d[i + c]!;
      return v * k + 255 * (1 - k);
    }
    // Transparent pixels decode as black and would read as ink; NaN marks them unseen instead.
    if (a < OPAQUE_MIN) return NaN;
    return c < 0 ? lum(d[i]!, d[i + 1]!, d[i + 2]!) : d[i + c]!;
  };
  const bilinear = (c: number) => {
    const top = at(x0, y0, c) * (1 - tx) + at(x0 + 1, y0, c) * tx;
    const bottom = at(x0, y0 + 1, c) * (1 - tx) + at(x0 + 1, y0 + 1, c) * tx;
    return top * (1 - ty) + bottom * ty;
  };
  const l = bilinear(-1);
  if (rgb && !Number.isNaN(l)) for (let c = 0; c < 3; c++) rgb[at3 + c] = bilinear(c);
  return l;
}

/** Sliding max over a window of 2r + 1 along rows or columns; NaN cells are ignored (stay NaN if all are). */
function maxFilter1d(src: Float32Array, w: number, h: number, r: number, horizontal: boolean): Float32Array {
  const out = new Float32Array(src.length);
  const [n, lines] = horizontal ? [w, h] : [h, w];
  const idx = (line: number, k: number) => (horizontal ? line * w + k : k * w + line);
  for (let line = 0; line < lines; line++) {
    for (let k = 0; k < n; k++) {
      let m = NaN;
      for (let j = Math.max(0, k - r); j <= Math.min(n - 1, k + r); j++) {
        const v = src[idx(line, j)]!;
        if (!Number.isNaN(v) && (Number.isNaN(m) || v > m)) m = v;
      }
      out[idx(line, k)] = m;
    }
  }
  return out;
}

/** Box blur that skips NaN cells (normalised by the valid count), separable. */
export function boxBlurNaN(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const pass = (a: Float32Array, horizontal: boolean) => {
    const out = new Float32Array(a.length);
    const [n, lines] = horizontal ? [w, h] : [h, w];
    const idx = (line: number, k: number) => (horizontal ? line * w + k : k * w + line);
    for (let line = 0; line < lines; line++) {
      let sum = 0;
      let cnt = 0;
      const add = (k: number, sign: number) => {
        if (k < 0 || k >= n) return;
        const v = a[idx(line, k)]!;
        if (Number.isNaN(v)) return;
        sum += sign * v;
        cnt += sign;
      };
      for (let k = 0; k < Math.min(n, r); k++) add(k, 1);
      for (let k = 0; k < n; k++) {
        add(k + r, 1);
        add(k - r - 1, -1);
        out[idx(line, k)] = cnt > 0 ? sum / cnt : NaN;
      }
    }
    return out;
  };
  return pass(pass(src, true), false);
}

/**
 * Local skin brightness of an image (NaN = not seen): the max over a window of radius `r` px, then
 * smoothed, computed on a grid `step` times coarser and interpolated back.
 */
export function localWhite(src: Float32Array, w: number, h: number, r: number, step = 4): Float32Array {
  const sw = Math.max(1, Math.ceil(w / step));
  const sh = Math.max(1, Math.ceil(h / step));
  const small = new Float32Array(sw * sh).fill(NaN);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = src[y * w + x]!;
      if (Number.isNaN(v)) continue;
      const k = Math.floor(y / step) * sw + Math.floor(x / step);
      const cur = small[k]!;
      small[k] = Number.isNaN(cur) ? v : Math.max(cur, v);
    }
  }
  const rs = Math.max(1, Math.round(r / step));
  const maxed = maxFilter1d(maxFilter1d(small, sw, sh, rs, true), sw, sh, rs, false);
  const smooth = boxBlurNaN(maxed, sw, sh, rs);
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
      let wsum = 0;
      for (const [xx, yy, ww] of [
        [x0, y0, (1 - tx) * (1 - ty)],
        [x1, y0, tx * (1 - ty)],
        [x0, y1, (1 - tx) * ty],
        [x1, y1, tx * ty],
      ] as const) {
        const v = smooth[yy * sw + xx]!;
        if (Number.isNaN(v) || ww === 0) continue;
        acc += v * ww;
        wsum += ww;
      }
      out[y * w + x] = wsum > 0 ? acc / wsum : NaN;
    }
  }
  return out;
}

/** Footprint pieces smaller than this (cm²) are specks, not tattoo. */
const MIN_FOOTPRINT_CM2 = 3;
/** Radius over which ink is averaged for the footprint, cm. */
const FOOTPRINT_BLUR_CM = 1.5;
/** Darkness every pixel loses before the footprint is measured, so hair and pores do not add up. */
const INK_FLOOR = 0.18;

/** 4-connected components of value `of`; calls `visit` with each component's pixel indices. */
function components(mask: Uint8Array, w: number, h: number, of: 0 | 1, visit: (px: number[]) => void) {
  const seen = new Uint8Array(w * h);
  const stack: number[] = [];
  for (let start = 0; start < w * h; start++) {
    if (seen[start] || mask[start] !== of) continue;
    const px: number[] = [];
    seen[start] = 1;
    stack.push(start);
    while (stack.length) {
      const k = stack.pop()!;
      px.push(k);
      const x = k % w;
      for (const n of [x > 0 ? k - 1 : -1, x < w - 1 ? k + 1 : -1, k - w, k + w]) {
        if (n < 0 || n >= w * h || seen[n] || mask[n] !== of) continue;
        seen[n] = 1;
        stack.push(n);
      }
    }
    visit(px);
  }
}

/** Removes components of 1s smaller than `minArea` pixels. */
export function dropSmall(mask: Uint8Array, w: number, h: number, minArea: number): Uint8Array {
  const out = mask.slice();
  components(mask, w, h, 1, (px) => {
    if (px.length < minArea) for (const k of px) out[k] = 0;
  });
  return out;
}

/** Sets every region of 0s that does not touch the border to 1. */
export function fillHoles(mask: Uint8Array, w: number, h: number): Uint8Array {
  const out = mask.slice();
  components(mask, w, h, 0, (px) => {
    const border = px.some((k) => {
      const x = k % w;
      const y = (k - x) / w;
      return x === 0 || y === 0 || x === w - 1 || y === h - 1;
    });
    if (!border) for (const k of px) out[k] = 1;
  });
  return out;
}

const smoothstep = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Size of the patch grid in pixels for a calibration. */
export function patchSize(
  cal: ProjectionCalibration,
  profile: RegionProfile,
): { width: number; height: number } {
  const { u, v, px_per_cm: ppc } = cal.patch;
  let maxC = 0;
  for (let k = 0; k <= 20; k++)
    maxC = Math.max(maxC, profile.circumferenceAt((v[0] + ((v[1] - v[0]) * k) / 20) * profile.length));
  return {
    width: Math.max(1, Math.ceil((u[1] - u[0]) * maxC * ppc)),
    height: Math.max(1, Math.ceil((v[1] - v[0]) * profile.length * ppc)),
  };
}

/** Skin coordinates of patch pixel centres. */
export function patchU(cal: ProjectionCalibration, width: number, i: number): number {
  const [u0, u1] = cal.patch.u;
  return u1 - ((i + 0.5) / width) * (u1 - u0);
}
export function patchV(cal: ProjectionCalibration, height: number, j: number): number {
  const [v0, v1] = cal.patch.v;
  return v1 - ((j + 0.5) / height) * (v1 - v0);
}

/**
 * One photo seen in patch space: normalised brightness (NaN = unseen) and blend weight per pixel; with
 * colour, the channels normalised the same way (3 per pixel).
 */
export type PhotoLayer = { value: Float32Array; weight: Float32Array; cos: Float32Array; rgb?: Float32Array };

/** Projects one photo into patch space (brightness divided by the local skin brightness). */
export function photoLayer(
  cal: ProjectionCalibration,
  index: number,
  profile: RegionProfile,
  img: PhotoPixels,
  size: { width: number; height: number },
  color = false,
): PhotoLayer {
  const photo = cal.photos[index]!;
  const { width: W, height: H } = size;
  // The points were placed on the original photo; an edit is stretched onto its frame.
  const base = img.cleaned?.frame ?? img;
  const turned = turnedSize(base.width, base.height, photo.turn);
  const frame = photoFrame(photo, turned.width, turned.height, twistReach(profile));
  const raw = new Float32Array(W * H).fill(NaN);
  const weight = new Float32Array(W * H);
  const cosArr = new Float32Array(W * H);
  const rawRgb = color ? new Float32Array(3 * W * H) : undefined;
  if (frame) {
    for (let j = 0; j < H; j++) {
      const s = patchV(cal, H, j) * profile.length;
      const sil = silhouetteAt(frame, s);
      if (!sil) continue;
      const view = sectionView(profile.circumferenceAt(s), profile.aspectAt(s), frame.uViewAt(s), profile);
      for (let i = 0; i < W; i++) {
        const { t, cos } = view.at(patchU(cal, W, i));
        cosArr[j * W + i] = cos;
        if (cos <= 0) continue;
        const p = acrossSilhouette(sil, t);
        const st = turnedToStored(p.x / turned.width, p.y / turned.height, photo.turn);
        const l = sampleLum(img, st.x * img.width, st.y * img.height, rawRgb, 3 * (j * W + i));
        if (Number.isNaN(l)) continue;
        raw[j * W + i] = l;
        weight[j * W + i] = viewWeight(cos, cal.blend.exponent, photo.weight);
      }
    }
  }
  const white = localWhite(raw, W, H, cal.blend.white_radius_cm * cal.patch.px_per_cm);
  const value = new Float32Array(W * H);
  for (let k = 0; k < W * H; k++) {
    const r = raw[k]!;
    const wv = white[k]!;
    value[k] = Number.isNaN(r) || !(wv > 0) ? NaN : Math.min(1, r / wv);
    if (Number.isNaN(value[k]!)) weight[k] = 0;
    else if (rawRgb) for (let c = 0; c < 3; c++) rawRgb[3 * k + c] = rawRgb[3 * k + c]! / wv;
  }
  return { value, weight, cos: cosArr, ...(rawRgb ? { rgb: rawRgb } : {}) };
}

/**
 * Builds the patch from the photos (null = photo not available; the others still count).
 * Returns null when no photo is available.
 */
export function buildPatch(
  cal: ProjectionCalibration,
  profile: RegionProfile,
  photos: readonly (PhotoPixels | null)[],
): ProjectedPatch | null {
  if (!photos.some((p) => p)) return null;
  const size = patchSize(cal, profile);
  const { width: W, height: H } = size;
  const color = !!cal.cleanup?.keep_color;
  const layers = photos.map((img, k) => (img ? photoLayer(cal, k, profile, img, size, color) : null));
  const cleanup = cal.cleanup;
  // Ink only: the blend before the levels, and its colour (NaN = unseen).
  const blendF = cleanup ? new Float32Array(W * H).fill(NaN) : null;
  const blendRgb = color ? new Float32Array(3 * W * H).fill(1) : null;
  const alphaF = cleanup ? new Float32Array(W * H) : null;
  const gray = new Uint8ClampedArray(W * H);
  const alpha = new Uint8ClampedArray(W * H);
  const inkF = new Float32Array(W * H);
  const wins = new Array<number>(photos.length).fill(0);
  let seen = 0;
  const featherPx = cal.patch.feather_cm * cal.patch.px_per_cm;
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const k = j * W + i;
      let sum = 0;
      let wsum = 0;
      let best = -1;
      let bestW = 0;
      let maxCos = 0;
      let r = 0;
      let gg = 0;
      let b = 0;
      layers.forEach((layer, n) => {
        if (!layer) return;
        const w = layer.weight[k]!;
        if (w <= 0) return;
        sum += w * layer.value[k]!;
        wsum += w;
        if (layer.rgb) {
          r += w * layer.rgb[3 * k]!;
          gg += w * layer.rgb[3 * k + 1]!;
          b += w * layer.rgb[3 * k + 2]!;
        }
        maxCos = Math.max(maxCos, layer.cos[k]!);
        if (w > bestW) {
          bestW = w;
          best = n;
        }
      });
      if (wsum <= 0) {
        gray[k] = 255;
        continue;
      }
      seen++;
      wins[best]!++;
      const g = Math.min(1, sum / wsum / cal.blend.skin_level);
      gray[k] = Math.round(g * 255);
      // Fade out where only grazing views see the skin, and at the patch border.
      const border = Math.min(i + 0.5, W - i - 0.5, j + 0.5, H - j - 0.5);
      const a = smoothstep(0.05, 0.3, maxCos) * (featherPx > 0 ? smoothstep(0, featherPx, border) : 1);
      alpha[k] = Math.round(a * 255);
      if (blendF && alphaF) {
        blendF[k] = g;
        alphaF[k] = a;
        if (blendRgb) {
          blendRgb[3 * k] = Math.min(1, r / wsum / cal.blend.skin_level);
          blendRgb[3 * k + 1] = Math.min(1, gg / wsum / cal.blend.skin_level);
          blendRgb[3 * k + 2] = Math.min(1, b / wsum / cal.blend.skin_level);
        }
      }
      // Faint marks (hair, pores) stay below the floor; hatching lines are darker.
      inkF[k] = Math.max(0, 1 - g - INK_FLOOR) * a;
    }
  }
  let rgbOut: Uint8ClampedArray | undefined;
  if (cleanup && blendF && alphaF) {
    // Ink only (docs/adr/0023): the shading flattened, the skin dropped; alpha and footprint follow the ink.
    const layer = inkLayer(
      blendF,
      W,
      H,
      {
        radiusPx: cleanup.flatten_cm * cal.patch.px_per_cm,
        strength: cleanup.strength,
        keepColor: cleanup.keep_color,
      },
      blendRgb,
    );
    if (layer.rgb) rgbOut = new Uint8ClampedArray(3 * W * H).fill(255);
    for (let k = 0; k < W * H; k++) {
      const ink = layer.ink[k]!;
      if (Number.isNaN(ink)) continue;
      const a = alphaF[k]! * ink;
      alpha[k] = Math.round(a * 255);
      gray[k] = Math.round(layer.tone[k]! * 255);
      if (rgbOut && layer.rgb)
        for (let c = 0; c < 3; c++) rgbOut[3 * k + c] = Math.round(layer.rgb[3 * k + c]! * 255);
      inkF[k] = a;
    }
  }
  // Footprint: ink smoothed over about a centimetre, so the hatching reads as one area; specks (hair,
  // pores) dropped, holes filled.
  const blurR = Math.max(1, Math.round(FOOTPRINT_BLUR_CM * cal.patch.px_per_cm));
  const smooth = boxBlurNaN(inkF, W, H, blurR);
  const raw = new Uint8Array(W * H);
  for (let k = 0; k < W * H; k++) raw[k] = smooth[k]! >= cal.blend.ink_threshold ? 1 : 0;
  const minArea = Math.round(MIN_FOOTPRINT_CM2 * cal.patch.px_per_cm ** 2);
  const footprint = fillHoles(dropSmall(raw, W, H, minArea), W, H);
  return {
    u0: cal.patch.u[0],
    u1: cal.patch.u[1],
    v0: cal.patch.v[0],
    v1: cal.patch.v[1],
    width: W,
    height: H,
    pxPerCm: cal.patch.px_per_cm,
    gray,
    ...(rgbOut ? { rgb: rgbOut } : {}),
    alpha,
    footprint,
    share: wins.map((n) => (seen > 0 ? n / seen : 0)),
  };
}

/** Whether the patch's footprint covers the skin point (u, v). */
export function patchCovers(patch: ProjectedPatch, u: number, v: number): boolean {
  const span = patch.u1 - patch.u0;
  // u relative to u0, taken once around the arm so a patch across the seam works too.
  const du = (((u - patch.u0) % 1) + 1) % 1;
  if (du > span || v < patch.v0 || v > patch.v1) return false;
  const i = Math.floor(((span - du) / span) * patch.width);
  const j = Math.floor(((patch.v1 - v) / (patch.v1 - patch.v0)) * patch.height);
  if (i < 0 || j < 0 || i >= patch.width || j >= patch.height) return false;
  return patch.footprint[j * patch.width + i] === 1;
}

/** Bounding box of the footprint in skin terms: u range, v range (null when empty). */
export function footprintBounds(patch: ProjectedPatch): { u: [number, number]; v: [number, number] } | null {
  let i0 = Infinity;
  let i1 = -Infinity;
  let j0 = Infinity;
  let j1 = -Infinity;
  for (let j = 0; j < patch.height; j++)
    for (let i = 0; i < patch.width; i++)
      if (patch.footprint[j * patch.width + i]) {
        i0 = Math.min(i0, i);
        i1 = Math.max(i1, i);
        j0 = Math.min(j0, j);
        j1 = Math.max(j1, j);
      }
  if (i0 === Infinity) return null;
  const su = (patch.u1 - patch.u0) / patch.width;
  const sv = (patch.v1 - patch.v0) / patch.height;
  return {
    u: [patch.u1 - (i1 + 1) * su, patch.u1 - i0 * su],
    v: [patch.v1 - (j1 + 1) * sv, patch.v1 - j0 * sv],
  };
}
