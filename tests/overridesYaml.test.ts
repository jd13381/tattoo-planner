import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { PLACEHOLDERS, type ArmInputKey } from "../src/arm/inputs.ts";
import { changedKeys, overridesYaml } from "../src/arm/overridesYaml.ts";

const file = { ...PLACEHOLDERS, shoulder: null } as Record<ArmInputKey, number | null>;

describe("overridesYaml", () => {
  it("is empty without edits or when the edits equal the file", () => {
    expect(overridesYaml({}, file)).toBe("");
    expect(overridesYaml({ wrist: PLACEHOLDERS.wrist }, file)).toBe("");
    expect(changedKeys({ wrist: PLACEHOLDERS.wrist }, file)).toEqual([]);
  });

  it("groups changed values by file section in file order", () => {
    const yaml = overridesYaml(
      { shoulder_below_shoulder: 9, biceps_mid: 35.5, wrist: 18, elbow_to_wrist: 31 },
      file,
    );
    expect(yaml).toBe(
      [
        "lengths:",
        "  elbow_to_wrist: 31",
        "circumferences:",
        "  wrist: 18",
        "  biceps_mid: 35.5",
        "positions:",
        "  shoulder_below_shoulder: 9",
        "",
      ].join("\n"),
    );
    expect(parse(yaml)).toEqual({
      lengths: { elbow_to_wrist: 31 },
      circumferences: { wrist: 18, biceps_mid: 35.5 },
      positions: { shoulder_below_shoulder: 9 },
    });
  });

  it("lists a value for a field that is null in the file and drops float noise", () => {
    expect(overridesYaml({ shoulder: 40.1 + 0.2 }, file)).toBe("circumferences:\n  shoulder: 40.3\n");
    expect(changedKeys({ shoulder: 40 }, file)).toEqual(["shoulder"]);
  });
});
