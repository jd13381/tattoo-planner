import { describe, expect, it } from "vitest";
import { countNoun, elementSummary, filterLabel, KIND_LABEL } from "../src/editor/labels.ts";
import { ELEMENT_TYPES, IMAGE_FILTERS } from "../src/layout/schema.ts";

describe("editor labels", () => {
  it("names every element type and every image filter in plain words", () => {
    for (const t of ELEMENT_TYPES) expect(KIND_LABEL[t]).toMatch(/^[A-Z]/);
    for (const f of IMAGE_FILTERS) expect(filterLabel(f)).toMatch(/^[A-Z]/);
    expect(filterLabel("sepia")).toBe("sepia");
  });

  it("counts with the right noun", () => {
    expect(countNoun(1, "figure")).toBe("1 figure");
    expect(countNoun(3, "figure")).toBe("3 figures");
    expect(countNoun(0, "layer")).toBe("0 layers");
  });

  it("summarises a variant by the types it has", () => {
    expect(elementSummary(["figure", "band", "figure"])).toBe("2 figures, 1 band");
    expect(elementSummary(["existing", "line", "line"])).toBe("1 existing tattoo, 2 lines");
    expect(elementSummary([])).toBe("No elements yet");
  });
});
