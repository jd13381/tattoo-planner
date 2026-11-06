import { describe, expect, it } from "vitest";
import { PICKER_MARGIN, PICKER_MAX, pickerBox } from "../src/assets/pickerPlacement.ts";

const inside = (b: ReturnType<typeof pickerBox>, vw: number, vh: number) => {
  expect(b.left).toBeGreaterThanOrEqual(PICKER_MARGIN);
  expect(b.top).toBeGreaterThanOrEqual(PICKER_MARGIN);
  expect(b.left + b.width).toBeLessThanOrEqual(vw - PICKER_MARGIN);
  expect(b.top + b.height).toBeLessThanOrEqual(vh - PICKER_MARGIN);
};

describe("image picker placement", () => {
  it("opens at full size left of the inspector's button on a laptop screen", () => {
    const b = pickerBox({ left: 1100, right: 1380, top: 400 }, 1440, 900);
    expect(b.width).toBe(PICKER_MAX.width);
    expect(b.height).toBe(PICKER_MAX.height);
    expect(b.left + b.width).toBeLessThanOrEqual(1100);
    inside(b, 1440, 900);
  });

  it("opens right of a button near the left edge", () => {
    const b = pickerBox({ left: 100, right: 200, top: 100 }, 1440, 900);
    expect(b.left).toBe(200 + PICKER_MARGIN);
    inside(b, 1440, 900);
  });

  it("shrinks to a small window and stays inside it", () => {
    for (const [vw, vh] of [
      [1280, 720],
      [800, 600],
      [390, 700],
    ] as const) {
      const b = pickerBox({ left: vw - 300, right: vw - 20, top: vh - 50 }, vw, vh);
      inside(b, vw, vh);
      expect(b.width).toBe(Math.min(PICKER_MAX.width, vw - 2 * PICKER_MARGIN));
      expect(b.height).toBe(Math.min(PICKER_MAX.height, vh - 2 * PICKER_MARGIN));
    }
  });
});
