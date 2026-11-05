import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PLACEHOLDERS } from "../src/arm/inputs.ts";
import { buildProfile } from "../src/arm/profile.ts";
import { diffLayouts } from "../src/compare/diff.ts";
import { compareSummary } from "../src/compare/summary.ts";
import { saveLayout } from "../server/layoutsApi.ts";
import { moveElement, suggestVariantName } from "../src/editor/edit.ts";
import type { Layout } from "../src/layout/schema.ts";
import { classify } from "../src/layout/shapes.ts";
import { parseLayout } from "../src/layout/yamlDoc.ts";
import { coverage, coverageDelta, sharePct } from "../src/metrics/coverage.ts";
import { createCameraSync } from "../src/viewer/cameraSync.ts";

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

describe("layout diff", () => {
  it("finds added, removed and changed elements by id", () => {
    const a = baseline();
    const b = baseline();
    b.elements = b.elements.filter((e) => e.id !== "pegasus");
    b.elements[1] = moveElement(b.elements[1]!, 0.1, 0);
    b.elements.push({ id: "extra", type: "band", pattern: "meander", v: 0.9, width_cm: 2 });
    const d = diffLayouts(a, b);
    expect(d.onlyA).toEqual(["pegasus"]);
    expect(d.onlyB).toEqual(["extra"]);
    expect(d.changed).toEqual([{ id: "rhonas", type: "figure", fields: ["position"] }]);
    expect(d.same).toContain("anubis");
    expect(diffLayouts(a, a).changed).toEqual([]);
  });

  it("counts a field that is set on one side only", () => {
    const a = baseline();
    const b = baseline();
    const skull = b.elements.find((e) => e.id === "skull")!;
    if (skull.type === "figure") skull.notes = "ask the artist";
    expect(diffLayouts(a, b).changed).toEqual([{ id: "skull", type: "figure", fields: ["notes"] }]);
  });
});

describe("coverage comparison", () => {
  it("reports other − this in the rounded percentages the table shows", () => {
    const a = baseline();
    const b: Layout = { ...a, elements: a.elements.filter((e) => e.id !== "medusa") };
    const ca = coverage(classify(a, profile, 3), profile);
    const cb = coverage(classify(b, profile, 3), profile);
    const d = coverageDelta(ca, cb);
    expect(d["upper-outer"].figure).toBeLessThan(0);
    expect(d["upper-outer"].open).toBeGreaterThan(0);
    expect(d["upper-outer"].figure).toBe(
      sharePct(cb.zones["upper-outer"], "figure") - sharePct(ca.zones["upper-outer"], "figure"),
    );
    expect(d["forearm-inner"].existing).toBe(0);
    expect(coverageDelta(ca, ca).total.open).toBe(0);
  });
});

describe("compare summary", () => {
  it("counts differing elements and shows the whole-arm open skin from A to B", () => {
    const a = baseline();
    const b: Layout = { ...a, elements: a.elements.filter((e) => e.id !== "medusa") };
    const ca = coverage(classify(a, profile, 3), profile);
    const cb = coverage(classify(b, profile, 3), profile);
    const s = compareSummary(diffLayouts(a, b), ca, cb);
    const openA = sharePct(ca.total, "open");
    const openB = sharePct(cb.total, "open");
    expect(openB).toBeGreaterThan(openA);
    expect(s).toEqual({
      differing: 1,
      open: { a: openA, b: openB },
      text: `1 element differs · open skin ${openA} % → ${openB} %`,
    });
  });

  it("says when nothing differs, and leaves out coverage it does not have", () => {
    const a = baseline();
    const ca = coverage(classify(a, profile, 3), profile);
    const same = compareSummary(diffLayouts(a, a), ca, ca);
    expect(same.text).toBe(`Same elements · open skin ${sharePct(ca.total, "open")} % in both`);
    const b = baseline();
    b.elements = b.elements.filter((e) => e.id !== "pegasus" && e.id !== "skull");
    expect(compareSummary(diffLayouts(a, b), null, ca).text).toBe("2 elements differ");
  });
});

describe("camera sync", () => {
  it("passes a camera to the other viewers only", () => {
    const sync = createCameraSync();
    const got: Record<string, number> = { a: 0, b: 0 };
    sync.subscribe("a", () => got.a!++);
    const off = sync.subscribe("b", (s) => {
      got.b!++;
      expect(s.position).toEqual([1, 2, 3]);
    });
    sync.publish("a", { position: [1, 2, 3], target: [0, 0, 0] });
    expect(got).toEqual({ a: 0, b: 1 });
    off();
    sync.publish("a", { position: [1, 2, 3], target: [0, 0, 0] });
    expect(got.b).toBe(1);
    expect(sync.last()?.position).toEqual([1, 2, 3]);
  });
});

describe("duplicating a variant", () => {
  it("copies the source file's comments into the new variant", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "layouts-"));
    try {
      await writeFile(path.join(dir, "v1-baseline.yaml"), baselineText);
      const l = { ...baseline(), name: "v2-try" };
      await saveLayout(dir, "v2-try", { layout: l, from: "v1-baseline" });
      const text = await readFile(path.join(dir, "v2-try.yaml"), "utf8");
      expect(text.split("\n")[0]).toBe(
        "# Variant v2-try, duplicated from v1-baseline; the comments below come from v1-baseline.",
      );
      expect(text).toContain("# Added at Jan's request");
      expect(text).toContain("name: v2-try");
      expect(parseLayout(text)).toEqual({ ok: true, layout: l });
      // Saving again keeps the file as it is, and the source is untouched.
      await saveLayout(dir, "v2-try", { layout: l, from: "v1-baseline" });
      expect(await readFile(path.join(dir, "v2-try.yaml"), "utf8")).toBe(text);
      expect(await readFile(path.join(dir, "v1-baseline.yaml"), "utf8")).toBe(baselineText);
      await expect(saveLayout(dir, "v3", { layout: { ...l, name: "v3" }, from: "../x" })).rejects.toThrow(
        "invalid source",
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("variant names", () => {
  it("suggests a free name for a copy", () => {
    expect(suggestVariantName("v1-baseline", ["v1-baseline"])).toBe("v1-baseline-2");
    expect(suggestVariantName("v1-baseline", ["v1-baseline", "v1-baseline-2"])).toBe("v1-baseline-3");
    expect(suggestVariantName("try-3", ["try-3", "try-4"])).toBe("try-5");
  });
});
