import { describe, expect, it } from "vitest";
import { applyBuiltin, BUILTIN_OPS, cleanParams, defaultParams, describeStep } from "../src/edits/builtin.ts";
import {
  blurChannel,
  borderColour,
  flipHorizontal,
  grayscale,
  invert,
  levels,
  makePixels,
  removeBackground,
  rotate,
  threshold,
  type Pixels,
} from "../src/render/builtinOps.ts";

type RGBA = [number, number, number, number];

/** An image from rows of RGBA pixels. */
function image(rows: RGBA[][]): Pixels {
  const img = makePixels(rows[0]!.length, rows.length);
  rows.flat().forEach((px, i) => img.data.set(px, i * 4));
  return img;
}

function px(img: Pixels, x: number, y: number): RGBA {
  const i = (y * img.width + x) * 4;
  return [...img.data.slice(i, i + 4)] as RGBA;
}

const R: RGBA = [255, 0, 0, 255];
const G: RGBA = [0, 255, 0, 255];
const B: RGBA = [0, 0, 255, 255];
const K: RGBA = [0, 0, 0, 255];
const W: RGBA = [255, 255, 255, 255];

/** w × h filled with `bg`, with a `fg` rectangle from (x0, y0) to (x1, y1) inclusive. */
function withSquare(
  w: number,
  h: number,
  bg: RGBA,
  fg: RGBA,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
) {
  return image(
    Array.from({ length: h }, (_, y) =>
      Array.from({ length: w }, (_, x) => (x >= x0 && x <= x1 && y >= y0 && y <= y1 ? fg : bg)),
    ),
  );
}

describe("rotate and flip", () => {
  const src = image([
    [R, G, B],
    [K, W, K],
  ]);
  it("turns clockwise, anticlockwise and half way, swapping the size for quarter turns", () => {
    const cw = rotate(src, 1);
    expect([cw.width, cw.height]).toEqual([2, 3]);
    // The left column (bottom to top) becomes the top row.
    expect([px(cw, 0, 0), px(cw, 1, 0)]).toEqual([K, R]);
    expect([px(cw, 0, 2), px(cw, 1, 2)]).toEqual([K, B]);
    const ccw = rotate(src, 3);
    expect([px(ccw, 0, 0), px(ccw, 1, 0)]).toEqual([B, K]);
    expect(rotate(src, -1)).toEqual(ccw);
    const half = rotate(src, 2);
    expect([half.width, half.height]).toEqual([3, 2]);
    expect(px(half, 0, 0)).toEqual(K);
    expect(px(half, 2, 1)).toEqual(R);
    expect(rotate(rotate(cw, 1), 2)).toEqual(src);
    expect(rotate(src, 4)).toEqual(src);
  });
  it("mirrors left to right and leaves the input alone", () => {
    const before = new Uint8ClampedArray(src.data);
    const f = flipHorizontal(src);
    expect([px(f, 0, 0), px(f, 1, 0), px(f, 2, 0)]).toEqual([B, G, R]);
    expect(flipHorizontal(f)).toEqual(src);
    expect(src.data).toEqual(before);
  });
});

describe("tone operations", () => {
  it("grayscale uses luminance and keeps alpha", () => {
    const g = grayscale(image([[[0, 255, 0, 100], W]]));
    expect(px(g, 0, 0)).toEqual([182, 182, 182, 100]);
    expect(px(g, 1, 0)).toEqual(W);
  });
  it("invert flips the colours, not the alpha", () => {
    expect(px(invert(image([[[10, 200, 255, 7]]])), 0, 0)).toEqual([245, 55, 0, 7]);
  });
  it("levels stretches black to white point and applies gamma", () => {
    const img = image([
      [
        [20, 50, 80, 255],
        [100, 235, 250, 9],
      ],
    ]);
    const l = levels(img, { black: 50, white: 150 });
    expect(px(l, 0, 0)).toEqual([0, 0, 77, 255]);
    expect(px(l, 1, 0)).toEqual([128, 255, 255, 9]);
    // Gamma 2 brightens the midtones: 0.5 → 0.707.
    expect(px(levels(img, { black: 50, white: 150, gamma: 2 }), 1, 0)[0]).toBe(180);
    // A white point at or below the black point does not divide by zero.
    expect(px(levels(img, { black: 100, white: 90 }), 1, 0)[0]).toBe(0);
  });
});

describe("threshold", () => {
  it("turns pixels black or white by luminance and keeps alpha", () => {
    const t = threshold(
      image([
        [
          [100, 100, 100, 255],
          [200, 200, 200, 255],
          [0, 0, 0, 0],
        ],
      ]),
      { level: 128 },
    );
    expect(px(t, 0, 0)).toEqual(K);
    expect(px(t, 1, 0)).toEqual(W);
    // Transparent pixels count as paper, and stay transparent.
    expect(px(t, 2, 0)).toEqual([255, 255, 255, 0]);
  });
  it("smoothing drops a single dark speck but keeps a large shape", () => {
    const img = withSquare(21, 21, W, K, 4, 4, 14, 14);
    img.data.set(K, (18 * 21 + 18) * 4); // speck
    const sharp = threshold(img, { level: 128 });
    expect(px(sharp, 18, 18)).toEqual(K);
    const smooth = threshold(img, { level: 128, smoothPx: 3 });
    expect(px(smooth, 18, 18)).toEqual(W);
    expect(px(smooth, 9, 9)).toEqual(K);
  });
});

describe("blurChannel", () => {
  it("keeps a flat channel flat and the total roughly the same", () => {
    const flat = new Float32Array(25).fill(3);
    expect([...blurChannel(flat, 5, 5, 3)].every((v) => Math.abs(v - 3) < 1e-5)).toBe(true);
    const spike = new Float32Array(81);
    spike[40] = 81;
    const b = blurChannel(spike, 9, 9, 3);
    expect(b[40]!).toBeLessThan(81);
    expect(b[40]!).toBeGreaterThan(b[0]!);
    expect(b.reduce((a, v) => a + v, 0)).toBeCloseTo(81, 3);
  });
});

describe("removeBackground", () => {
  const offWhite: RGBA = [250, 248, 245, 255];
  it("estimates the background from the border", () => {
    expect(borderColour(withSquare(6, 6, offWhite, K, 2, 2, 3, 3))).toEqual([250, 248, 245]);
    expect(borderColour(image([[[0, 0, 0, 0]]]))).toBeNull();
  });
  it("clears the connected background and keeps the motif and enclosed holes", () => {
    // A black ring with an off-white hole inside, on an off-white background with slight noise.
    const img = withSquare(9, 9, offWhite, K, 2, 2, 6, 6);
    img.data.set(offWhite, (4 * 9 + 4) * 4);
    img.data.set([240, 240, 240, 255], (0 * 9 + 8) * 4);
    const out = removeBackground(img, { tolerance: 16 });
    expect(px(out, 0, 0)[3]).toBe(0);
    expect(px(out, 8, 0)[3]).toBe(0);
    expect(px(out, 2, 2)).toEqual(K);
    // The hole is not connected to the border, so it stays.
    expect(px(out, 4, 4)).toEqual(offWhite);
    // With no tolerance the noisy pixel stays.
    expect(px(removeBackground(img, { tolerance: 0 }), 8, 0)[3]).toBe(255);
    expect(px(img, 0, 0)[3]).toBe(255);
  });
  it("feathers the alpha on the kept side only", () => {
    const img = withSquare(30, 30, W, R, 5, 5, 24, 24);
    const out = removeBackground(img, { tolerance: 10, featherPx: 6 });
    expect(px(out, 2, 2)[3]).toBe(0);
    const edge = px(out, 5, 15)[3];
    expect(edge).toBeGreaterThan(0);
    expect(edge).toBeLessThan(255);
    expect(px(out, 15, 15)[3]).toBe(255);
    expect(px(out, 5, 15).slice(0, 3)).toEqual([255, 0, 0]);
  });
  it("treats pixels that are transparent already as background", () => {
    const clear: RGBA = [0, 0, 0, 0];
    const img = withSquare(5, 5, clear, W, 1, 1, 3, 3);
    // Border is all transparent, so the white square is kept even though it is "white".
    const out = removeBackground(img, { tolerance: 50 });
    expect(px(out, 2, 2)).toEqual(W);
  });
});

describe("built-in catalogue", () => {
  it("has at most two controls per operation, with defaults inside their range", () => {
    for (const op of BUILTIN_OPS) {
      expect(op.params.length).toBeLessThanOrEqual(2);
      for (const p of op.params)
        if (p.kind === "range") expect(p.default).toBeGreaterThanOrEqual(p.min);
        else expect(p.options.map((o) => o.value)).toContain(p.default);
    }
  });
  it("clamps parameters and fills in defaults", () => {
    expect(cleanParams("threshold", { level: 999 })).toEqual({ level: 254, smooth: 1 });
    expect(cleanParams("rotate", { turns: 7 })).toEqual({ turns: 1 });
    expect(defaultParams("grayscale")).toEqual({});
  });
  it("names each step for the version strip and the notes", () => {
    expect(describeStep("threshold", { level: 100, smooth: 2 })).toBe("Line art (level 100, smoothing 2 px)");
    expect(describeStep("rotate", { turns: 3 })).toBe("Rotate 90° left");
    expect(describeStep("flip")).toBe("Mirror");
    expect(describeStep("remove-background")).toBe("Remove background (tolerance 32, soft edge 2 px)");
  });
  it("applies every operation", () => {
    const img = withSquare(8, 6, W, K, 2, 2, 5, 3);
    for (const op of BUILTIN_OPS) {
      const out = applyBuiltin(img, op.id, defaultParams(op.id));
      expect(out.data.length).toBe(img.data.length);
    }
    expect(applyBuiltin(img, "rotate", { turns: 1 }).width).toBe(6);
    expect(px(applyBuiltin(img, "remove-background", { feather: 0 }), 0, 0)[3]).toBe(0);
  });
});
