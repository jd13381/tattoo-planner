import { describe, expect, it } from "vitest";
import {
  burstKey,
  checkVariantName,
  clampSelection,
  deleteAt,
  dropIndex,
  duplicateAt,
  elementIssues,
  followSelection,
  moveLayer,
  moveLayerTo,
  nextBurst,
} from "../src/editor/layoutOps.ts";
import type { Layout, LayoutElement } from "../src/layout/schema.ts";

const fig = (id: string, extra: Partial<LayoutElement> = {}): LayoutElement =>
  ({ id, type: "figure", position: { u: 0, v: 0.5 }, size_cm: { h: 10 }, ...extra }) as LayoutElement;

const layout: Layout = { name: "v1", elements: [fig("a"), fig("b"), fig("c")] };
const ids = (l: Layout) => l.elements.map((e) => e.id);

describe("layout operations", () => {
  it("deletes and clears the selection", () => {
    const r = deleteAt(layout, 1);
    expect(ids(r.layout)).toEqual(["a", "c"]);
    expect(r.selected).toBeNull();
    expect(ids(layout)).toEqual(["a", "b", "c"]);
    expect(deleteAt(layout, 5).layout).toBe(layout);
  });

  it("duplicates on top with a free id and selects the copy", () => {
    const r = duplicateAt(layout, 0);
    expect(ids(r.layout)).toEqual(["a", "b", "c", "a-2"]);
    expect(r.selected).toBe(3);
    expect(duplicateAt(r.layout, 0).layout.elements[4]!.id).toBe("a-3");
  });

  it("moves one layer and keeps the element selected", () => {
    expect(moveLayer(layout, 0, 1)).toEqual({
      layout: { ...layout, elements: [fig("b"), fig("a"), fig("c")] },
      selected: 1,
    });
    const top = moveLayer(layout, 2, 1);
    expect(top.layout).toBe(layout);
    expect(top.selected).toBe(2);
  });

  it("moves an element to any layer", () => {
    expect(ids(moveLayerTo(layout, 0, 2).layout)).toEqual(["b", "c", "a"]);
    expect(ids(moveLayerTo(layout, 2, 0).layout)).toEqual(["c", "a", "b"]);
    expect(moveLayerTo(layout, 2, 9).selected).toBe(2);
    expect(moveLayerTo(layout, 1, 1).layout).toBe(layout);
  });

  it("maps a drop in the top-first list to a layer index", () => {
    // Layers a(0) b(1) c(2); the list shows c, b, a.
    expect(ids(moveLayerTo(layout, 0, dropIndex(0, 2, true)).layout)).toEqual(["b", "c", "a"]);
    expect(ids(moveLayerTo(layout, 0, dropIndex(0, 2, false)).layout)).toEqual(["b", "a", "c"]);
    expect(ids(moveLayerTo(layout, 2, dropIndex(2, 0, false)).layout)).toEqual(["c", "a", "b"]);
    expect(ids(moveLayerTo(layout, 2, dropIndex(2, 0, true)).layout)).toEqual(["a", "c", "b"]);
    expect(dropIndex(1, 1, true)).toBe(2);
    expect(dropIndex(1, 1, false)).toBe(1);
  });

  it("follows the selected element through undo and redo", () => {
    const swapped = moveLayer(layout, 0, 1).layout;
    expect(followSelection(layout, swapped, 0)).toBe(1);
    const renamed = { ...layout, elements: [fig("a"), fig("b2"), fig("c")] };
    expect(followSelection(layout, renamed, 1)).toBe(1);
    expect(followSelection(layout, deleteAt(layout, 1).layout, 1)).toBeNull();
    expect(followSelection(layout, layout, null)).toBeNull();
  });

  it("clamps a stale selection", () => {
    expect(clampSelection(2, 3)).toBe(2);
    expect(clampSelection(3, 3)).toBeNull();
    expect(clampSelection(null, 3)).toBeNull();
  });
});

describe("checkVariantName", () => {
  const taken = ["v1-baseline", "v1-baseline-2"];
  it("accepts a free name, normalised", () => {
    expect(checkVariantName("  V1-Try ", taken, "v1-baseline")).toEqual({ status: "ok", name: "v1-try" });
  });
  it("warns about an existing name and the open variant", () => {
    expect(checkVariantName("v1-baseline-2", taken, "v1-baseline").status).toBe("exists");
    const same = checkVariantName("v1-baseline", taken, "v1-baseline");
    expect(same.status).toBe("exists");
    expect(same.status !== "ok" && same.message).toMatch(/same as Save/);
  });
  it("rejects what the server rejects", () => {
    expect(checkVariantName("", taken).status).toBe("invalid");
    expect(checkVariantName("-a", taken).status).toBe("invalid");
    const r = checkVariantName("my try_2", taken);
    expect(r.status).toBe("invalid");
    expect(r.status === "invalid" && r.message).toMatch(/space, “_”/);
    expect(checkVariantName("a".repeat(64), taken).status).toBe("ok");
    expect(checkVariantName("a".repeat(65), taken).status).toBe("invalid");
  });
});

describe("elementIssues", () => {
  it("flags missing height, image and manifest entries", () => {
    const noH = fig("x", { size_cm: { h: null } } as Partial<LayoutElement>);
    expect(elementIssues(noH, ["height not set"], null)).toEqual([
      "height not set (drawn 10 cm tall)",
      "no reference image",
    ]);
    const withAsset = fig("y", { asset: "medusa" } as Partial<LayoutElement>);
    expect(elementIssues(withAsset, [], null)).toEqual([]);
    expect(elementIssues(withAsset, [], new Set(["other"]))).toEqual(["medusa is not in the manifest"]);
    expect(elementIssues(withAsset, [], new Set(["medusa"]), "no data folder")).toEqual(["no data folder"]);
  });
  it("does not ask lines or bands for images", () => {
    const line = { id: "l", type: "line", color: "red", width_cm: 1, points: [] } as unknown as LayoutElement;
    expect(elementIssues(line, [], new Set())).toEqual([]);
  });
});

describe("nextBurst", () => {
  it("keeps one burst per target while edits come quickly", () => {
    const a = nextBurst(null, "u", 0);
    const b = nextBurst(a, "u", 1000);
    expect(burstKey(b)).toBe(burstKey(a));
    const c = nextBurst(b, "u", 1000 + 1501);
    expect(burstKey(c)).not.toBe(burstKey(b));
    const d = nextBurst(c, "v", 2600);
    expect(burstKey(d)).not.toBe(burstKey(c));
    expect(burstKey(nextBurst(d, "u", 2700))).not.toBe(burstKey(c));
  });
});
