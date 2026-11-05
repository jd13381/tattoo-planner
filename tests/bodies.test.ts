// Body regions, sample bodies, placement and per-region measurements (docs/adr/0011).
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { measuredRegionValues, resolveBody } from "../src/body/body.ts";
import { buildLoftMesh, surfacePoint } from "../src/body/geometry.ts";
import { INPUT_SECTIONS, measuredValues, PLACEHOLDERS, resolveInputs } from "../src/body/inputs.ts";
import { applyPlacement, applyRotation, type Vec3 } from "../src/body/placement.ts";
import { buildLegProfile, buildProfile, buildTorsoProfile, type ArmProfile } from "../src/body/profile.ts";
import { REGION_IDS, REGIONS, regionOf } from "../src/body/regions.ts";
import { SAMPLES } from "../src/body/samples.ts";
import { layoutToTexture } from "../src/body/uv.ts";
import { parseMeasurements } from "../src/config/loadMeasurements.ts";
import type { Measurements } from "../src/config/measurements.ts";

const measurementsText = readFileSync(
  path.join(import.meta.dirname, "..", "config", "measurements.yaml"),
  "utf8",
);

function parsed(text: string): Measurements {
  const r = parseMeasurements(text);
  if (!r.ok) throw new Error(r.error);
  return r.measurements;
}

const male = resolveBody(null);
const female = resolveBody(parsed("body: female\nunits: cm\n"));

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** The outward normal of region `id` at (u, v), in the body frame. */
function bodyNormal(id: (typeof REGION_IDS)[number], u: number, v = 0.5): Vec3 {
  const r = male.regions[id];
  const { normal } = surfacePoint(r.profile, u, v * r.profile.length);
  return applyRotation(male.layout.placements[id], normal);
}

describe("leg and torso profiles", () => {
  const s = SAMPLES.male;

  it("hits the leg's stations, with the knee as landmark", () => {
    const p = buildLegProfile(s.leg);
    expect(p.length).toBe(s.leg.ankle_to_knee + s.leg.knee_to_hip);
    expect(p.kneeAt).toBe(s.leg.ankle_to_knee);
    for (const st of p.stations) expect(p.circumferenceAt(st.s)).toBeCloseTo(st.circumference, 6);
    expect(p.maxCircumference).toBeCloseTo(s.leg.thigh_top, 0);
    expect(p.warnings).toEqual([]);
  });

  it("builds the torso from waist to neck, widest at the chest and flattest at the shoulder line", () => {
    const p = buildTorsoProfile(s.torso);
    expect(p.length).toBe(s.torso.waist_to_neck);
    expect(p.circumferenceAt(0)).toBeCloseTo(s.torso.waist, 6);
    expect(p.circumferenceAt(p.length)).toBeCloseTo(s.torso.neck_base, 6);
    expect(p.maxCircumference).toBeCloseTo(s.torso.chest, 0);
    const shoulderAt = p.length - s.torso.shoulder_line_below_neck;
    expect(p.aspectAt(shoulderAt)).toBeCloseTo(s.torso.shoulder_aspect, 6);
    expect(p.aspectAt(shoulderAt)).toBeGreaterThan(p.aspectAt(p.chestAt));
    expect(p.warnings).toEqual([]);
  });

  it("keeps the female sample smaller than the male one, but plausible", () => {
    expect(female.params.height).toBe(165);
    expect(male.params.height).toBe(178);
    for (const id of REGION_IDS) {
      expect(female.regions[id].profile.length).toBeLessThan(male.regions[id].profile.length);
      expect(female.regions[id].profile.warnings).toEqual([]);
      expect(male.regions[id].profile.warnings).toEqual([]);
    }
  });
});

describe("u conventions per region", () => {
  it("points the left arm's lateral line (u = 0.25) to the body's left and its inner line to the front", () => {
    expect(bodyNormal("arm-left", 0)[2]).toBeLessThan(-0.9);
    expect(bodyNormal("arm-left", 0.25)[0]).toBeGreaterThan(0.9);
    expect(bodyNormal("arm-left", 0.5)[2]).toBeGreaterThan(0.9);
  });

  it("mirrors the right arm: lateral is still u = 0.25, now towards the body's right (-X)", () => {
    expect(bodyNormal("arm-right", 0)[2]).toBeLessThan(-0.9);
    expect(bodyNormal("arm-right", 0.25)[0]).toBeLessThan(-0.9);
    expect(bodyNormal("arm-right", 0.5)[2]).toBeGreaterThan(0.9);
    expect(bodyNormal("arm-right", 0.75)[0]).toBeGreaterThan(0.9);
  });

  it("puts the legs' u = 0 on the shin and their seam on the calf, lateral at u = 0.25", () => {
    expect(bodyNormal("leg-left", 0)[2]).toBeGreaterThan(0.9);
    expect(bodyNormal("leg-left", 0.5)[2]).toBeLessThan(-0.9);
    expect(bodyNormal("leg-left", 0.25)[0]).toBeGreaterThan(0.9);
    expect(bodyNormal("leg-right", 0.25)[0]).toBeLessThan(-0.9);
  });

  it("runs the torso right flank → front → left flank (seam) → back", () => {
    expect(bodyNormal("torso", 0)[0]).toBeLessThan(-0.9);
    expect(bodyNormal("torso", 0.25)[2]).toBeGreaterThan(0.9);
    expect(bodyNormal("torso", 0.5)[0]).toBeGreaterThan(0.9);
    expect(bodyNormal("torso", 0.75)[2]).toBeLessThan(-0.9);
  });

  it("shows every unwrap as seen from outside the skin", () => {
    // Looking at the u = 0 line from outside, u growing a little must move the point to the right on
    // the screen exactly when the texture puts it to the right.
    for (const id of REGION_IDS) {
      const r = male.regions[id];
      const pl = male.layout.placements[id];
      const s = r.profile.length / 2;
      const p0 = applyPlacement(pl, surfacePoint(r.profile, 0, s).position);
      const p1 = applyPlacement(pl, surfacePoint(r.profile, 0.02, s).position);
      const n = bodyNormal(id, 0);
      const up = applyRotation(pl, [0, 1, 0]);
      // Camera looks along -n; its right is (-n) × up.
      const right: Vec3 = [
        -(n[1] * up[2] - n[2] * up[1]),
        -(n[2] * up[0] - n[0] * up[2]),
        -(n[0] * up[1] - n[1] * up[0]),
      ];
      const moved: Vec3 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
      const screenRight = dot(moved, right) > 0;
      const textureRight = layoutToTexture(r.profile, 0.02, 0.5).x > 0.5;
      expect(textureRight, id).toBe(screenRight);
      expect(r.profile.mirrored).toBe(REGIONS[id].mirrored);
    }
  });

  it("winds the mirrored meshes outwards too", () => {
    for (const id of REGION_IDS) {
      const p = male.regions[id].profile;
      const mesh = buildLoftMesh(p, { ringSpacingCm: 2, segments: 32 });
      const P = mesh.positions;
      let bad = 0;
      for (let t = 0; t < mesh.skinIndices.length; t += 3) {
        const v = [0, 1, 2].map((k) => {
          const i = mesh.skinIndices[t + k]!;
          return [P[3 * i]!, P[3 * i + 1]!, P[3 * i + 2]!] as Vec3;
        });
        const e1: Vec3 = [v[1]![0] - v[0]![0], v[1]![1] - v[0]![1], v[1]![2] - v[0]![2]];
        const e2: Vec3 = [v[2]![0] - v[0]![0], v[2]![1] - v[0]![1], v[2]![2] - v[0]![2]];
        const n: Vec3 = [
          e1[1] * e2[2] - e1[2] * e2[1],
          e1[2] * e2[0] - e1[0] * e2[2],
          e1[0] * e2[1] - e1[1] * e2[0],
        ];
        const out: Vec3 = [(v[0]![0] + v[1]![0] + v[2]![0]) / 3, 0, (v[0]![2] + v[1]![2] + v[2]![2]) / 3];
        if (Math.hypot(...n) > 1e-9 && dot(n, out) <= 0) bad++;
      }
      expect(bad, id).toBe(0);
    }
  });
});

describe("placement in the body", () => {
  const { placements, bounds } = male.layout;
  const at = (id: (typeof REGION_IDS)[number], v: number) =>
    applyPlacement(placements[id], [0, v * male.regions[id].profile.length, 0]);

  it("stands the body on the floor at about its height", () => {
    expect(bounds.min[1]).toBe(0);
    expect(bounds.max[1]).toBeGreaterThan(170);
    expect(bounds.max[1]).toBeLessThan(186);
    expect(at("leg-left", 0)[1]).toBeCloseTo(male.params.ankle_height, 6);
  });

  it("stacks legs, torso and neck and hangs the arms from the shoulder points in an A-pose", () => {
    expect(at("torso", 0)[1]).toBeCloseTo(at("leg-left", 1)[1] + male.params.pelvis_height, 6);
    const shoulder = at("arm-left", 1);
    const wrist = at("arm-left", 0);
    expect(shoulder[0]).toBeGreaterThan(10);
    expect(shoulder[0]).toBeLessThan(male.params.shoulder_width / 2);
    expect(shoulder[1]).toBeGreaterThan(at("torso", 0.8)[1]);
    expect(shoulder[1]).toBeLessThan(at("torso", 1)[1]);
    // About 15° away from the body.
    const angle = (Math.atan2(wrist[0] - shoulder[0], shoulder[1] - wrist[1]) * 180) / Math.PI;
    expect(angle).toBeCloseTo(15, 6);
  });

  it("mirrors the right side in X", () => {
    for (const [l, r] of [
      ["arm-left", "arm-right"],
      ["leg-left", "leg-right"],
    ] as const) {
      for (const v of [0, 0.5, 1]) {
        const a = at(l, v);
        const b = at(r, v);
        expect(b[0]).toBeCloseTo(-a[0], 6);
        expect(b[1]).toBeCloseTo(a[1], 6);
        expect(b[2]).toBeCloseTo(a[2], 6);
      }
    }
    expect(at("torso", 0.5)[0]).toBe(0);
  });
});

describe("measurements per region", () => {
  it("keeps the left arm's top-level blocks in step with the arm inputs", () => {
    const m = parsed(measurementsText);
    const keys = Object.keys(measuredValues(m));
    expect(keys).toEqual(INPUT_SECTIONS.arm.flatMap((s) => s.keys));
    for (const s of INPUT_SECTIONS.arm) expect(Object.keys(m[s.section as "lengths"]!)).toEqual(s.keys);
  });

  it("maps Jan's measurements.yaml onto arm-left exactly as before", () => {
    const m = parsed(measurementsText);
    const before = buildProfile(resolveInputs(measuredValues(m)).inputs);
    const now = resolveBody(m).regions["arm-left"].profile as ArmProfile;
    expect(now.length).toBe(before.length);
    expect(now.elbowAt).toBe(before.elbowAt);
    expect(now.stations).toEqual(before.stations);
    expect(now.mirrored).toBe(false);
    for (let s = 0; s <= now.length; s += 1.7) {
      expect(now.circumferenceAt(s)).toBe(before.circumferenceAt(s));
      expect(now.aspectAt(s)).toBe(before.aspectAt(s));
    }
  });

  it("uses the arm placeholders for an unmeasured arm on the default (male) body", () => {
    expect(male.body).toBe("male");
    expect(male.regions["arm-left"].inputs).toEqual(PLACEHOLDERS);
    expect(male.regions["arm-left"].fromSample).toHaveLength(Object.keys(PLACEHOLDERS).length);
  });

  it("scales unmeasured values by own height and keeps measured ones", () => {
    const m = parsed(`body: female
height_cm: 181.5
units: cm
regions:
  leg-left:
    circumferences: { knee: 40 }
`);
    const r = resolveBody(m);
    expect(r.scale).toBeCloseTo(1.1, 9);
    expect(r.params.height).toBeCloseTo(181.5, 9);
    expect(r.params.arm_abduction_deg).toBe(15);
    expect(r.regions["leg-left"].inputs.knee).toBe(40);
    expect(r.regions["leg-left"].inputs.ankle_to_knee).toBeCloseTo(39 * 1.1, 9);
    expect(r.regions["leg-left"].fromSample).not.toContain("knee");
    // Aspect ratios are shape, not size.
    expect(r.regions.torso.inputs.chest_aspect).toBe(SAMPLES.female.torso.chest_aspect);
    expect(r.regions.torso.inputs.chest).toBeCloseTo(90 * 1.1, 9);
  });

  it("lets an unmeasured side copy the other side's measurements", () => {
    const m = parsed(measurementsText);
    const r = resolveBody(m);
    expect(r.regions["arm-right"].inputs.biceps_mid).toBe(36);
    expect(r.regions["arm-right"].profile.mirrored).toBe(true);
    expect(r.regions["arm-right"].fromSample).toEqual([]);
    expect(measuredRegionValues(m, "arm-right")).toEqual({});
  });

  it("accepts a file with only a body choice and rejects the left arm given twice", () => {
    expect(parseMeasurements("units: cm\n").ok).toBe(true);
    expect(parseMeasurements("body: robot\nunits: cm\n").ok).toBe(false);
    const twice = parseMeasurements(
      `${measurementsText}\nregions:\n  arm-left:\n    circumferences: { wrist: 18 }\n`,
    );
    expect(twice.ok).toBe(false);
    expect(parseMeasurements("units: cm\nregions:\n  torso:\n    circumferences: { navel: 80 }\n").ok).toBe(
      false,
    );
  });
});

describe("regions", () => {
  it("files a layout without a region under the left arm", () => {
    expect(regionOf({})).toBe("arm-left");
    expect(regionOf({ region: "torso" })).toBe("torso");
  });
});
