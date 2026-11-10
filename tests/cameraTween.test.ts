import { describe, expect, it } from "vitest";
import { cameraTween, easeOutCubic, interpolatePose, type CameraPose } from "../src/viewer/cameraTween.ts";

const front: CameraPose = { position: [0, 30, 100], target: [0, 30, 0] };
const back: CameraPose = { position: [0, 30, -100], target: [0, 30, 0] };
const lateral: CameraPose = { position: [80, 40, 0], target: [0, 40, 0] };

const dist = (p: CameraPose) =>
  Math.hypot(p.position[0] - p.target[0], p.position[1] - p.target[1], p.position[2] - p.target[2]);

describe("camera tween", () => {
  it("eases out and clamps", () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(2)).toBe(1);
    expect(easeOutCubic(-1)).toBe(0);
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5);
  });

  it("ends exactly on the target pose", () => {
    expect(interpolatePose(front, lateral, 1)).toEqual(lateral);
    const tw = cameraTween(front, lateral, 1000, 400);
    expect(tw.at(1400)).toEqual({ pose: lateral, done: true });
    expect(tw.at(5000).pose).toEqual(lateral);
    expect(tw.at(1200).done).toBe(false);
  });

  it("swings around the target instead of cutting through the model", () => {
    for (const t of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      const p = interpolatePose(front, back, t);
      expect(dist(p)).toBeCloseTo(100, 6);
    }
    // Half way from front to back is beside the model, not inside it.
    const mid = interpolatePose(front, back, 0.5);
    expect(Math.abs(mid.position[0])).toBeCloseTo(100, 6);
  });

  it("takes the shorter way round and glides target and distance", () => {
    const left: CameraPose = { position: [-80, 40, 0], target: [0, 40, 0] };
    // Lateral (+X) to medial (-X) through the front or back, never a full turn: x shrinks steadily.
    const q = interpolatePose(lateral, left, 0.25);
    expect(q.position[0]).toBeLessThan(80);
    expect(q.position[0]).toBeGreaterThan(0);
    const m = interpolatePose(front, lateral, 0.5);
    expect(m.target[1]).toBeCloseTo(35, 6);
    expect(dist(m)).toBeCloseTo(90, 6);
  });

  it("jumps when the duration is zero (reduced motion)", () => {
    expect(cameraTween(front, back, 0, 0).at(0)).toEqual({ pose: back, done: true });
  });
});
