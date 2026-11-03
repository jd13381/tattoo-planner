import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { measurementsSchema } from "../src/config/measurements.ts";

const configDir = path.join(import.meta.dirname, "..", "config");

describe("config files", () => {
  it("measurements.yaml matches the schema", () => {
    const data: unknown = parse(readFileSync(path.join(configDir, "measurements.yaml"), "utf8"));
    expect(() => measurementsSchema.parse(data)).not.toThrow();
  });

  it("every layout is valid YAML with a name matching its file", () => {
    const dir = path.join(configDir, "layouts");
    const files = readdirSync(dir).filter((f) => f.endsWith(".yaml"));
    expect(files).toContain("v1-baseline.yaml");
    for (const f of files) {
      const layout = parse(readFileSync(path.join(dir, f), "utf8")) as { name?: unknown; elements?: unknown };
      expect(layout.name).toBe(f.replace(/\.yaml$/, ""));
      expect(Array.isArray(layout.elements)).toBe(true);
    }
  });
});
