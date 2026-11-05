import { describe, expect, it } from "vitest";
import { PLACEHOLDERS } from "../src/body/inputs.ts";
import { buildProfile } from "../src/body/profile.ts";
import { gridLines } from "../src/render/cmGrid.ts";

const profile = buildProfile(PLACEHOLDERS);

describe("cm grid", () => {
  const lines = gridLines(profile);

  it("draws a ring every cm from wrist to shoulder, bold every 5 cm", () => {
    const rings = lines.filter((l) => l.points.length === 2);
    expect(rings).toHaveLength(61);
    expect(rings.filter((l) => l.weight === "major")).toHaveLength(13);
  });

  it("keeps lengthwise lines on the skin", () => {
    for (const line of lines.filter((l) => l.points.length > 2 && l.weight !== "axis")) {
      for (const p of line.points)
        expect(Math.abs(p.x)).toBeLessThanOrEqual(profile.circumferenceAt(p.y) / 2 + 1e-9);
    }
  });

  it("marks the four centre lines, with the inner seam on both edges", () => {
    const axes = lines.filter((l) => l.weight === "axis").map((l) => l.label);
    expect(axes).toEqual(["outer", "lateral", "medial", "inner", "inner"]);
  });
});
