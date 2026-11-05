// Writing own measurements back into measurements.yaml (src/config/measurementsDoc.ts).
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { measuredRegionValues } from "../src/body/body.ts";
import { parseMeasurements } from "../src/config/loadMeasurements.ts";
import type { Measurements } from "../src/config/measurements.ts";
import {
  draftSize,
  readBodyChoice,
  sectionOf,
  updateMeasurementsText,
  usesLegacyArm,
} from "../src/config/measurementsDoc.ts";

const repoText = readFileSync(path.join(import.meta.dirname, "..", "config", "measurements.yaml"), "utf8");

function parsed(text: string): Measurements {
  const r = parseMeasurements(text);
  if (!r.ok) throw new Error(r.error);
  return r.measurements;
}

const LEGACY = `# Header comment about the arm.
arm: left
units: cm
lengths:
  shoulder_to_elbow: 44        # acromion to elbow tip
  elbow_to_wrist: null
circumferences:
  wrist: 19
  forearm_mid: null
  forearm_max: null
  elbow: null
  above_elbow: null
  biceps_mid: 36               # relaxed
  armpit_level: null
  shoulder: null
notes: ""
`;

describe("updateMeasurementsText", () => {
  it("edits the legacy left-arm blocks in place and keeps every comment", () => {
    const text = updateMeasurementsText(LEGACY, {
      regions: { "arm-left": { shoulder_to_elbow: 45.5, wrist: null, elbow: 28 } },
    });
    expect(text).toContain("# Header comment about the arm.\narm: left\n");
    expect(text).toContain("shoulder_to_elbow: 45.5        # acromion to elbow tip");
    expect(text).toContain("biceps_mid: 36               # relaxed");
    expect(text).toContain("  wrist: null\n");
    expect(text).toContain("  elbow: 28\n");
    expect(text).not.toContain("regions:");
    const m = parsed(text);
    expect(m.lengths?.shoulder_to_elbow).toBe(45.5);
    expect(m.circumferences?.wrist).toBeNull();
  });

  it("adds a missing legacy section with every key, in file order", () => {
    const text = updateMeasurementsText(LEGACY, { regions: { "arm-left": { forearm_max_below_elbow: 9 } } });
    const m = parsed(text);
    expect(m.positions).toEqual({
      forearm_max_below_elbow: 9,
      armpit_level_below_shoulder: null,
      shoulder_below_shoulder: null,
    });
    // positions comes after circumferences, before notes.
    expect(text.indexOf("positions:")).toBeGreaterThan(text.indexOf("circumferences:"));
    expect(text.indexOf("positions:")).toBeLessThan(text.indexOf("notes:"));
  });

  it("writes other regions under regions:, in region, section and key order", () => {
    const text = updateMeasurementsText(LEGACY, {
      regions: {
        torso: { chest: 101, waist_to_neck: 42 },
        "leg-left": { knee: 39 },
      },
    });
    const m = parsed(text);
    expect(measuredRegionValues(m, "torso")).toEqual({ waist_to_neck: 42, chest: 101 });
    expect(measuredRegionValues(m, "leg-left")).toEqual({ knee: 39 });
    expect(text.indexOf("leg-left:")).toBeLessThan(text.indexOf("torso:"));
    expect(text.indexOf("lengths:", text.indexOf("torso:"))).toBeLessThan(
      text.indexOf("circumferences:", text.indexOf("torso:")),
    );
    expect(text.indexOf("regions:")).toBeLessThan(text.indexOf("notes:"));
    expect(text).toContain("# acromion to elbow tip");
  });

  it("removes cleared values and empty blocks under regions:", () => {
    const start =
      "units: cm\nregions:\n  torso:\n    lengths:\n      waist_to_neck: 40 # front\n    circumferences:\n      chest: 99\n";
    const one = updateMeasurementsText(start, { regions: { torso: { chest: null } } });
    expect(one).toContain("waist_to_neck: 40 # front");
    expect(one).not.toContain("circumferences");
    const none = updateMeasurementsText(one, { regions: { torso: { waist_to_neck: null } } });
    expect(none.trim()).toBe("units: cm");
  });

  it("writes the left arm under regions: when the file has no legacy blocks", () => {
    const text = updateMeasurementsText("units: cm\n", { regions: { "arm-left": { wrist: 17.25 } } });
    const m = parsed(text);
    expect(usesLegacyArm(m)).toBe(false);
    expect(m.regions?.["arm-left"]?.circumferences?.wrist).toBe(17.25);
  });

  it("sets body and height after units, keeping the header comment on top", () => {
    const text = updateMeasurementsText(LEGACY, { body: "female", heightCm: 171.04 });
    expect(
      text.startsWith(
        "# Header comment about the arm.\narm: left\nunits: cm\nbody: female\nheight_cm: 171.04\n",
      ),
    ).toBe(true);
    expect(readBodyChoice(parsed(text))).toEqual({ body: "female", heightCm: 171.04 });
    const cleared = updateMeasurementsText(text, { heightCm: null });
    expect(readBodyChoice(parsed(cleared))).toEqual({ body: "female", heightCm: null });
  });

  it("leaves Jan's file byte for byte unchanged for an empty draft and keeps its comments on edit", () => {
    expect(updateMeasurementsText(repoText, {})).toBe(repoText);
    const text = updateMeasurementsText(repoText, { regions: { "arm-left": { wrist: 19.5 } } });
    const changed = text.split("\n").filter((l, i) => l !== repoText.split("\n")[i]);
    expect(changed).toEqual(["  wrist: 19.5"]);
  });

  it("adds a new region to Jan's file without touching any other line", () => {
    const text = updateMeasurementsText(repoText, { body: "female", regions: { torso: { chest: 102 } } });
    const added = text.split("\n").filter((l) => !repoText.split("\n").includes(l));
    expect(added).toEqual([
      "body: female",
      "regions:",
      "  torso:",
      "    circumferences:",
      "      chest: 102",
    ]);
    for (const line of repoText.split("\n")) expect(text).toContain(line);
    expect(text.indexOf("regions:")).toBeGreaterThan(text.indexOf("shoulder_below_shoulder"));
    expect(text.indexOf("regions:")).toBeLessThan(text.indexOf("existing:"));
  });

  it("starts an empty file with units and refuses invalid YAML", () => {
    expect(parsed(updateMeasurementsText("", { heightCm: 180 })).height_cm).toBe(180);
    expect(() => updateMeasurementsText("units: [", {})).toThrow(/YAML/);
  });
});

describe("draft helpers", () => {
  it("knows the section of every key and counts the changes", () => {
    expect(sectionOf("leg-right", "calf_max")).toBe("circumferences");
    expect(sectionOf("torso", "chest_aspect")).toBe("shape");
    expect(() => sectionOf("torso", "wrist")).toThrow();
    expect(draftSize({ body: "male", regions: { torso: { chest: 1, waist: null } } })).toBe(3);
  });
});

describe("saveMeasurements (dev server)", () => {
  it("writes valid text atomically and refuses invalid text", async () => {
    const { mkdtemp, readFile, readdir, rm, writeFile } = await import("node:fs/promises");
    const os = await import("node:os");
    const { saveMeasurements } = await import("../src/data/server/measurementsApi.ts");
    const dir = await mkdtemp(path.join(os.tmpdir(), "measurements-"));
    const file = path.join(dir, "measurements.yaml");
    try {
      await writeFile(file, LEGACY);
      const next = updateMeasurementsText(LEGACY, { regions: { torso: { waist: 80 } } });
      expect(await saveMeasurements(file, { text: next })).toBe(next);
      expect(await readFile(file, "utf8")).toBe(next);
      await expect(saveMeasurements(file, { text: "units: inch\n" })).rejects.toThrow(/units/);
      await expect(saveMeasurements(file, { text: 3 })).rejects.toThrow(/text/);
      expect(await readFile(file, "utf8")).toBe(next);
      expect(await readdir(dir)).toEqual(["measurements.yaml"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
