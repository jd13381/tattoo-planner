// Home (docs/adr/0018-home.md): active variants per region and the numbers on the region cards.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveBody } from "../src/body/body.ts";
import { homeRegions, plannedSummary, regionStats } from "../src/home/model.ts";

const SAM = path.resolve(import.meta.dirname, "..", "samples", "demo", "persons", "sam", "layouts");
const files = readdirSync(SAM)
  .filter((f) => f.endsWith(".yaml"))
  .sort()
  .map((f) => ({ name: f.slice(0, -5), text: readFileSync(path.join(SAM, f), "utf8") }));

describe("home regions", () => {
  it("shows each region's first variant unless one is marked active", () => {
    const regions = homeRegions(files, {});
    const byId = Object.fromEntries(regions.map((r) => [r.id, r]));
    expect(byId["arm-left"]).toMatchObject({ variant: "sam-left-arm", variants: 2, marked: false });
    expect(byId["arm-right"]).toMatchObject({ variant: null, variants: 0, layout: null });
    expect(byId.torso!.layout?.elements.length).toBe(2);
    const marked = homeRegions(files, { "arm-left": "sam-left-arm-alt" });
    expect(marked[0]).toMatchObject({ variant: "sam-left-arm-alt", marked: true });
    expect(plannedSummary(regions)).toBe("3 of 5 regions planned");
    expect(plannedSummary(homeRegions([], {}))).toBe("Nothing planned yet");
  });

  it("reports a broken layout instead of throwing", () => {
    const [r] = homeRegions([{ name: "bad", text: "name: bad\nelements: nope\n" }], {});
    expect(r).toMatchObject({ id: "arm-left", variant: "bad", layout: null });
    expect(r!.error).toBeTruthy();
  });

  it("counts motifs and coverage", () => {
    const body = resolveBody({ units: "cm", body: "male" });
    const arm = homeRegions(files, {})[0]!;
    const stats = regionStats(arm.layout!, body.regions["arm-left"].profile);
    expect(stats.motifs).toBe(2);
    expect(stats.elements).toBe(3); // the stars are a background layer now (docs/adr/0019)
    expect(stats.coveragePct).toBeGreaterThan(5);
    expect(stats.coveragePct).toBeLessThan(60);
    const empty = regionStats({ name: "e", elements: [] }, body.regions.torso.profile);
    expect(empty).toEqual({ coveragePct: 0, motifs: 0, elements: 0 });
  });
});
