import { describe, expect, it } from "vitest";
import { intersects, placeTag, scaleLabelZones } from "../src/editor/tagPlacement.ts";

describe("scaleLabelZones", () => {
  it("has one zone per 10 cm ring, right of the centre line and above the ring", () => {
    const zones = scaleLabelZones(55);
    expect(zones).toHaveLength(6);
    // The 20 cm ring of a 55 cm region lies at y = 35 in the editor (y runs down from the far end).
    const z20 = zones[2]!;
    expect(z20.x).toBeGreaterThan(0);
    expect(z20.y + z20.h).toBeCloseTo(35);
  });
});

describe("placeTag", () => {
  const size = { w: 4, h: 1 };

  it("sits above the left corner when nothing is in the way", () => {
    const tag = placeTag({ left: -10, right: -2, top: 20, bottom: 28 }, size, 0.3);
    expect(tag).toEqual({ x: -10, y: 18.7, w: 4, h: 1, corner: "above-left" });
  });

  it("moves to the right corner when the left one would cover a scale label", () => {
    // A box centred on the centre line whose top edge is the 20 cm ring: "20 cm" sits right there.
    const box = { left: -1, right: 9, top: 35, bottom: 45 };
    const tag = placeTag(box, size, 0.3, scaleLabelZones(55));
    expect(tag.corner).toBe("above-right");
    expect(tag.x).toBe(5);
    expect(scaleLabelZones(55).some((z) => intersects(tag, z))).toBe(false);
  });

  it("goes below the box when both upper corners are taken", () => {
    const box = { left: 0, right: 4, top: 35, bottom: 39.5 };
    const tag = placeTag(box, size, 0.3, scaleLabelZones(55));
    expect(tag.corner).toBe("below-left");
    expect(tag.y).toBeCloseTo(39.8);
  });

  it("falls back to above left when every corner is taken", () => {
    const everywhere = [{ x: -100, y: -100, w: 200, h: 200 }];
    expect(placeTag({ left: 0, right: 4, top: 10, bottom: 12 }, size, 0.3, everywhere).corner).toBe(
      "above-left",
    );
  });
});
