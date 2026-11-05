import { describe, expect, it } from "vitest";
import { PLACEHOLDERS } from "../src/body/inputs.ts";
import { buildProfile } from "../src/body/profile.ts";
import type { Layout } from "../src/layout/schema.ts";
import { classify } from "../src/layout/shapes.ts";
import { blockoutPixels } from "../src/render/blockout.ts";

const profile = buildProfile(PLACEHOLDERS);
const existing = { height: 26, width: 12 };

describe("blockout outline", () => {
  it("does not outline an existing tattoo along the inner seam it crosses", () => {
    const layout: Layout = {
      name: "seam",
      elements: [{ type: "existing", id: "anubis", position: { u: 0.5, v: 0.3 }, size_cm: { h: 10, w: 6 } }],
    };
    const cls = classify(layout, profile, 4, existing);
    const px = blockoutPixels(cls);
    const row = Math.round(cls.height * 0.7); // through the middle of the box (row 0 = shoulder)
    // The skin's first and last pixel in that row: inside the tattoo, so its light fill, not the outline.
    let first = -1;
    let last = -1;
    for (let i = 0; i < cls.width; i++)
      if (cls.cells[row * cls.width + i] !== 255) {
        if (first < 0) first = i;
        last = i;
      }
    for (const i of [first, last]) expect(px[(row * cls.width + i) * 4]).toBe(222);
  });
});
