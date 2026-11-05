import { describe, expect, it } from "vitest";
import { PLACEHOLDERS } from "../src/body/inputs.ts";
import { buildProfile } from "../src/body/profile.ts";
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

describe("framing clear of floating panels", () => {
  it("cuts each panel away by the side that leaves the most room for the content", async () => {
    const { freeInsets } = await import("../src/viewer/views.ts");
    // A full-height inspector on the right and a coverage card bottom left (the Layout tab's 3D pane).
    const panels = [
      { x: 538, y: 12, w: 300, h: 832 },
      { x: 12, y: 600, w: 300, h: 244 },
    ];
    // A thin arm keeps the full height and moves right of the card; a wide torso keeps the width.
    const arm = freeInsets(850, 856, panels, 0.2);
    expect(arm.right).toBe(850 - 530);
    expect(arm.left).toBe(320);
    expect(arm.bottom).toBe(0);
    const torso = freeInsets(850, 856, panels, 1.1);
    expect(torso.left).toBe(0);
    expect(torso.bottom).toBe(856 - 592);
    // No panels: the whole canvas.
    expect(freeInsets(400, 300, [], 1)).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });

  it("fits the bounds into the free part and shifts the picture into it", async () => {
    const { fitCamera } = await import("../src/viewer/views.ts");
    const b = {
      min: [-20, 0, -10] as [number, number, number],
      max: [20, 45, 10] as [number, number, number],
    };
    const full = fitCamera(b, [0, 0, 1], 800, 800);
    const half = fitCamera(b, [0, 0, 1], 800, 800, { top: 0, right: 400, bottom: 0, left: 0 });
    expect(full.offset).toEqual([0, 0]);
    expect(half.target).toEqual(full.target);
    expect(half.position[2]).toBeGreaterThan(full.position[2]);
    // Free part on the left: the picture moves left (the sub-window right).
    expect(half.offset).toEqual([200, 0]);
  });
});
