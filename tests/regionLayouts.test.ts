// Layouts on every body region (docs/adr/0011): the unwrap pipeline seen from outside on mirrored
// regions, zones per region kind, the layout's `region` key and the handout wording.
import { describe, expect, it } from "vitest";
import { resolveBody } from "../src/body/body.ts";
import type { RegionProfile } from "../src/body/profile.ts";
import { REGION_IDS, type RegionId } from "../src/body/regions.ts";
import { layoutToTexture } from "../src/body/uv.ts";
import { formatPointCm, nudgeElement, regionNames } from "../src/editor/nudge.ts";
import { svgToSkin } from "../src/editor/resize.ts";
import { textureToLayout } from "../src/editor/stroke.ts";
import { coverageRows } from "../src/export/handout.ts";
import { unwrapAxisMarks } from "../src/export/pdfLayout.ts";
import { HANDOUT_EN, handoutText } from "../src/export/strings.ts";
import type { Layout, LayoutElement } from "../src/layout/schema.ts";
import { classify, OUTSIDE } from "../src/layout/shapes.ts";
import { newLayoutText, parseLayout, updateLayoutText } from "../src/layout/yamlDoc.ts";
import { coverage, zoneOf, ZONES_BY_KIND } from "../src/metrics/coverage.ts";
import { screenX } from "../src/render/unwrapRows.ts";
import { viewU } from "../src/viewer/views.ts";

const body = resolveBody(null);
const P = (id: RegionId): RegionProfile => body.regions[id].profile;

const figure = (u: number, v = 0.5): LayoutElement => ({
  type: "figure",
  id: "fig",
  position: { u, v },
  size_cm: { h: 6, w: 4 },
});

/** Mean column of the element's cells, relative to the image centre (px; positive = right). */
function meanColumn(profile: RegionProfile, el: LayoutElement, centerU = 0): number {
  const layout: Layout = { name: "t", elements: [el] };
  const cls = classify(layout, profile, 4, undefined, centerU);
  let sum = 0;
  let n = 0;
  for (let j = 0; j < cls.height; j++)
    for (let i = 0; i < cls.width; i++) {
      const v = cls.cells[j * cls.width + i]!;
      if (v !== 0 && v !== OUTSIDE) {
        sum += i;
        n++;
      }
    }
  expect(n).toBeGreaterThan(0);
  return sum / n - cls.width / 2;
}

describe("the unwrap on mirrored regions", () => {
  it("draws lateral (u = 0.25) left of the outer line on the left arm and right of it on the right arm", () => {
    expect(meanColumn(P("arm-left"), figure(0.1))).toBeLessThan(0);
    expect(meanColumn(P("arm-right"), figure(0.1))).toBeGreaterThan(0);
    expect(layoutToTexture(P("arm-right"), 0.1, 0.5).x).toBeGreaterThan(0.5);
    expect(screenX(0.1, 0, 30, 1)).toBeCloseTo(3);
    expect(screenX(0.1, 0, 30)).toBeCloseTo(-3);
  });

  it("puts the torso's front right of its right flank, as seen from outside", () => {
    expect(meanColumn(P("torso"), figure(0.1))).toBeGreaterThan(0);
    // Centred on the front, the chest piece sits in the middle.
    expect(Math.abs(meanColumn(P("torso"), figure(0.25), 0.25))).toBeLessThan(1);
  });

  it("round-trips texture, editor and layout coordinates on every region", () => {
    for (const id of REGION_IDS) {
      const p = P(id);
      for (const u of [0.05, 0.2, 0.4, 0.8]) {
        const t = layoutToTexture(p, u, 0.4);
        const back = textureToLayout(p, t.x, t.y)!;
        expect(back.u, id).toBeCloseTo(u, 9);
        expect(back.v).toBeCloseTo(0.4, 9);
        // The editor's SVG x for that point, read back.
        const y = 0.4 * p.length;
        const x = screenX(u, 0.5, p.circumferenceAt(y), p.mirrored ? 1 : -1);
        expect(svgToSkin(p, 0.5, x, p.length - y).u, id).toBeCloseTo(u, 9);
      }
    }
  });

  it("nudges right on screen on every region", () => {
    for (const id of REGION_IDS) {
      const p = P(id);
      const el = figure(0.1);
      const moved = nudgeElement(el, p, 2, 0) as Extract<LayoutElement, { type: "figure" }>;
      const before = layoutToTexture(p, 0.1, 0.5).x;
      const after = layoutToTexture(p, moved.position.u, 0.5).x;
      expect(after, id).toBeGreaterThan(before);
    }
  });

  it("marks the PDF unwrap's centre lines the mirrored way round", () => {
    const plain = unwrapAxisMarks(30, 40);
    const mirrored = unwrapAxisMarks(30, 40, true);
    expect(plain.find((m) => m.side === "lateral")!.fx).toBeLessThan(0.5);
    expect(mirrored.find((m) => m.side === "lateral")!.fx).toBeGreaterThan(0.5);
  });

  it("names the region's lines and start in the readouts", () => {
    expect(formatPointCm(P("arm-left"), { u: 0.1, v: 0.5 })).toContain("lateral");
    const torso = formatPointCm(P("torso"), { u: 0.1, v: 0.5 }, regionNames("torso"));
    expect(torso).toContain("towards front");
    expect(torso).toContain("from waist");
  });
});

describe("zones per region", () => {
  it("splits a leg into shin, calf, knee and thigh front and back", () => {
    const p = P("leg-left");
    if (p.kind !== "leg") throw new Error("not a leg");
    expect(zoneOf(p, 0, 10)).toBe("shin");
    expect(zoneOf(p, 0.5, 10)).toBe("calf");
    expect(zoneOf(p, 0.5, p.kneeAt)).toBe("knee");
    expect(zoneOf(p, 0.9, p.kneeAt + 20)).toBe("thigh-front");
    expect(zoneOf(p, 0.6, p.kneeAt + 20)).toBe("thigh-back");
  });

  it("splits the torso into chest, stomach, upper and lower back and the flanks", () => {
    const p = P("torso");
    if (p.kind !== "torso") throw new Error("not the torso");
    expect(zoneOf(p, 0.25, p.chestAt)).toBe("chest");
    expect(zoneOf(p, 0.25, 3)).toBe("stomach");
    expect(zoneOf(p, 0.75, p.chestAt)).toBe("back-upper");
    expect(zoneOf(p, 0.75, 3)).toBe("back-lower");
    expect(zoneOf(p, 0.02, 10)).toBe("flanks");
    expect(zoneOf(p, 0.48, 10)).toBe("flanks");
  });

  it("counts every cm² of a region in exactly one zone", () => {
    for (const id of ["leg-right", "torso"] as const) {
      const p = P(id);
      const layout: Layout = { name: "t", elements: [figure(0.25)] };
      const cov = coverage(classify(layout, p, 3), p);
      expect(cov.kind).toBe(p.kind);
      const zones = ZONES_BY_KIND[p.kind].map((z) => cov.zones[z.id]!.area);
      expect(zones.reduce((a, b) => a + b)).toBeCloseTo(cov.total.area, 6);
      expect(cov.total.byCategory.figure).toBeCloseTo(24, -0.5);
      const rows = coverageRows(cov, handoutText(id));
      expect(rows).toHaveLength(ZONES_BY_KIND[p.kind].length + 1);
      expect(rows.at(-1)![0]).toBe(id === "torso" ? "Whole torso" : "Whole leg");
    }
  });
});

describe("views per region", () => {
  it("faces each view's centre line", () => {
    expect(viewU(P("arm-left"))).toEqual({ front: 0.5, back: 0, medial: 0.75, lateral: 0.25 });
    expect(viewU(P("arm-right"))).toEqual({ front: 0.5, back: 0, medial: 0.75, lateral: 0.25 });
    expect(viewU(P("leg-left"))).toEqual({ front: 0, back: 0.5, medial: 0.75, lateral: 0.25 });
    expect(viewU(P("torso"))).toEqual({ front: 0.25, back: 0.75, medial: 0.5, lateral: 0 });
  });
});

describe("the layout's region", () => {
  const text = "# a comment\nname: chest-1\ndescription: x\nelements: []\n";

  it("defaults to the left arm and leaves files without a region alone", () => {
    const r = parseLayout(text);
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;
    expect(r.layout.region).toBeUndefined();
    expect(updateLayoutText(text, r.layout)).toBe(text);
  });

  it("writes the region right after the name and parses it back", () => {
    const r = parseLayout(text);
    if (!r.ok) throw new Error(r.error);
    const out = updateLayoutText(text, { ...r.layout, region: "torso" });
    expect(out).toBe("# a comment\nname: chest-1\nregion: torso\ndescription: x\nelements: []\n");
    expect(parseLayout(out)).toMatchObject({ ok: true, layout: { region: "torso" } });
    expect(newLayoutText({ name: "leg-1", region: "leg-left", elements: [] })).toContain(
      "name: leg-1\nregion: leg-left\n",
    );
    expect(parseLayout("name: x\nregion: tail\nelements: []\n")).toMatchObject({ ok: false });
  });
});

describe("handout wording per region", () => {
  it("keeps the left arm's text and names other regions their own way", () => {
    expect(handoutText("arm-left")).toBe(HANDOUT_EN);
    const t = handoutText("torso");
    expect(t.title).toBe("Torso piece");
    expect(t.views.medial.title).toBe("Left");
    expect(t.sides.lateral).toBe("front line");
    expect(t.designQuestions).toEqual([]);
    expect(t.cell.aboveWrist("12")).toBe("12 cm above the waist");
    expect(handoutText("leg-right").sideShort.outer).toBe("front");
  });
});
