import { describe, expect, it } from "vitest";
import { imagePlacement } from "../src/editor/viewBox.ts";

describe("imagePlacement", () => {
  it("fills the element when aspect ratios match", () => {
    const r = imagePlacement({ x: 0, y: 0, w: 10, h: 20 }, { w: 100, h: 200 }, { x: 0, y: 0, w: 10, h: 20 });
    expect(r).toEqual({ x: 0, y: 0, w: 100, h: 200 });
  });

  it("centres horizontally when the element is wider (meet)", () => {
    const r = imagePlacement(
      { x: -5, y: 0, w: 10, h: 20 },
      { w: 300, h: 200 },
      { x: -5, y: 0, w: 10, h: 20 },
    );
    expect(r).toEqual({ x: 100, y: 0, w: 100, h: 200 });
  });

  it("follows pan and zoom of the viewBox", () => {
    // Zoomed in on the top-left quarter: the target appears twice as large, shifted.
    const r = imagePlacement({ x: 0, y: 0, w: 5, h: 10 }, { w: 100, h: 200 }, { x: 0, y: 0, w: 10, h: 20 });
    expect(r).toEqual({ x: 0, y: 0, w: 200, h: 400 });
    const p = imagePlacement({ x: 2, y: 4, w: 10, h: 20 }, { w: 100, h: 200 }, { x: 0, y: 0, w: 10, h: 20 });
    expect(p).toEqual({ x: -20, y: -40, w: 100, h: 200 });
  });

  it("returns an empty box before layout", () => {
    expect(imagePlacement({ x: 0, y: 0, w: 10, h: 10 }, { w: 0, h: 0 }, { x: 0, y: 0, w: 1, h: 1 }).w).toBe(
      0,
    );
  });
});
