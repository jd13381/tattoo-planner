// Tiles for background layers (docs/adr/0019): RGBA pixel buffers that repeat seamlessly in both
// directions, plus sampling with wrap-around. Framework-free (no canvas), so Node tests and the
// generator script use the same code as the page.

/** An RGBA image, row-major, 4 bytes per pixel. */
export type Tile = { width: number; height: number; data: Uint8ClampedArray };

export function emptyTile(width: number, height: number): Tile {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

const mod = (a: number, n: number) => ((a % n) + n) % n;

/**
 * Bilinear sample of a tile at pixel coordinates (x, y), wrapping round in both directions.
 * Writes premultiplied-free RGBA (0..255) into `out`.
 */
export function sampleTile(t: Tile, x: number, y: number, out: Float32Array): void {
  const fx = x - 0.5;
  const fy = y - 0.5;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const ax = fx - x0;
  const ay = fy - y0;
  const xa = mod(x0, t.width);
  const xb = mod(x0 + 1, t.width);
  const ya = mod(y0, t.height) * t.width;
  const yb = mod(y0 + 1, t.height) * t.width;
  const d = t.data;
  const w00 = (1 - ax) * (1 - ay);
  const w10 = ax * (1 - ay);
  const w01 = (1 - ax) * ay;
  const w11 = ax * ay;
  const i00 = (ya + xa) * 4;
  const i10 = (ya + xb) * 4;
  const i01 = (yb + xa) * 4;
  const i11 = (yb + xb) * 4;
  // Colour weighted by alpha, so transparent pixels do not darken the edges of ink.
  const a = d[i00 + 3]! * w00 + d[i10 + 3]! * w10 + d[i01 + 3]! * w01 + d[i11 + 3]! * w11;
  out[3] = a;
  if (a <= 0) {
    out[0] = out[1] = out[2] = 0;
    return;
  }
  for (let k = 0; k < 3; k++)
    out[k] =
      (d[i00 + k]! * d[i00 + 3]! * w00 +
        d[i10 + k]! * d[i10 + 3]! * w10 +
        d[i01 + k]! * d[i01 + 3]! * w01 +
        d[i11 + k]! * d[i11 + 3]! * w11) /
      a;
}

/** Parses "#rgb" or "#rrggbb"; anything else gives `fallback`. */
export function parseHex(
  color: string | undefined,
  fallback: [number, number, number],
): [number, number, number] {
  if (!color) return fallback;
  const long = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color);
  if (long) return [parseInt(long[1]!, 16), parseInt(long[2]!, 16), parseInt(long[3]!, 16)];
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(color);
  if (short) return [1, 2, 3].map((i) => parseInt(short[i]! + short[i]!, 16)) as [number, number, number];
  if (color === "black") return [0, 0, 0];
  return fallback;
}

/** A tile from an ink field (0..1 per pixel): the ink colour with the field as alpha. */
export function inkTile(width: number, height: number, ink: Float32Array, rgb: readonly number[]): Tile {
  const t = emptyTile(width, height);
  for (let k = 0; k < width * height; k++) {
    t.data[k * 4] = rgb[0]!;
    t.data[k * 4 + 1] = rgb[1]!;
    t.data[k * 4 + 2] = rgb[2]!;
    t.data[k * 4 + 3] = Math.round(Math.min(1, Math.max(0, ink[k]!)) * 255);
  }
  return t;
}

/**
 * Turns an opaque picture (white paper, dark ink) into ink on transparency: alpha from darkness, the
 * colour kept. Used for background images, so "normal" blending does not paint white paper on skin.
 */
export function paperToInk(t: Tile): Tile {
  const out = emptyTile(t.width, t.height);
  for (let k = 0; k < t.width * t.height; k++) {
    const r = t.data[k * 4]!;
    const g = t.data[k * 4 + 1]!;
    const b = t.data[k * 4 + 2]!;
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const darkness = 1 - lum / 255;
    const a = (t.data[k * 4 + 3]! / 255) * darkness;
    // The ink colour is the pixel's colour pushed to full strength (divided out of the paper).
    const scale = darkness > 1e-3 ? 1 / darkness : 1;
    out.data[k * 4] = 255 - (255 - r) * scale;
    out.data[k * 4 + 1] = 255 - (255 - g) * scale;
    out.data[k * 4 + 2] = 255 - (255 - b) * scale;
    out.data[k * 4 + 3] = Math.round(a * 255);
  }
  return out;
}

/** Downscales a tile by an integer factor (box filter), keeping it seamless. */
export function downscaleTile(t: Tile, factor: number): Tile {
  const f = Math.max(1, Math.floor(factor));
  if (f === 1) return t;
  const w = Math.max(1, Math.floor(t.width / f));
  const h = Math.max(1, Math.floor(t.height / f));
  const out = emptyTile(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      for (let k = 0; k < 4; k++) {
        let s = 0;
        for (let dy = 0; dy < f; dy++)
          for (let dx = 0; dx < f; dx++) s += t.data[((y * f + dy) * t.width + x * f + dx) * 4 + k]!;
        out.data[(y * w + x) * 4 + k] = Math.round(s / (f * f));
      }
  return out;
}
