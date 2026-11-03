// Pixel operations for reference images (RGBA, row-major), kept free of the DOM so they can be tested.
import type { ImageFilter } from "../layout/schema.ts";

const lum = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/**
 * The luminance below which `q` of the visible pixels lie. Used as the white point of photos:
 * the bare skin around a tattoo is the brightest large area, so it maps to white and disappears
 * when the image is multiplied onto the skin colour.
 */
export function luminanceQuantile(data: Uint8ClampedArray, q: number): number {
  const hist = new Uint32Array(256);
  let n = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3]! < 16) continue;
    hist[Math.round(lum(data[i]!, data[i + 1]!, data[i + 2]!))]!++;
    n++;
  }
  if (n === 0) return 255;
  const target = q * n;
  let acc = 0;
  for (let v = 0; v < 256; v++) {
    acc += hist[v]!;
    if (acc >= target) return v;
  }
  return 255;
}

/** Grayscale, stretched so that `white` becomes 255. */
export function grayscale(data: Uint8ClampedArray, white = 255): void {
  const k = 255 / Math.max(white, 1);
  for (let i = 0; i < data.length; i += 4) {
    const v = Math.min(255, lum(data[i]!, data[i + 1]!, data[i + 2]!) * k);
    data[i] = data[i + 1] = data[i + 2] = v;
  }
}

/**
 * Engraving look: a diagonal line screen whose lines thicken where the image is dark (expects
 * grayscale input). Each pixel becomes ink or paper; `periodPx` is the line spacing.
 */
export function lineScreen(data: Uint8ClampedArray, width: number, periodPx: number, ink = 24): void {
  const p = Math.max(2, periodPx);
  for (let i = 0, px = 0; i < data.length; i += 4, px++) {
    const x = px % width;
    const y = (px - x) / width;
    const t = (((x + y) / p) % 1) * 2 - 1; // -1..1 across one line period
    const darkness = 1 - data[i]! / 255;
    // Darkness 0 = no line, 1 = solid ink; a small dead zone keeps light areas clean.
    const v = Math.abs(t) < darkness * 1.1 - 0.05 ? ink : 255;
    data[i] = data[i + 1] = data[i + 2] = v;
  }
}

/** Soft edge: alpha ramps from 0 at the image border to full at `featherPx` inside (smoothstep). */
export function featherEdges(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  featherPx: number,
): void {
  if (featherPx <= 0) return;
  for (let y = 0; y < height; y++) {
    const dy = Math.min(y + 0.5, height - y - 0.5);
    for (let x = 0; x < width; x++) {
      const d = Math.min(dy, x + 0.5, width - x - 0.5);
      if (d >= featherPx) continue;
      const t = Math.max(0, d / featherPx);
      const s = t * t * (3 - 2 * t);
      const i = (y * width + x) * 4 + 3;
      data[i] = data[i]! * s;
    }
  }
}

/** Applies the element's look in place: filter first, then the feathered edge. */
export function processPixels(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  opts: { filter: ImageFilter; featherPx: number; hatchPeriodPx: number },
): void {
  if (opts.filter !== "none") {
    grayscale(data, Math.max(64, luminanceQuantile(data, 0.9)));
    if (opts.filter === "hatching") lineScreen(data, width, opts.hatchPeriodPx);
  }
  featherEdges(data, width, height, opts.featherPx);
}
