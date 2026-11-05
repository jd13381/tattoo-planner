import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PLACEHOLDERS } from "../src/body/inputs.ts";
import { buildProfile } from "../src/body/profile.ts";
import {
  buildHandout,
  cm,
  coverageRows,
  facesView,
  sideName,
  type HandoutFacts,
} from "../src/export/handout.ts";
import { HANDOUT_EN as t } from "../src/export/strings.ts";
import type { Layout } from "../src/layout/schema.ts";
import { classify, resolveElement } from "../src/layout/shapes.ts";
import { parseLayout } from "../src/layout/yamlDoc.ts";
import { coverage } from "../src/metrics/coverage.ts";

const profile = buildProfile(PLACEHOLDERS);
const existing = { height: 26, width: 12 };
/** Proportions of the reference cut-outs, as the browser measures them once the images load. */
const ASPECTS = new Map([
  ["rhonas", 0.89],
  ["skull", 0.43],
  ["medusa", 0.63],
]);

function baseline(): Layout {
  const text = readFileSync(
    path.join(import.meta.dirname, "..", "config", "layouts", "v1-baseline.yaml"),
    "utf8",
  );
  const r = parseLayout(text);
  if (!r.ok) throw new Error(r.error);
  return r.layout;
}

function facts(layout: Layout, over: Partial<HandoutFacts> = {}): HandoutFacts {
  return {
    layout,
    profile,
    date: "2026-11-03",
    resolved: layout.elements.map((el) => resolveElement(el, profile, existing, ASPECTS.get(el.id))),
    coverage: coverage(classify(layout, profile, 4, existing), profile),
    missingImages: new Map(),
    placeholderMeasurements: [],
    measurementCount: 13,
    existing,
    ...over,
  };
}

describe("handout content", () => {
  it("formats cm with at most one decimal", () => {
    expect(cm(12)).toBe("12");
    expect(cm(12.04)).toBe("12");
    expect(cm(13.36)).toBe("13.4");
  });

  it("names the centre lines and the spaces between them", () => {
    expect(sideName(0.5, t)).toBe("inner line");
    expect(sideName(0.02, t)).toBe("outer line");
    expect(sideName(0.98, t)).toBe("outer line");
    expect(sideName(1.25, t)).toBe("lateral line");
    expect(sideName(0.1, t)).toBe("between outer and lateral");
    expect(sideName(0.85, t)).toBe("between medial and outer");
  });

  it("has one row per element with size, position and style", () => {
    const h = buildHandout(facts(baseline()), t);
    expect(h.layoutName).toBe("v1-baseline");
    expect(h.description).toContain("Rhonas");
    const byId = new Map(h.elementRows.map((r) => [r[0], r]));
    expect(h.elementRows).toHaveLength(baseline().elements.length);
    expect(h.elementRows.every((r) => r.length === t.elementHeaders.length)).toBe(true);
    // Anubis takes its size from measurements.yaml.
    expect(byId.get("anubis")!.slice(1, 4)).toEqual(["existing tattoo", "anubis-photo", "26 × 12 cm"]);
    expect(byId.get("rhonas")![4]).toContain("outer line, centre 10.8 cm above the wrist");
    expect(byId.get("rhonas")![5]).toBe("hatching");
    expect(byId.get("medusa")![5]).toBe("realistic, red accents");
    expect(byId.get("pegasus")![3]).toContain("height not set");
    expect(byId.get("scales-forearm")![5]).toBe("pattern snake-scales, density 0.3");
    expect(byId.get("wrist-band")![4]).toBe("all around the arm, 1.2 cm above the wrist");
    expect(byId.get("red-stroke-1")![3]).toMatch(/^1.5 cm wide, about \d+(\.\d)? cm long$/);
    expect(byId.get("skull")![6]).toBe("–");
  });

  it("marks missing images and lists open points", () => {
    const h = buildHandout(
      facts(baseline(), {
        missingImages: new Map([["pegasus", "pegasus-ref-01: not in manifest"]]),
        placeholderMeasurements: ["wrist", "elbow"],
      }),
      t,
    );
    expect(h.elementRows.find((r) => r[0] === "pegasus")![2]).toBe("pegasus-ref-01 (image missing)");
    expect(h.layoutPoints).toEqual([
      "pegasus: height not set yet, drawn 10 cm tall as a stand-in.",
      "pegasus: no reference image (pegasus-ref-01: not in manifest); shown as a labelled box.",
      "Arm model: 2 of 13 measurements are generic placeholders (wrist, elbow).",
    ]);
    expect(h.designQuestions).toHaveLength(9);
  });

  it("lists coverage per zone plus the whole arm, rows adding up to about 100 %", () => {
    const rows = coverageRows(facts(baseline()).coverage, t);
    expect(rows).toHaveLength(7);
    expect(rows[6]![0]).toBe("Whole arm");
    for (const r of rows) {
      expect(r).toHaveLength(t.coverageHeaders.length);
      const sum = r.slice(1).reduce((a, c) => a + Number.parseInt(c, 10), 0);
      expect(Math.abs(sum - 100)).toBeLessThanOrEqual(3);
    }
  });

  it("knows which elements face each view", () => {
    const f = facts(baseline());
    const h = buildHandout(f, t);
    expect(h.facing.front).toContain("anubis");
    expect(h.facing.front).toContain("pegasus");
    expect(h.facing.front).not.toContain("medusa");
    expect(h.facing.back).toContain("rhonas");
    expect(h.facing.back).not.toContain("anubis");
    expect(h.facing.medial).toContain("skull");
    // Bands go all around.
    for (const v of ["front", "back", "medial", "lateral"] as const)
      expect(h.facing[v]).toContain("wrist-band");
    // From the shoulder down.
    expect(h.facing.back.indexOf("medusa")).toBeLessThan(h.facing.back.indexOf("rhonas"));
    const skull = f.resolved.find((r) => r.element.id === "skull")!;
    expect(facesView(skull, "lateral", profile)).toBe(false);
  });
});
