// The measurements form's value resolution and the measuring wizard's steps.
import { describe, expect, it } from "vitest";
import { resolveBody } from "../src/body/body.ts";
import { bodyStatus, fieldStatuses, resolveDraft } from "../src/body/fieldStatus.ts";
import { inputKeys } from "../src/body/inputs.ts";
import { INPUT_LABELS, untapedKeys, wizardSteps } from "../src/body/measureGuide.ts";
import { REGION_IDS, REGIONS } from "../src/body/regions.ts";
import { SAMPLES } from "../src/body/samples.ts";
import { parseMeasurements } from "../src/config/loadMeasurements.ts";
import type { Measurements } from "../src/config/measurements.ts";

function parsed(text: string): Measurements {
  const r = parseMeasurements(text);
  if (!r.ok) throw new Error(r.error);
  return r.measurements;
}

const FILE = parsed(`units: cm
height_cm: 189
regions:
  arm-left:
    circumferences:
      wrist: 19
  torso:
    circumferences:
      chest: 104
`);

describe("fieldStatuses", () => {
  it("marks measured, other-side and sample values and scales the sample by height", () => {
    const right = Object.fromEntries(fieldStatuses(FILE, {}, "arm-right").map((f) => [f.key, f]));
    expect(right.wrist).toMatchObject({ source: "other-side", value: 19, own: null, fallback: 19 });
    const left = Object.fromEntries(fieldStatuses(FILE, {}, "arm-left").map((f) => [f.key, f]));
    expect(left.wrist).toMatchObject({ source: "measured", value: 19, file: 19, changed: false });
    const scale = 189 / SAMPLES.male.params.height;
    expect(left.elbow!.source).toBe("sample");
    expect(left.elbow!.value).toBeCloseTo(SAMPLES.male.arm.elbow * scale);
    // Ratios are not scaled by height.
    const torso = Object.fromEntries(fieldStatuses(FILE, {}, "torso").map((f) => [f.key, f]));
    expect(torso.chest_aspect!.value).toBe(SAMPLES.male.torso.chest_aspect);
  });

  it("shows unsaved edits, a cleared value falls back and counts as a change", () => {
    const draft = { regions: { "arm-left": { wrist: null, elbow: 30 }, torso: { chest: 104 } } };
    const left = Object.fromEntries(fieldStatuses(FILE, draft, "arm-left").map((f) => [f.key, f]));
    expect(left.elbow).toMatchObject({ source: "edited", value: 30, changed: true });
    expect(left.wrist).toMatchObject({ source: "sample", own: null, file: 19, changed: true });
    // Typing the file's value again is no change.
    const torso = Object.fromEntries(fieldStatuses(FILE, draft, "torso").map((f) => [f.key, f]));
    expect(torso.chest).toMatchObject({ source: "measured", changed: false });
  });

  it("agrees with resolveBody on every value of every region", () => {
    const draft = { body: "female" as const, heightCm: 170, regions: { "leg-right": { knee: 41 } } };
    const body = resolveDraft(FILE, draft);
    for (const id of REGION_IDS)
      for (const f of fieldStatuses(FILE, draft, id))
        expect(f.value).toBeCloseTo(body.regions[id].inputs[f.key]!);
    expect(body.regions["leg-left"].inputs.knee).toBe(41);
    expect(bodyStatus(FILE, draft)).toMatchObject({ body: "female", heightCm: 170, heightChanged: true });
    const plain = resolveBody(FILE);
    for (const id of REGION_IDS)
      expect(resolveDraft(FILE, {}).regions[id].inputs).toEqual(plain.regions[id].inputs);
  });
});

describe("wizardSteps", () => {
  it("starts with the body height, then every taped value of the region once", () => {
    for (const id of REGION_IDS) {
      const steps = wizardSteps(id);
      expect(steps[0]!.key).toBe("height_cm");
      const keys = steps.slice(1).map((s) => s.key);
      expect(new Set(keys).size).toBe(keys.length);
      const kind = REGIONS[id].kind;
      expect([...keys, ...untapedKeys(kind)].sort()).toEqual([...inputKeys(kind)].sort());
      for (const s of steps) {
        expect(s.instruction.length).toBeGreaterThan(20);
        expect(s.label).toBeTruthy();
      }
    }
  });

  it("follows the measuring order of docs/measuring.md on the arm and names the side", () => {
    const keys = wizardSteps("arm-left").map((s) => s.key);
    expect(keys.slice(0, 4)).toEqual(["height_cm", "shoulder_to_elbow", "elbow_to_wrist", "wrist"]);
    // A position comes right after the circumference whose tape it measures to.
    expect(keys.indexOf("forearm_max_below_elbow")).toBe(keys.indexOf("forearm_max") + 1);
    expect(wizardSteps("arm-right")[1]!.instruction).toContain("the right arm");
    expect(wizardSteps("leg-left")[1]!.instruction).toContain("the left leg");
  });

  it("leaves out what no tape gives: the torso's shoulder line and shape", () => {
    expect(untapedKeys("torso")).toEqual([
      "shoulder_line",
      "waist_aspect",
      "chest_aspect",
      "shoulder_aspect",
    ]);
    expect(untapedKeys("arm")).toEqual([]);
    expect(untapedKeys("leg")).toEqual([]);
  });

  it("has a label for every input", () => {
    for (const kind of ["arm", "leg", "torso"] as const)
      for (const k of inputKeys(kind)) expect(INPUT_LABELS[k], k).toBeTruthy();
  });

  it("draws every line inside the schematic", () => {
    for (const id of REGION_IDS)
      for (const { diagram: d } of wizardSteps(id)) {
        if (d.kind === "girth") expect(d.at).toBeGreaterThanOrEqual(0);
        if (d.kind === "girth") expect(d.at).toBeLessThanOrEqual(1);
        if (d.kind === "length") expect(d.from).toBeLessThan(d.to);
      }
  });
});
