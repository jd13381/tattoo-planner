// Built-in image operations of the Image studio (docs/adr/0013-builtin-image-operations.md): simple,
// local edits that need no key and no network. Plain TypeScript on ImageData-like RGBA buffers
// (row-major, 4 bytes per pixel, not premultiplied), so they run in the browser and in unit tests
// alike. Every operation returns a new buffer and leaves its input unchanged.

/** An RGBA image; `ImageData` fits this type. */
export type Pixels = { width: number; height: number; data: Uint8ClampedArray };

export function makePixels(width: number, height: number): Pixels {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

function copyOf(img: Pixels): Pixels {
  return { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) };
}

/** Rec. 709 luminance, 0–255. */
const lum = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** Rotates by `turns` quarter turns clockwise (negative turns go anticlockwise). */
export function rotate(img: Pixels, turns: number): Pixels {
  const t = ((Math.round(turns) % 4) + 4) % 4;
  if (t === 0) return copyOf(img);
  const { width: w, height: h, data } = img;
  const out = t === 2 ? makePixels(w, h) : makePixels(h, w);
  const ow = out.width;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      // Clockwise: (x, y) → (h-1-y, x); half turn: (w-1-x, h-1-y); anticlockwise: (y, w-1-x).
      const [nx, ny] = t === 1 ? [h - 1 - y, x] : t === 2 ? [w - 1 - x, h - 1 - y] : [y, w - 1 - x];
      const s = (y * w + x) * 4;
      const d = (ny * ow + nx) * 4;
      out.data[d] = data[s]!;
      out.data[d + 1] = data[s + 1]!;
      out.data[d + 2] = data[s + 2]!;
      out.data[d + 3] = data[s + 3]!;
    }
  return out;
}

/** Mirrors left to right. */
export function flipHorizontal(img: Pixels): Pixels {
  const { width: w, height: h, data } = img;
  const out = makePixels(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const s = (y * w + x) * 4;
      const d = (y * w + (w - 1 - x)) * 4;
      for (let c = 0; c < 4; c++) out.data[d + c] = data[s + c]!;
    }
  return out;
}

/** Black and grey: every pixel becomes its luminance; alpha is kept. */
export function grayscale(img: Pixels): Pixels {
  const out = copyOf(img);
  const d = out.data;
  for (let i = 0; i < d.length; i += 4) d[i] = d[i + 1] = d[i + 2] = lum(d[i]!, d[i + 1]!, d[i + 2]!);
  return out;
}

/** Inverts the colours (negative); alpha is kept. */
export function invert(img: Pixels): Pixels {
  const out = copyOf(img);
  const d = out.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = 255 - d[i]!;
    d[i + 1] = 255 - d[i + 1]!;
    d[i + 2] = 255 - d[i + 2]!;
  }
  return out;
}

export type LevelsOptions = {
  /** Input value that becomes black (0–254). */
  black: number;
  /** Input value that becomes white (1–255, above `black`). */
  white: number;
  /** Midtone gamma; above 1 brightens, below 1 darkens. Default 1. */
  gamma?: number;
};

/** Levels on each colour channel: [black, white] is stretched to [0, 255], then gamma; alpha is kept. */
export function levels(img: Pixels, opts: LevelsOptions): Pixels {
  const black = Math.max(0, Math.min(254, opts.black));
  const white = Math.max(black + 1, Math.min(255, opts.white));
  const inv = 1 / Math.max(0.01, opts.gamma ?? 1);
  const table = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) {
    const t = Math.max(0, Math.min(1, (v - black) / (white - black)));
    table[v] = Math.round(255 * Math.pow(t, inv));
  }
  const out = copyOf(img);
  const d = out.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = table[d[i]!]!;
    d[i + 1] = table[d[i + 1]!]!;
    d[i + 2] = table[d[i + 2]!]!;
  }
  return out;
}

/**
 * Approximately Gaussian blur of one float channel: three box passes per axis whose combined reach
 * is about `radius` pixels. Edges are clamped. Returns a new array.
 */
export function blurChannel(
  src: Float32Array,
  width: number,
  height: number,
  radius: number,
): Float32Array<ArrayBuffer> {
  const r = Math.max(1, Math.round(radius / 3));
  let a = new Float32Array(src);
  let b = new Float32Array(src.length);
  const pass = (from: Float32Array, to: Float32Array, horizontal: boolean) => {
    const n = horizontal ? width : height;
    const lines = horizontal ? height : width;
    const stride = horizontal ? 1 : width;
    const k = 1 / (2 * r + 1);
    for (let line = 0; line < lines; line++) {
      const base = horizontal ? line * width : line;
      const at = (i: number) => from[base + Math.max(0, Math.min(n - 1, i)) * stride]!;
      let sum = 0;
      for (let i = -r; i <= r; i++) sum += at(i);
      for (let i = 0; i < n; i++) {
        to[base + i * stride] = sum * k;
        sum += at(i + r + 1) - at(i - r);
      }
    }
  };
  for (let p = 0; p < 3; p++) {
    pass(a, b, true);
    [a, b] = [b, a];
    pass(a, b, false);
    [a, b] = [b, a];
  }
  return a;
}

export type ThresholdOptions = {
  /** Luminance (0–255) below which a pixel becomes black ink. */
  level: number;
  /** Blur radius in pixels before the cut; smooths ragged contours and drops specks. 0 = none. */
  smoothPx?: number;
};

/**
 * Line art: every pixel becomes black or white by its luminance (transparent parts count as white
 * paper); alpha is kept, so a cut-out stays cut out.
 */
export function threshold(img: Pixels, opts: ThresholdOptions): Pixels {
  const { width: w, height: h } = img;
  const src = img.data;
  let v: Float32Array<ArrayBuffer> = new Float32Array(w * h);
  for (let p = 0, i = 0; p < v.length; p++, i += 4) {
    const a = src[i + 3]! / 255;
    v[p] = lum(src[i]!, src[i + 1]!, src[i + 2]!) * a + 255 * (1 - a);
  }
  if ((opts.smoothPx ?? 0) > 0) v = blurChannel(v, w, h, opts.smoothPx!);
  const out = copyOf(img);
  const d = out.data;
  for (let p = 0, i = 0; p < v.length; p++, i += 4) d[i] = d[i + 1] = d[i + 2] = v[p]! < opts.level ? 0 : 255;
  return out;
}

/** Pixels with alpha below this count as transparent already (background, whatever their colour). */
const CLEAR_ALPHA = 128;

/**
 * Colour of the background: the per-channel median of the opaque pixels on the image border. Null when
 * the whole border is transparent already.
 */
export function borderColour(img: Pixels): [number, number, number] | null {
  const { width: w, height: h, data } = img;
  const hist = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)] as const;
  let n = 0;
  const add = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    if (data[i + 3]! < CLEAR_ALPHA) return;
    for (let c = 0; c < 3; c++) hist[c]![data[i + c]!]!++;
    n++;
  };
  for (let x = 0; x < w; x++) {
    add(x, 0);
    if (h > 1) add(x, h - 1);
  }
  for (let y = 1; y < h - 1; y++) {
    add(0, y);
    if (w > 1) add(w - 1, y);
  }
  if (n === 0) return null;
  const median = (hc: Uint32Array) => {
    let acc = 0;
    for (let v = 0; v < 256; v++) if ((acc += hc[v]!) * 2 >= n) return v;
    return 255;
  };
  return [median(hist[0]), median(hist[1]), median(hist[2])];
}

export type RemoveBackgroundOptions = {
  /** Largest difference (0–255, on the channel that differs most) from the background colour. */
  tolerance: number;
  /** Width in pixels of the soft edge on the kept side of the cut. 0 = hard edge. */
  featherPx?: number;
};

/**
 * Background removal for scans and drawings on a plain background: a flood fill from the image border
 * takes every connected pixel within `tolerance` of the border colour (and every pixel that is
 * transparent already) and makes it transparent. Areas of the background colour enclosed by the motif
 * stay, as they are not connected to the border. A feathered edge softens the alpha along the cut.
 */
export function removeBackground(img: Pixels, opts: RemoveBackgroundOptions): Pixels {
  const { width: w, height: h, data } = img;
  const bg = borderColour(img);
  const tol = Math.max(0, opts.tolerance);
  const isBackground = (p: number) => {
    const i = p * 4;
    if (data[i + 3]! < CLEAR_ALPHA) return true;
    if (!bg) return false;
    return (
      Math.abs(data[i]! - bg[0]) <= tol &&
      Math.abs(data[i + 1]! - bg[1]) <= tol &&
      Math.abs(data[i + 2]! - bg[2]) <= tol
    );
  };
  // 0 = not visited, 1 = background (queued or done), 2 = visited and kept.
  const state = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  let head = 0;
  let tail = 0;
  const visit = (p: number) => {
    if (state[p] !== 0) return;
    if (isBackground(p)) {
      state[p] = 1;
      queue[tail++] = p;
    } else state[p] = 2;
  };
  for (let x = 0; x < w; x++) {
    visit(x);
    visit((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    visit(y * w);
    visit(y * w + w - 1);
  }
  while (head < tail) {
    const p = queue[head++]!;
    const x = p % w;
    if (x > 0) visit(p - 1);
    if (x < w - 1) visit(p + 1);
    if (p >= w) visit(p - w);
    if (p < w * (h - 1)) visit(p + w);
  }
  const out = copyOf(img);
  const d = out.data;
  const feather = opts.featherPx ?? 0;
  if (feather <= 0) {
    for (let p = 0; p < state.length; p++) if (state[p] === 1) d[p * 4 + 3] = 0;
    return out;
  }
  // Soft edge: blur the keep mask and scale the alpha of kept pixels by it, so the edge fades towards
  // the cut without bringing back any of the removed background.
  const mask = new Float32Array(w * h);
  for (let p = 0; p < mask.length; p++) mask[p] = state[p] === 1 ? 0 : 1;
  const soft = blurChannel(mask, w, h, feather);
  for (let p = 0; p < state.length; p++) {
    const i = p * 4 + 3;
    d[i] = state[p] === 1 ? 0 : Math.round(d[i]! * Math.min(1, soft[p]!));
  }
  return out;
}
