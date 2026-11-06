// A minimal PNG encoder (8-bit RGBA, no filtering) for images the planner draws itself, such as the
// sample project's placeholders (src/sample/placeholders.ts). Same format as scripts/desktop-icon.mjs.
// decodePng reads the 8-bit PNGs the OpenAI Images API returns (standard backgrounds, docs/adr/0019).
import { crc32, deflateSync, inflateSync } from "node:zlib";

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}

/** RGBA pixels (row-major, width × height × 4 bytes) → PNG bytes. */
export function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  if (rgba.length !== width * height * 4) throw new Error("pixel buffer does not match the size");
  return encode(width, height, 6, 4, rgba);
}

/** Opaque grey pixels (one byte each) → an 8-bit greyscale PNG, a quarter of the RGBA size. */
export function encodeGreyPng(width: number, height: number, grey: Uint8Array): Buffer {
  if (grey.length !== width * height) throw new Error("pixel buffer does not match the size");
  return encode(width, height, 0, 1, grey);
}

function encode(width: number, height: number, colourType: number, channels: number, px: Uint8Array) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = colourType;
  const stride = width * channels;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    raw.set(px.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  return Buffer.concat([
    SIGNATURE,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 4: 2, 6: 4 };

/**
 * PNG bytes → RGBA pixels, for 8-bit non-interlaced PNGs (grey, grey+alpha, RGB, RGBA, any row
 * filter): what the OpenAI Images API returns. Throws on anything else.
 */
export function decodePng(bytes: Uint8Array): { width: number; height: number; rgba: Uint8Array } {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (buf.length < 8 || !buf.subarray(0, 8).equals(SIGNATURE)) throw new Error("not a PNG");
  let width = 0;
  let height = 0;
  let channels = 0;
  const idat: Buffer[] = [];
  for (let at = 8; at + 8 <= buf.length;) {
    const len = buf.readUInt32BE(at);
    const name = buf.toString("ascii", at + 4, at + 8);
    const data = buf.subarray(at + 8, at + 8 + len);
    if (name === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      channels = CHANNELS[data[9]!] ?? 0;
      if (data[8] !== 8 || data[12] !== 0 || !channels)
        throw new Error(
          `unsupported PNG (bit depth ${data[8]}, colour type ${data[9]}, interlace ${data[12]})`,
        );
    } else if (name === "IDAT") idat.push(data);
    else if (name === "IEND") break;
    at += 12 + len;
  }
  if (!width || !height || idat.length === 0) throw new Error("PNG without image data");
  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(idat));
  if (raw.length < (stride + 1) * height) throw new Error("PNG data is cut short");
  const px = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const row = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? px[row + x - channels]! : 0;
      const b = y > 0 ? px[row - stride + x]! : 0;
      const c = x >= channels && y > 0 ? px[row - stride + x - channels]! : 0;
      let pred = 0;
      if (filter === 1) pred = a;
      else if (filter === 2) pred = b;
      else if (filter === 3) pred = (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (filter !== 0) throw new Error(`bad PNG row filter ${filter}`);
      px[row + x] = (raw[src + x]! + pred) & 255;
    }
  }
  const rgba = new Uint8Array(width * height * 4);
  const grey = channels <= 2;
  for (let i = 0; i < width * height; i++) {
    const s = i * channels;
    rgba[i * 4] = px[s]!;
    rgba[i * 4 + 1] = grey ? px[s]! : px[s + 1]!;
    rgba[i * 4 + 2] = grey ? px[s]! : px[s + 2]!;
    rgba[i * 4 + 3] = channels === 2 ? px[s + 1]! : channels === 4 ? px[s + 3]! : 255;
  }
  return { width, height, rgba };
}
