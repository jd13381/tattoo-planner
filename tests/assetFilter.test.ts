import { describe, expect, it } from "vitest";
import { facets, filterAssets, NO_FILTER } from "../src/assets/filter.ts";
import type { AssetInfo } from "../src/assets/types.ts";

const a = (id: string, kind: string, tags: string[], extra: Partial<AssetInfo> = {}): AssetInfo => ({
  id,
  file: `refs/${id}.jpg`,
  kind,
  tags,
  exists: true,
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
