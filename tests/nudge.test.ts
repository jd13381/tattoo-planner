import { describe, expect, it } from "vitest";
import { PLACEHOLDERS } from "../src/body/inputs.ts";
import { buildProfile } from "../src/body/profile.ts";
import { uToCm } from "../src/body/uv.ts";
import {
  cmToDelta,
  elementAnchor,
  formatPointCm,
  formatPositionCm,
  nudgeElement,
  nudgeStepCm,
  nudgeUV,
  NUDGE_BIG_CM,
  NUDGE_CM,
  positionCm,
} from "../src/editor/nudge.ts";
import type { LayoutElement } from "../src/layout/schema.ts";

const profile = buildProfile(PLACEHOLDERS);
const L = profile.length;
const fig = (u: number, v: number): LayoutElement => ({
  type: "figure",
  id: "f",
  position: { u, v },
  size_cm: { h: 10 },
});

describe("cm to u/v", () => {
  it("scales u by the local circumference", () => {
    const atWrist = cmToDelta(profile, 0, 1, 0).du;
    const atShoulder = cmToDelta(profile, 1, 1, 0).du;
    expect(atWrist).toBeCloseTo(-1 / profile.circumferenceAt(0));
    expect(Math.abs(atWrist)).toBeGreaterThan(Math.abs(atShoulder));
    expect(cmToDelta(profile, 0.5, 0, 3).dv).toBeCloseTo(3 / L);
  });

  it("moves right towards medial on the skin, as the editor draws it", () => {
    const p = { u: 0, v: 0.5 };
    const q = nudgeUV(profile, p, 2, 0);
    expect(uToCm(profile, q.u, q.v)).toBeCloseTo(-2);
    const r = nudgeUV(profile, p, -2, 0);
    expect(uToCm(profile, r.u, r.v)).toBeCloseTo(2);
  });

  it("moves up towards the shoulder, wraps u and clamps v", () => {
    expect(nudgeUV(profile, { u: 0.3, v: 0.5 }, 0, 6).v).toBeCloseTo(0.5 + 6 / L);
    expect(nudgeUV(profile, { u: 0.3, v: 0.99 }, 0, 6).v).toBe(1);
    expect(nudgeUV(profile, { u: 0.3, v: 0.01 }, 0, -6).v).toBe(0);
    const w = nudgeUV(profile, { u: 0.001, v: 0.5 }, 1, 0);
    expect(w.u).toBeGreaterThan(0.9);
  });

  it("maps arrow steps to cm", () => {
    expect(nudgeStepCm(1, 0, false)).toEqual({ dxCm: NUDGE_CM, dyCm: 0 });
    expect(nudgeStepCm(0, -1, true)).toEqual({ dxCm: 0, dyCm: -NUDGE_BIG_CM });
    expect(NUDGE_CM).toBe(0.5);
    expect(NUDGE_BIG_CM).toBe(2);
  });
});

describe("nudgeElement", () => {
  it("moves a figure by about the asked cm", () => {
    const el = nudgeElement(fig(0.1, 0.4), profile, 0, NUDGE_BIG_CM);
    if (el.type !== "figure") throw new Error("type");
    expect((el.position.v - 0.4) * L).toBeCloseTo(2, 1);
    const side = nudgeElement(fig(0.1, 0.4), profile, -NUDGE_BIG_CM, 0);
    if (side.type !== "figure") throw new Error("type");
    const moved = uToCm(profile, side.position.u, 0.4) - uToCm(profile, 0.1, 0.4);
    expect(moved).toBeCloseTo(2, 1);
  });

  it("moves bands only along the arm and fillers as a whole", () => {
    const band: LayoutElement = { type: "band", id: "b", pattern: "meander", v: 0.5, width_cm: 2 };
    const b = nudgeElement(band, profile, 5, 0);
    expect(b).toEqual(band);
    const filler: LayoutElement = {
      type: "filler",
      id: "x",
      pattern: "snake-scales",
      region: { u: [0.95, 0.05], v: [0.2, 0.4] },
      density: 0.3,
    };
    expect(elementAnchor(filler).u).toBeCloseTo(0);
    expect(elementAnchor(filler).v).toBeCloseTo(0.3);
    const f = nudgeElement(filler, profile, 0, -6);
    if (f.type !== "filler") throw new Error("type");
    expect(f.region.v[1] - f.region.v[0]).toBeCloseTo(0.2);
    expect(f.region.u).toEqual([0.95, 0.05]);
  });
});

describe("positionCm", () => {
  it("reads distance around from the outer line and along from the wrist", () => {
    const c = profile.circumferenceAt(0.5 * L);
    const p = positionCm(profile, { u: 3 / c, v: 0.5 });
    expect(p).toEqual({ aroundCm: 3, side: "lateral", fromWristCm: Math.round(0.5 * L * 10) / 10 });
    expect(positionCm(profile, { u: 1 - 3 / c, v: 0.5 }).side).toBe("medial");
    expect(positionCm(profile, { u: 0, v: 0 })).toEqual({ aroundCm: 0, side: "outer", fromWristCm: 0 });
  });

  it("formats a label", () => {
    const c = profile.circumferenceAt(0.2 * L);
    expect(formatPositionCm(profile, fig(2 / c, 0.2))).toBe(
      `≈ 2.0 cm lateral of the outer line · ${(0.2 * L).toFixed(1)} cm from the wrist`,
    );
    expect(formatPositionCm(profile, fig(0, 0))).toBe("≈ on the outer line · 0.0 cm from the wrist");
    const band: LayoutElement = { type: "band", id: "b", pattern: "meander", v: 0.5, width_cm: 2 };
    expect(formatPositionCm(profile, band)).toBe(`≈ ${(0.5 * L).toFixed(1)} cm from the wrist`);
  });
});

describe("formatPointCm", () => {
  it("formats a point for the status bar", () => {
    const c = profile.circumferenceAt(0.5 * L);
    expect(formatPointCm(profile, { u: 1 - 3 / c, v: 0.5 })).toBe(
      `3.0 cm medial · ${(0.5 * L).toFixed(1)} cm from wrist`,
    );
    expect(formatPointCm(profile, { u: 0, v: 0 })).toBe("on the outer line · 0.0 cm from wrist");
  });
});
