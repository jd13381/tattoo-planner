import { describe, expect, it } from "vitest";
import { PLACEHOLDERS } from "../src/body/inputs.ts";
import { buildProfile } from "../src/body/profile.ts";
import type { LayoutElement } from "../src/layout/schema.ts";
import { nextInCycle, pickAllElements, resolveElement } from "../src/layout/shapes.ts";

const profile = buildProfile(PLACEHOLDERS);
const fig = (id: string, u: number, v: number, h: number): LayoutElement => ({
  type: "figure",
  id,
  position: { u, v },
  size_cm: { h, w: h },
});

describe("pickAllElements", () => {
  const els = [fig("big", 0.5, 0.5, 20), fig("small", 0.5, 0.5, 4), fig("other", 0, 0.2, 6)];
  const resolved = els.map((e) => resolveElement(e, profile));

  it("returns every element at the point, topmost first", () => {
    expect(pickAllElements(resolved, profile, 0.5, 0.5)).toEqual([1, 0]);
    expect(pickAllElements(resolved, profile, 0.5, 0.5 + 6 / profile.length)).toEqual([0]);
    expect(pickAllElements(resolved, profile, 0.25, 0.9)).toEqual([]);
  });

  it("finds elements across the seam", () => {
    expect(pickAllElements(resolved, profile, 0.99, 0.2)).toEqual([2]);
  });
});

describe("nextInCycle", () => {
  it("steps through the stack and wraps", () => {
    expect(nextInCycle(["a", "b", "c"], "a")).toBe("b");
    expect(nextInCycle(["a", "b", "c"], "c")).toBe("a");
  });

  it("starts at the top when nothing or something else is selected", () => {
    expect(nextInCycle(["a", "b"], null)).toBe("a");
    expect(nextInCycle(["a", "b"], "z")).toBe("a");
    expect(nextInCycle([1, 0], 1)).toBe(0);
    expect(nextInCycle([], "a")).toBeNull();
  });
});
