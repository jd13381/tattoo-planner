// Seams of background layers (docs/adr/0019), framework-free.
//
// 1. Around the limb: every unwrap row is as long as the local circumference c, so a tile of fixed
//    size never fits a whole number of times. The pattern is laid out from the seam line (s = 0 cm)
//    and cross-faded with its own continuation over a short zone either side of the seam, so the last
//    pixel of a row meets the first one exactly (seamCrossfade).
// 2. Inside a tile: images from GPT Image are only roughly tileable. makeSeamless fixes the tile
//    edges by offset-and-blend: the tile shifted by half its size (whose edges are the original's
//    continuous middle) is blended in towards the edges.
import { emptyTile, type Tile } from "./tile.ts";

/** Width in cm of the cross-fade either side of the seam around the limb. */
export const SEAM_BLEND_CM = 1.5;

/**
 * For a point s cm along a row of length c (0 ≤ s < c), the second sample position and its weight
 * (0..0.5) of the cross-fade at the seam; weight 0 away from the seam. At s → c and s → 0 both
 * positions get weight 0.5, so the row closes without a jump.
 */
export function seamCrossfade(s: number, c: number, blend = SEAM_BLEND_CM): { s2: number; w: number } {
  const b = Math.min(blend, c / 4);
  if (b <= 0) return { s2: s, w: 0 };
  if (s > c - b) return { s2: s - c, w: (0.5 * (s - (c - b))) / b };
  if (s < b) return { s2: s + c, w: (0.5 * (b - s)) / b };
  return { s2: s, w: 0 };
}

const smooth = (t: number) => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
};

/**
 * Offset-and-blend seam fix: out = mix(tile, tile shifted by half, m), with m = 1 at the edges and 0
 * from `blendFrac` of the size inwards. The result wraps round without a visible edge in both
 * directions; the middle keeps the original.
 */
export function makeSeamless(t: Tile, blendFrac = 0.25): Tile {
  const { width: w, height: h, data } = t;
  const out = emptyTile(w, h);
  const bw = Math.max(1, blendFrac * w);
  const bh = Math.max(1, blendFrac * h);
  const hx = Math.floor(w / 2);
  const hy = Math.floor(h / 2);
  for (let y = 0; y < h; y++) {
    const ey = 1 - smooth(Math.min(y + 0.5, h - y - 0.5) / bh);
    const sy = (y + hy) % h;
    for (let x = 0; x < w; x++) {
      const ex = 1 - smooth(Math.min(x + 0.5, w - x - 0.5) / bw);
      const m = Math.max(ex, ey);
      const sx = (x + hx) % w;
      const i = (y * w + x) * 4;
      const j = (sy * w + sx) * 4;
      for (let k = 0; k < 4; k++) out.data[i + k] = data[i + k]! * (1 - m) + data[j + k]! * m;
    }
  }
  return out;
}

/**
 * How visible the tile's wrap-around edges are: the mean colour step across the edges (last column to
 * first, last row to first) divided by the mean step between neighbours inside. About 1 for a seamless
 * tile (the edges look like any other place), clearly above 1 for a visible seam.
 */
export function seamRatio(t: Tile): number {
  const { width: w, height: h, data } = t;
  const diff = (a: number, b: number) => {
    let s = 0;
    for (let k = 0; k < 4; k++) s += Math.abs(data[a * 4 + k]! - data[b * 4 + k]!);
    return s;
  };
  let edge = 0;
  let edgeN = 0;
  for (let y = 0; y < h; y++, edgeN++) edge += diff(y * w + w - 1, y * w);
  for (let x = 0; x < w; x++, edgeN++) edge += diff((h - 1) * w + x, x);
  let inner = 0;
  let innerN = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w - 1; x++, innerN++) inner += diff(y * w + x, y * w + x + 1);
  for (let y = 0; y < h - 1; y++)
    for (let x = 0; x < w; x++, innerN++) inner += diff(y * w + x, (y + 1) * w + x);
  const e = edge / Math.max(1, edgeN);
  const i = inner / Math.max(1, innerN);
  return i > 1e-9 ? e / i : e > 1e-9 ? Infinity : 1;
}
