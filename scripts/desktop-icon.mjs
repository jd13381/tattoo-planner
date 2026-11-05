#!/usr/bin/env node
// Draws the desktop app's icon at build time (docs/adr/0014-desktop-app.md), so no binary image is
// committed: a 1024 × 1024 PNG with a rounded dark tile, a stylised forearm and two wrapping bands.
// electron-builder turns it into the .icns. Output: dist-desktop/build/icon.png (git-ignored).
// Usage: node scripts/desktop-icon.mjs [out.png]
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { deflateSync } from "node:zlib";

const SIZE = 1024;
/** Samples per pixel along each axis (anti-aliasing). */
const SS = 3;

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** RGBA pixels (Uint8Array, row-major) → PNG bytes. */
export function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Inside a rounded square of half-size h and corner radius r, centred at 0.5. */
function inRoundedSquare(x, y, h, r) {
  const dx = Math.max(Math.abs(x - 0.5) - (h - r), 0);
  const dy = Math.max(Math.abs(y - 0.5) - (h - r), 0);
  return dx * dx + dy * dy <= r * r;
}

/** The colour of one sample point (x, y in 0..1), or null outside the tile. */
function sample(x, y) {
  // Tile: macOS icon grid, 824 of 1024 px with a 185 px corner radius.
  if (!inRoundedSquare(x, y, 0.4023, 0.1807)) return null;
  // Forearm: a slightly tapering vertical shape, wider at the top.
  const half = 0.13 + (0.4 - y) * 0.05;
  const cx = 0.5;
  const top = 0.16;
  const bottom = 0.86;
  const inArm = y > top && y < bottom && Math.abs(x - cx) < half;
  if (inArm) {
    // Two bands that wrap around the arm: arcs of an ellipse seen slightly from above.
    const t = (x - cx) / half; // -1 .. 1 across the arm
    const curve = 0.035 * Math.sqrt(Math.max(0, 1 - t * t));
    for (const [centre, width] of [
      [0.37, 0.045],
      [0.62, 0.075],
    ]) {
      if (Math.abs(y - (centre + curve)) < width / 2) return [192, 57, 43];
    }
    // Soft shading across the arm.
    const shade = 1 - 0.18 * t * t;
    return [Math.round(236 * shade), Math.round(226 * shade), Math.round(212 * shade)];
  }
  // Background: dark ink with a faint vertical gradient.
  const g = 1 - y;
  return [Math.round(26 + 14 * g), Math.round(24 + 12 * g), Math.round(32 + 16 * g)];
}

export function drawIcon(size = SIZE) {
  const px = new Uint8Array(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let pxi = 0; pxi < size; pxi++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const c = sample((pxi + (sx + 0.5) / SS) / size, (py + (sy + 0.5) / SS) / size);
          if (!c) continue;
          r += c[0];
          g += c[1];
          b += c[2];
          a += 1;
        }
      }
      const i = (py * size + pxi) * 4;
      if (a > 0) {
        px[i] = Math.round(r / a);
        px[i + 1] = Math.round(g / a);
        px[i + 2] = Math.round(b / a);
        px[i + 3] = Math.round((255 * a) / (SS * SS));
      }
    }
  }
  return encodePng(size, size, px);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const out = path.resolve(process.argv[2] ?? "dist-desktop/build/icon.png");
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, drawIcon());
  console.log(`icon: ${path.relative(process.cwd(), out)}`);
}
