import { describe, expect, it } from "vitest";
import { motifKnockout } from "../src/render/backgrounds/composite.ts";

const px = (...p: number[][]) => new Uint8ClampedArray(p.flat());

describe("motifKnockout", () => {
  it("lets white paper and transparent pixels show the background", () => {
    const k = motifKnockout(px([255, 255, 255, 255], [245, 245, 240, 255], [0, 0, 0, 0]));
    expect(Array.from(k)).toEqual([0, 0, 0]);
  });

  it("fully covers the background under dark ink", () => {
    const k = motifKnockout(px([0, 0, 0, 255], [100, 100, 100, 255]));
    expect(k[0]).toBe(1);
    expect(k[1]).toBe(1);
  });

  it("covers partly under light shading and scales with alpha", () => {
    const k = motifKnockout(px([180, 180, 180, 255], [0, 0, 0, 128]));
    expect(k[0]).toBeGreaterThan(0.2);
    expect(k[0]).toBeLessThan(0.8);
    expect(k[1]).toBeCloseTo(128 / 255, 5);
  });
});
