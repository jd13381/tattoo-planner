// Layer operations behind the Layers panel and the Background view (docs/adr/0019).
import { describe, expect, it } from "vitest";
import { PLACEHOLDERS } from "../src/body/inputs.ts";
import { buildProfile } from "../src/body/profile.ts";
import {
  addLayer,
  addShape,
  addStroke,
  coverSummary,
  deleteLayer,
  duplicateLayer,
  layerIdFor,
  moveLayerTo,
  moveShape,
  NEW_LAYER_GAP_CM,
  removeShape,
  setCover,
  shapeAnchor,
  shapeFromDrag,
  sourceLabel,
  thinStroke,
} from "../src/editor/backgroundOps.ts";
import { layoutSchema, type BackgroundLayer, type Layout } from "../src/layout/schema.ts";

const profile = buildProfile(PLACEHOLDERS);
const base: Layout = {
  name: "t",
  elements: [
    { id: "bg-stars", type: "figure", asset: "moon", position: { u: 0, v: 0.5 }, size_cm: { h: 5 } },
  ],
};
const ids = (l: Layout) => (l.backgrounds ?? []).map((b) => b.id);

describe("layer list operations", () => {
  it("adds a whole-region layer on top with a free id and the default gap", () => {
    const a = addLayer(base, { standard: "stars" });
    expect(a.selected).toBe(0);
    // The element already holds bg-stars: ids are shared between elements and layers.
    expect(ids(a.layout)).toEqual(["bg-stars-2"]);
    expect(a.layout.backgrounds![0]).toEqual({
      id: "bg-stars-2",
      source: { standard: "stars" },
      gap_cm: NEW_LAYER_GAP_CM,
    });
    const b = addLayer(a.layout, { pattern: "snake-scales" }, "area");
    expect(b.selected).toBe(1);
    expect(b.layout.backgrounds![1]).toMatchObject({ id: "bg-snake-scales", cover: "area", shapes: [] });
    expect(layoutSchema.safeParse(b.layout).error?.issues).toBeUndefined();
  });

  it("builds ids from the source name", () => {
    expect(layerIdFor({ image: "night-sky" })).toBe("bg-night-sky");
    expect(layerIdFor({ pattern: "hatching" })).toBe("bg-hatching");
  });

  it("duplicates above, deletes and moves with the selection following", () => {
    let l = addLayer(base, { standard: "clouds" }).layout;
    l = addLayer(l, { standard: "smoke" }).layout;
    const d = duplicateLayer(l, 0);
    expect(ids(d.layout)).toEqual(["bg-clouds", "bg-clouds-2", "bg-smoke"]);
    expect(d.selected).toBe(1);
    const m = moveLayerTo(d.layout, 0, 5);
    expect(ids(m.layout)).toEqual(["bg-clouds-2", "bg-smoke", "bg-clouds"]);
    expect(m.selected).toBe(2);
    const x = deleteLayer(m.layout, 2);
    expect(ids(x.layout)).toEqual(["bg-clouds-2", "bg-smoke"]);
    expect(x.selected).toBe(1);
    expect(deleteLayer(base, 0)).toEqual({ layout: base, selected: null });
  });
});

describe("area editing", () => {
  const layer: BackgroundLayer = { id: "a", source: { standard: "stars" } };

  it("switches cover and keeps the area for a later switch back", () => {
    const area = addShape(layer, { kind: "rect", u: 0.5, v: 0.5, w_cm: 4, h_cm: 3 });
    expect(area.cover).toBe("area");
    const whole = setCover(area, "region");
    expect(whole.cover).toBeUndefined();
    expect(whole.shapes).toHaveLength(1);
    expect(coverSummary(whole)).toBe("whole region");
    expect(coverSummary(setCover(whole, "area"))).toBe("1 shape");
    const painted = addStroke(area, { radius_cm: 1, points: [{ u: 0.5, v: 0.5 }] });
    expect(coverSummary(painted)).toBe("1 shape, 1 stroke");
    expect(coverSummary(removeShape(setCover(layer, "area"), 0))).toMatch(/empty/);
  });

  it("moves shapes with u wrapping and v clamped; spans keep their height", () => {
    expect(moveShape({ kind: "ellipse", u: 0.95, v: 0.9, w_cm: 2, h_cm: 2 }, 0.1, 0.2)).toMatchObject({
      u: 0.05,
      v: 1,
    });
    expect(moveShape({ kind: "span", u: [0.9, 0.1], v: [0.7, 0.9] }, 0.2, 0.3)).toEqual({
      kind: "span",
      u: [0.1, 0.3],
      v: [0.8, 1],
    });
    const poly = moveShape(
      {
        kind: "polygon",
        points: [
          { u: 0.1, v: 0.1 },
          { u: 0.2, v: 0.1 },
          { u: 0.15, v: 0.2 },
        ],
      },
      -0.2,
      0,
    );
    expect(poly.kind === "polygon" && poly.points.map((p) => p.u)).toEqual([0.9, 0, 0.95]);
  });

  it("puts the anchor of a polygon across the seam on the seam side", () => {
    const a = shapeAnchor({
      kind: "polygon",
      points: [
        { u: 0.95, v: 0.2 },
        { u: 0.05, v: 0.2 },
        { u: 0, v: 0.4 },
      ],
    });
    expect(a.u).toBeCloseTo(0, 6);
    expect(a.v).toBeCloseTo(0.8 / 3, 6);
    expect(shapeAnchor({ kind: "span", u: [0.9, 0.1], v: [0.2, 0.4] }).u).toBeCloseTo(0, 6);
  });

  it("makes upright shapes from a drag and ignores tiny drags", () => {
    const y = profile.length / 2;
    const s = shapeFromDrag("rect", profile, 0, { x: -2, y: y - 1 }, { x: 2, y: y + 1 });
    expect(s).toEqual({ kind: "rect", u: 0, v: 0.5, w_cm: 4, h_cm: 2 });
    expect(shapeFromDrag("ellipse", profile, 0, { x: 0, y }, { x: 0.2, y: y + 3 })).toBeNull();
  });

  it("thins brush paths to a point every step cm and keeps the last point", () => {
    const svg = Array.from({ length: 11 }, (_, i) => ({ x: i * 0.1, y: 0 }));
    const skin = svg.map((p) => ({ u: p.x / 100, v: 0.5 }));
    expect(thinStroke(svg, skin, 0.25).map((p) => p.u)).toEqual([0, 0.003, 0.006, 0.009, 0.01]);
    expect(thinStroke([{ x: 0, y: 0 }], [{ u: 0.2, v: 0.2 }])).toEqual([{ u: 0.2, v: 0.2 }]);
  });

  it("labels sources", () => {
    const label = (n: string) => (n === "stars" ? "Stars" : undefined);
    expect(sourceLabel({ standard: "stars" }, label)).toBe("Stars");
    expect(sourceLabel({ pattern: "hatching" }, label)).toBe("hatching");
    expect(sourceLabel({ image: "sky", tile_cm: 10 }, label)).toBe("image sky");
  });
});
