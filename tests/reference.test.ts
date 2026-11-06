import { describe, expect, it } from "vitest";
import { PLACEHOLDERS } from "../src/body/inputs.ts";
import { buildProfile } from "../src/body/profile.ts";
import type { LayoutElement } from "../src/layout/schema.ts";
import { classify, resolveElement } from "../src/layout/shapes.ts";
import {
  featherEdges,
  grayscale,
  lineScreen,
  luminanceQuantile,
  processPixels,
} from "../src/render/imageOps.ts";
import { missingReason } from "../src/render/reference.ts";
import { rowRange, screenX, shapeMask, wrapStrip } from "../src/render/unwrapRows.ts";

const profile = buildProfile(PLACEHOLDERS);

describe("unwrap rows", () => {
  it("puts u lines where the editor puts them", () => {
    expect(screenX(0, 0, 20)).toBeCloseTo(0);
    expect(screenX(0.25, 0, 20)).toBeCloseTo(-5); // lateral on the left
    expect(screenX(0.75, 0, 20)).toBeCloseTo(5);
    expect(screenX(0.5, 0.5, 20)).toBeCloseTo(0);
  });

  it("keeps a strip whole away from the seam", () => {
    expect(wrapStrip(0, -2, 2, 20)).toEqual([{ from: -2, to: 2, at: -2 }]);
  });

  it("splits a strip that crosses the seam onto both edges", () => {
    // Centre 1 cm left of the right edge: 1 cm stays, 1 cm re-enters on the left edge.
    const pieces = wrapStrip(9, -2, 2, 20);
    expect(pieces).toHaveLength(2);
    const right = pieces.find((p) => p.at > 0)!;
    const left = pieces.find((p) => p.at < 0)!;
    expect(right).toEqual({ from: -2, to: 1, at: 7 });
    expect(left.from).toBeCloseTo(1);
    expect(left.to).toBeCloseTo(2);
    expect(left.at).toBeCloseTo(-10);
  });

  it("drops what would reach round the arm onto itself", () => {
    const pieces = wrapStrip(0, -15, 15, 20);
    expect(pieces).toEqual([{ from: -10, to: 10, at: -10 }]);
  });

  it("finds the texture rows of a y range (row 0 = shoulder)", () => {
    const ppc = 4;
    const [first, last] = rowRange(profile, ppc, 0, 1);
    const height = Math.ceil(profile.length * ppc);
    expect(last).toBe(height - 1);
    expect(first).toBeGreaterThanOrEqual(height - 6);
  });

  it("masks a shape exactly as the classification does, seam included", () => {
    const elements: LayoutElement[] = [
      { id: "anubis", type: "existing", position: { u: 0.5, v: 0.2 }, size_cm: { h: 20, w: 10 } },
      { id: "b", type: "band", pattern: "meander", v: 0.02, width_cm: 2 },
      {
        id: "l",
        type: "line",
        // Crosses the inner seam between the last two points.
        points: [
          { u: 0.05, v: 0 },
          { u: 0.15, v: 0.4 },
          { u: 0.45, v: 0.6 },
          { u: 0.55, v: 0.9 },
        ],
        width_cm: 1.5,
      },
    ];
    for (const centerU of [0, 0.5]) {
      const ppc = 3;
      for (const el of elements) {
        const cls = classify({ name: "t", elements: [el] }, profile, ppc, undefined, centerU);
        const shape = resolveElement(el, profile).shape;
        const mask = shapeMask(shape, profile, ppc, centerU);
        let diff = 0;
        let inside = 0;
        for (let r = 0; r < mask.rows; r++)
          for (let i = 0; i < mask.width; i++) {
            const a = mask.alpha[r * mask.width + i] === 255;
            const b = cls.cells[(mask.rowStart + r) * cls.width + i] === 1;
            if (a !== b) diff++;
            if (a) inside++;
          }
        expect(inside).toBeGreaterThan(100);
        expect(diff).toBe(0);
      }
    }
  });
});

describe("image operations", () => {
  const px = (...values: number[][]) => new Uint8ClampedArray(values.flat());

  it("finds the white point from the bright majority", () => {
    const data = px(...Array.from({ length: 9 }, () => [200, 200, 200, 255]), [10, 10, 10, 255]);
    expect(luminanceQuantile(data, 0.9)).toBe(200);
    expect(luminanceQuantile(px([0, 0, 0, 0]), 0.9)).toBe(255);
  });

  it("turns colour into stretched grayscale", () => {
    const data = px([200, 200, 200, 255], [100, 50, 0, 255]);
    grayscale(data, 200);
    expect([...data.slice(0, 4)]).toEqual([255, 255, 255, 255]);
    expect(data[4]).toBe(data[5]);
    expect(data[4]).toBe(data[6]);
  });

  it("draws more ink where the image is darker", () => {
    const n = 16 * 16;
    const ink = (gray: number) => {
      const d = new Uint8ClampedArray(n * 4).fill(gray);
      lineScreen(d, 16, 4);
      let count = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i]! < 128) count++;
      return count / n;
    };
    expect(ink(255)).toBe(0);
    expect(ink(0)).toBe(1);
    expect(ink(64)).toBeGreaterThan(ink(192));
  });

  it("feathers the border and leaves the middle opaque", () => {
    const w = 20;
    const d = new Uint8ClampedArray(w * w * 4).fill(255);
    featherEdges(d, w, w, 5);
    const alpha = (x: number, y: number) => d[(y * w + x) * 4 + 3]!;
    expect(alpha(10, 10)).toBe(255);
    expect(alpha(0, 10)).toBeLessThan(10);
    expect(alpha(2, 10)).toBeGreaterThan(alpha(0, 10));
    expect(alpha(2, 10)).toBeLessThan(255);
  });

  it("leaves colour alone with filter none and no feather", () => {
    const d = px([10, 120, 230, 255]);
    processPixels(d, 1, 1, { filter: "none", featherPx: 0, hatchPeriodPx: 3 });
    expect([...d]).toEqual([10, 120, 230, 255]);
  });
});

describe("placeholders", () => {
  const el = { id: "skull", type: "figure", position: { u: 0, v: 0.5 }, size_cm: { h: 10 } } as const;
  const assets = new Map([
    [
      "skull-ref",
      {
        id: "skull-ref",
        file: "refs/s.jpg",
        kind: "reference",
        tags: [],
        exists: true,
        effectiveCategory: "reference" as const,
        effectivePerson: null,
      },
    ],
    [
      "gone",
      {
        id: "gone",
        file: "refs/g.jpg",
        kind: "reference",
        tags: [],
        exists: false,
        effectiveCategory: "reference" as const,
        effectivePerson: null,
      },
    ],
  ]);

  it("names the reason an image is not shown", () => {
    const base = { assets, images: new Map(), aspects: new Map() };
    expect(missingReason(el, base)).toBe("no asset");
    expect(missingReason({ ...el, asset: "x" }, { ...base, assets: null })).toBe("no data folder");
    expect(missingReason({ ...el, asset: "x" }, base)).toContain("not in manifest");
    expect(missingReason({ ...el, asset: "gone" }, base)).toContain("file missing");
    expect(missingReason({ ...el, asset: "skull-ref" }, base)).toBe("loading…");
    const err = new Map([["skull-ref", { status: "error" as const, message: "HTTP 415" }]]);
    expect(missingReason({ ...el, asset: "skull-ref" }, { ...base, images: err })).toBe("HTTP 415");
  });
});
