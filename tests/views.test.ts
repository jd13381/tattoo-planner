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

describe("fixed views of a bent arm", () => {
  const profile = buildProfile(PLACEHOLDERS);
  const box = { min: [-5, 20, -5] as [number, number, number], max: [5, 60, 35] as [number, number, number] };

  it("centres on the box and keeps the forearm in front of the camera", () => {
    const front = viewCamera(profile, "front", 1, 1.25, box);
    expect(front.target).toEqual([0, 40, 15]);
    // Far enough that the forearm pointing at the camera stays well beyond the near plane.
    expect(front.position[2] - box.max[2]).toBeGreaterThan(40);
    const lateral = viewCamera(profile, "lateral", 1, 1.25, box);
    expect(lateral.position[0]).toBeGreaterThan(0);
    // From the side the 40 cm of forearm is across the screen: a narrow screen backs off further.
    expect(viewCamera(profile, "lateral", 0.3, 1.25, box).position[0]).toBeGreaterThan(lateral.position[0]);
  });
});
