import { describe, expect, it } from "vitest";
import { PLACEHOLDERS } from "../src/arm/inputs.ts";
import { buildProfile } from "../src/arm/profile.ts";
import { viewCamera, VIEWS } from "../src/viewer/views.ts";

describe("fixed views", () => {
  const profile = buildProfile(PLACEHOLDERS);

  it("looks at the middle of the arm from the four sides", () => {
    const front = viewCamera(profile, "front");
    expect(front.target).toEqual([0, 30, 0]);
    expect(front.position[2]).toBeGreaterThan(0);
    expect(viewCamera(profile, "back").position[2]).toBeLessThan(0);
    expect(viewCamera(profile, "lateral").position[0]).toBeGreaterThan(0);
    expect(viewCamera(profile, "medial").position[0]).toBeLessThan(0);
    expect(VIEWS.map((v) => v.name)).toEqual(["front", "back", "medial", "lateral"]);
  });

  it("backs off further on narrow screens", () => {
    const wide = viewCamera(profile, "front", 2).position[2];
    const narrow = viewCamera(profile, "front", 0.2).position[2];
    expect(narrow).toBeGreaterThan(wide);
  });
});
