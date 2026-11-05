import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PLACEHOLDERS } from "../src/arm/inputs.ts";
import { buildProfile } from "../src/arm/profile.ts";
import { listLayouts, saveLayout } from "../src/data/server/layoutsApi.ts";
import { moveElement, newElement, reorder, uniqueId } from "../src/editor/edit.ts";
import type { Layout, LayoutElement } from "../src/layout/schema.ts";
import { classify, hits, OUTSIDE, resolveElement, wrapDelta, wrappedMidU } from "../src/layout/shapes.ts";
import { parseLayout, updateLayoutText } from "../src/layout/yamlDoc.ts";
import { coverage, zoneOf } from "../src/metrics/coverage.ts";

const baselineText = readFileSync(
  path.join(import.meta.dirname, "..", "config", "layouts", "v1-baseline.yaml"),
  "utf8",
);
const profile = buildProfile(PLACEHOLDERS);

function baseline(): Layout {
  const r = parseLayout(baselineText);
  if (!r.ok) throw new Error(r.error);
  return r.layout;
}

describe("layout schema", () => {
  it("accepts v1-baseline", () => {
    expect(baseline().elements.map((e) => e.id)).toContain("pegasus");
  });

  it("rejects duplicate ids, unknown keys and upside-down regions", () => {
    const dup = baselineText.replace("id: skull", "id: rhonas");
    expect(parseLayout(dup)).toMatchObject({ ok: false });
    const typo = baselineText.replace("rotation_deg: 0", "rotaton_deg: 0");
    const r = parseLayout(typo);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("elements.1");
    expect(parseLayout(baselineText.replace("v: [ 0.05, 0.45 ]", "v: [ 0.45, 0.05 ]"))).toMatchObject({
      ok: false,
    });
  });
});

describe("YAML round trip", () => {
  it("leaves the file untouched when nothing changed", () => {
    expect(parseLayout(updateLayoutText(baselineText, baseline()))).toEqual({ ok: true, layout: baseline() });
    expect(updateLayoutText(baselineText, baseline())).toContain("# Added at Jan's request");
  });

  it("changes only edited values and keeps comments", () => {
    const l = baseline();
    const rhonas = l.elements[1]!;
    l.elements[1] = moveElement(rhonas, 0.02, 0.02);
    const out = updateLayoutText(baselineText, l);
    expect(out).toContain("position: { u: 0.02, v: 0.2 } # outer centre line");
    expect(out).toContain("position: { u: 0.10, v: 0.72 }"); // medusa untouched, original number format
    expect(out).toContain("# Height and exact position are placeholders until Jan sets them.");
  });

  it("removes, reorders and adds elements", () => {
    const l = baseline();
    l.elements = reorder(
      l.elements.filter((e) => e.id !== "scales-forearm"),
      0,
      1,
    );
    l.elements.push({ id: "elbow-band", type: "band", pattern: "meander", v: 0.45, width_cm: 1.5 });
    const r = parseLayout(updateLayoutText(baselineText, l));
    expect(r.ok && r.layout.elements.map((e) => e.id)).toEqual([
      "rhonas",
      "anubis",
      "skull",
      "medusa",
      "pegasus",
      "wrist-band",
      "red-stroke-1",
      "elbow-band",
    ]);
  });
});

describe("layouts API", () => {
  it("lists, saves with comments kept, and refuses bad names", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "layouts-"));
    try {
      await writeFile(path.join(dir, "v1-baseline.yaml"), baselineText);
      expect((await listLayouts(dir)).map((f) => f.name)).toEqual(["v1-baseline"]);
      const l = baseline();
      l.description = "changed";
      await saveLayout(dir, "v1-baseline", { layout: l });
      const text = await readFile(path.join(dir, "v1-baseline.yaml"), "utf8");
      expect(text).toContain('description: "changed"');
      expect(text).toContain("# Layout variant v1-baseline");
      await saveLayout(dir, "v2-test", { layout: { ...l, name: "v2-test" } });
      expect((await listLayouts(dir)).map((f) => f.name)).toEqual(["v1-baseline", "v2-test"]);
      await expect(saveLayout(dir, "../evil", { layout: { ...l, name: "../evil" } })).rejects.toThrow(
        "invalid layout name",
      );
      await expect(saveLayout(dir, "other", { layout: l })).rejects.toThrow("must match");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("shapes", () => {
  const figure: LayoutElement = {
    id: "f",
    type: "figure",
    position: { u: 0, v: 0.5 },
    size_cm: { h: 10, w: 4 },
  };

  it("wraps u differences the short way round", () => {
    expect(wrapDelta(0.9)).toBeCloseTo(-0.1);
    expect(wrapDelta(-0.95)).toBeCloseTo(0.05);
  });

  it("tests a figure box in real cm", () => {
    const { shape } = resolveElement(figure, profile);
    const y = 30;
    const c = profile.circumferenceAt(y);
    expect(hits(shape, 0, y, c)).toBe(true);
    expect(hits(shape, 0, y + 4.9, c)).toBe(true);
    expect(hits(shape, 0, y + 5.2, c)).toBe(false);
    expect(hits(shape, 1.9 / c, y, c)).toBe(true);
    expect(hits(shape, 2.2 / c, y, c)).toBe(false);
  });

  it("rotates boxes counter-clockwise as seen in the editor", () => {
    const { shape } = resolveElement({ ...figure, rotation_deg: 90 }, profile);
    const c = profile.circumferenceAt(30);
    // Lying on its side: 10 cm wide, 4 cm tall.
    expect(hits(shape, 4.5 / c, 30, c)).toBe(true);
    expect(hits(shape, 0, 33, c)).toBe(false);
  });

  it("flags figures without a size and uses the measured Anubis size", () => {
    const anubis: LayoutElement = {
      id: "a",
      type: "existing",
      position: { u: 0.5, v: 0.12 },
      size_cm: { h: null, w: null },
    };
    // No image, so no "width assumed" warning: a plain box keeps the default proportions.
    expect(resolveElement(anubis, profile).flags).toEqual(["height not set"]);
    expect(resolveElement({ ...anubis, asset: "photo" }, profile).flags).toEqual([
      "height not set",
      "width assumed",
    ]);
    const r = resolveElement(anubis, profile, { height: 16, width: 9 });
    expect(r.flags).toEqual([]);
    expect(r.shape).toMatchObject({ w: 9, h: 16 });
  });

  it("handles regions across the seam", () => {
    const filler: LayoutElement = {
      id: "s",
      type: "filler",
      pattern: "x",
      region: { u: [0.45, 0.55], v: [0, 1] },
    };
    const { shape } = resolveElement(filler, profile);
    expect(hits(shape, 0.5, 10, 20)).toBe(true);
    expect(hits(shape, 0.0, 10, 20)).toBe(false);
  });
});

describe("classification and coverage", () => {
  it("puts later elements on top and leaves the rest open", () => {
    const layout: Layout = {
      name: "t",
      elements: [
        { id: "band", type: "band", pattern: "x", v: 0.5, width_cm: 4 },
        { id: "fig", type: "figure", position: { u: 0, v: 0.5 }, size_cm: { h: 2, w: 2 } },
      ],
    };
    const cls = classify(layout, profile, 4);
    const row = Math.floor((profile.length - 30) * 4);
    const centre = Math.floor(cls.width / 2);
    expect(cls.cells[row * cls.width + centre]).toBe(2);
    expect(cls.cells[row * cls.width + 2]).toBe(OUTSIDE);
    const cov = coverage(cls, profile);
    expect(cov.total.byCategory.band + cov.total.byCategory.figure).toBeGreaterThan(0);
    // A 4 cm band around the arm: about 4 × circumference.
    expect(cov.total.byCategory.band + cov.total.byCategory.figure).toBeCloseTo(
      4 * profile.circumferenceAt(30),
      -1,
    );
    const sum = Object.values(cov.total.byCategory).reduce((a, b) => a + b);
    expect(sum).toBeCloseTo(cov.total.area, 6);
  });

  it("measures the skin area of the whole arm", () => {
    const cov = coverage(classify({ name: "e", elements: [] }, profile, 6), profile);
    let area = 0;
    for (let y = 0; y < profile.length; y += 0.01) area += profile.circumferenceAt(y) * 0.01;
    expect(Math.abs(cov.total.area - area) / area).toBeLessThan(0.01);
    expect(cov.total.byCategory.open).toBeCloseTo(cov.total.area, 6);
  });

  it("assigns zones by position", () => {
    expect(zoneOf(profile, 0.5, 5)).toBe("forearm-inner");
    expect(zoneOf(profile, 0, 5)).toBe("forearm-outer");
    expect(zoneOf(profile, 0, profile.elbowAt)).toBe("elbow");
    expect(zoneOf(profile, 0.5, 45)).toBe("upper-inner");
    expect(zoneOf(profile, 0.9, 45)).toBe("upper-outer");
    expect(zoneOf(profile, 0, 58)).toBe("shoulder");
  });
});

describe("editing", () => {
  it("moves, wraps and clamps", () => {
    const f: LayoutElement = { id: "f", type: "figure", position: { u: 0.95, v: 0.98 }, size_cm: { h: 10 } };
    expect(moveElement(f, 0.1, 0.1)).toMatchObject({ position: { u: 0.05, v: 1 } });
    const r: LayoutElement = {
      id: "r",
      type: "filler",
      pattern: "x",
      region: { u: [0.2, 0.3], v: [0.8, 0.9] },
    };
    expect(moveElement(r, 0, 0.5)).toMatchObject({ region: { v: [0.9, 1] } });
  });

  it("creates valid new elements with unique ids", () => {
    expect(uniqueId("new-figure", ["new-figure", "new-figure-2"])).toBe("new-figure-3");
    for (const type of ["figure", "existing", "filler", "band", "line"] as const) {
      const el = newElement(type, 0, 0.5, []);
      const r = parseLayout(updateLayoutText("name: t\nelements: []\n", { name: "t", elements: [el] }));
      expect(r.ok, type).toBe(true);
    }
  });
});

describe("lines near the seam", () => {
  it("does not draw a segment across the arm when a pixel sits behind it", () => {
    const line: LayoutElement = {
      id: "l",
      type: "line",
      points: [
        { u: 0.15, v: 0.4 },
        { u: 0.1, v: 1 },
      ],
      width_cm: 1.5,
    };
    const { shape } = resolveElement(line, profile);
    const y = 0.7 * profile.length;
    const c = profile.circumferenceAt(y);
    expect(hits(shape, 0.125, y, c)).toBe(true);
    for (let u = 0.3; u < 0.95; u += 0.01) expect(hits(shape, u, y, c), `u=${u}`).toBe(false);
  });
});

describe("wrappedMidU", () => {
  it("finds the middle of a range, also across the seam", () => {
    expect(wrappedMidU(0.2, 0.4)).toBeCloseTo(0.3);
    expect(wrappedMidU(0.9, 0.1)).toBeCloseTo(0);
    expect(wrappedMidU(0.8, 0.0)).toBeCloseTo(0.9);
  });
});
