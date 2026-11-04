import { describe, expect, it } from "vitest";
import { PLACEHOLDERS } from "../src/arm/inputs.ts";
import { buildProfile } from "../src/arm/profile.ts";
import type { LayoutElement } from "../src/layout/schema.ts";
import { pickElement, resolveElement } from "../src/layout/shapes.ts";

const profile = buildProfile(PLACEHOLDERS);
const fig = (id: string, u: number, v: number, h: number): LayoutElement => ({
  type: "figure",
  id,
  position: { u, v },
  size_cm: { h, w: h },
});

describe("pickElement", () => {
  const els = [fig("big", 0.5, 0.5, 20), fig("small", 0.5, 0.5, 4), fig("other", 0, 0.2, 6)];
  const resolved = els.map((e) => resolveElement(e, profile));

  it("returns the topmost element at the point", () => {
    expect(pickElement(resolved, profile, 0.5, 0.5)).toBe(1);
  });

  it("falls through to lower elements outside the top one", () => {
    expect(pickElement(resolved, profile, 0.5, 0.5 + 6 / profile.length)).toBe(0);
  });

  it("finds elements across the seam and returns null on open skin", () => {
    expect(pickElement(resolved, profile, 0.99, 0.2)).toBe(2);
    expect(pickElement(resolved, profile, 0.25, 0.9)).toBeNull();
  });
});
