import { describe, expect, it } from "vitest";
import { parseMeasurements } from "../src/config/loadMeasurements.ts";
import { breadcrumb, folderNameFor, projectFolder } from "../src/project/folders.ts";
import { EMPTY_MEASUREMENTS_TEXT, withProjectBody } from "../src/project/projectData.ts";

describe("folder helpers", () => {
  it("builds the breadcrumb from home down", () => {
    expect(breadcrumb({ home: "/Users/jan", path: "/Users/jan" })).toEqual([
      { label: "Home", path: "/Users/jan" },
    ]);
    expect(breadcrumb({ home: "/Users/jan", path: "/Users/jan/a/b" }).map((c) => c.path)).toEqual([
      "/Users/jan",
      "/Users/jan/a",
      "/Users/jan/a/b",
    ]);
  });

  it("makes a safe folder name and the target path", () => {
    expect(folderNameFor(" My / sleeve: v2 ")).toBe("My sleeve v2");
    expect(folderNameFor("..hidden")).toBe("hidden");
    expect(projectFolder("/Users/jan/Projects/", "Back piece")).toBe("/Users/jan/Projects/Back piece");
    expect(projectFolder("/Users/jan/Empty", "  ")).toBe("/Users/jan/Empty");
  });
});

describe("measurements and project body", () => {
  it("the empty default parses", () => {
    expect(parseMeasurements(EMPTY_MEASUREMENTS_TEXT).ok).toBe(true);
  });

  it("project.yaml wins for body and height, measurements.yaml fills in", () => {
    const m = { units: "cm" as const, body: "female" as const, height_cm: 170 };
    expect(withProjectBody(m, { body: "male", height_cm: null })).toMatchObject({
      body: "male",
      height_cm: 170,
    });
    expect(withProjectBody(m, { body: null, height_cm: 180 })).toMatchObject({
      body: "female",
      height_cm: 180,
    });
    expect(withProjectBody(m, null)).toBe(m);
    expect(withProjectBody(null, { body: "female", height_cm: null })).toEqual({
      units: "cm",
      body: "female",
    });
  });
});
