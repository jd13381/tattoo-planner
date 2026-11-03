import { describe, expect, it } from "vitest";
import { parseMeasurements } from "../src/config/loadMeasurements.ts";

describe("parseMeasurements", () => {
  it("reports YAML syntax errors", () => {
    const r = parseMeasurements("arm: [left");
    expect(r.ok).toBe(false);
  });

  it("names the field that fails validation", () => {
    const r = parseMeasurements("arm: right\nunits: cm\n");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("arm");
  });
});
