import { describe, expect, it } from "vitest";
import { facets, filterAssets, NO_FILTER, pickableAssets, stepAsset } from "../src/assets/filter.ts";
import type { AssetInfo } from "../src/assets/types.ts";

const a = (id: string, kind: string, tags: string[], extra: Partial<AssetInfo> = {}): AssetInfo => ({
  id,
  file: `refs/${id}.jpg`,
  kind,
  tags,
  exists: true,
  effectiveCategory: kind === "existing" ? "existing" : kind === "arm-photo" ? "measuring" : "reference",
  effectivePerson: null,
  ...extra,
});

const assets = [
  a("medusa-01", "reference", ["medusa", "realistic"], { source: "Pinterest" }),
  a("rhonas-card", "card-art", ["rhonas", "mtg"]),
  a("ideas-p03-01", "idea", [], { notes: "Skull with a snake through the eye" }),
];

describe("asset filter", () => {
  it("shows everything without a filter", () => {
    expect(filterAssets(assets, NO_FILTER)).toHaveLength(3);
  });

  it("filters by kind, tag and words in id, notes and source", () => {
    expect(filterAssets(assets, { ...NO_FILTER, kind: "card-art" }).map((x) => x.id)).toEqual([
      "rhonas-card",
    ]);
    expect(filterAssets(assets, { ...NO_FILTER, tag: "medusa" }).map((x) => x.id)).toEqual(["medusa-01"]);
    expect(filterAssets(assets, { ...NO_FILTER, text: "SNAKE skull" }).map((x) => x.id)).toEqual([
      "ideas-p03-01",
    ]);
    expect(filterAssets(assets, { ...NO_FILTER, text: "pinterest" })).toHaveLength(1);
    expect(filterAssets(assets, { kind: "idea", tag: "", text: "medusa" })).toHaveLength(0);
  });

  it("counts facets, most frequent first", () => {
    expect(facets(["b", "a", "b"])).toEqual([
      { value: "b", count: 2 },
      { value: "a", count: 1 },
    ]);
  });
});

describe("pickable assets and stepping", () => {
  const list = [
    a("r1", "reference", []),
    a("c1", "card-art", []),
    a("r2", "reference", [], { hidden: true }),
    a("r3", "reference", []),
    a("r4", "reference", [], { exists: false }),
  ];

  it("leaves hidden images out unless they are in use", () => {
    expect(pickableAssets(list).map((x) => x.id)).toEqual(["r1", "c1", "r3", "r4"]);
    expect(pickableAssets(list, "r2").map((x) => x.id)).toContain("r2");
  });

  it("steps through visible, existing images of the same kind and wraps round", () => {
    expect(stepAsset(list, "r1", 1)?.id).toBe("r3");
    expect(stepAsset(list, "r3", 1)?.id).toBe("r1");
    expect(stepAsset(list, "r1", -1)?.id).toBe("r3");
    expect(stepAsset(list, "c1", 1)).toBeNull();
  });

  it("starts at the first or last image without a current one", () => {
    expect(stepAsset(list, undefined, 1, "reference")?.id).toBe("r1");
    expect(stepAsset(list, undefined, -1, "reference")?.id).toBe("r3");
    expect(stepAsset(list, "unknown", 1, "card-art")?.id).toBe("c1");
  });
});
