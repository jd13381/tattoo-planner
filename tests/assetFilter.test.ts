import { describe, expect, it } from "vitest";
import {
  facets,
  filterAssets,
  hiddenInSection,
  NO_FILTER,
  photoCount,
  pickableAssets,
  pickerAssets,
  sectionAssets,
  sectionCounts,
} from "../src/assets/filter.ts";
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

describe("pickable assets", () => {
  const list = [
    a("r1", "reference", []),
    a("c1", "card-art", [], { effectiveCategory: "background" }),
    a("r2", "reference", [], { hidden: true }),
    a("r3", "reference", []),
    a("r4", "reference", [], { exists: false }),
  ];

  it("leaves hidden images out unless they are in use", () => {
    expect(pickableAssets(list).map((x) => x.id)).toEqual(["r1", "c1", "r3", "r4"]);
    expect(pickableAssets(list, "r2").map((x) => x.id)).toContain("r2");
  });
});

describe("sections and pickers", () => {
  const list = [
    a("idea", "reference", []),
    a("gen", "idea", [], { effectiveCategory: "generated" }),
    a("edit", "reference", [], { effectiveCategory: "edit", hidden: true }),
    a("paper", "background", [], { effectiveCategory: "background" }),
    a("front", "arm-photo", [], { effectivePerson: "me" }),
    a("anubis", "arm-photo", [], { effectiveCategory: "existing", effectivePerson: "me" }),
    a("anna", "arm-photo", [], { effectiveCategory: "existing", effectivePerson: "anna", exists: false }),
  ];
  const ctx = {
    usage: { idea: [{ kind: "layout" as const, person: "me", layout: "l", element: "e" }] },
    person: "me",
    showHidden: false,
  };
  const ids = (xs: AssetInfo[]) => xs.map((x) => x.id);

  it("shows each section's images, the current person's photos only, hidden ones apart", () => {
    expect(ids(sectionAssets(list, "studio", ctx))).toEqual(["gen"]);
    expect(ids(sectionAssets(list, "studio", { ...ctx, showHidden: true }))).toEqual(["gen", "edit"]);
    expect(ids(sectionAssets(list, "existing", ctx))).toEqual(["anubis"]);
    expect(ids(sectionAssets(list, "existing", { ...ctx, person: "anna" }))).toEqual(["anna"]);
    expect(ids(sectionAssets(list, "hidden", ctx))).toEqual(["edit"]);
    expect(ids(sectionAssets(list, "missing", ctx))).toEqual(["anna"]);
    expect(ids(sectionAssets(list, "unused", ctx))).not.toContain("idea");
    expect(sectionAssets(list, "unused", { ...ctx, usage: null })).toEqual([]);
    expect(sectionCounts(list, ctx)).toMatchObject({ all: 6, ideas: 1, studio: 1, measuring: 1, hidden: 1 });
    expect(hiddenInSection(list, "studio", ctx)).toBe(1);
    expect(hiddenInSection(list, "hidden", ctx)).toBe(0);
  });

  it("offers the library in pickers, photos and backgrounds on request", () => {
    expect(ids(pickerAssets(list))).toEqual(["idea", "gen"]);
    expect(ids(pickerAssets(list, { backgrounds: true }))).toEqual(["idea", "gen", "paper"]);
    expect(ids(pickerAssets(list, { photos: true }))).toEqual(["idea", "gen", "front", "anubis", "anna"]);
    expect(ids(pickerAssets(list, {}, "front"))).toEqual(["idea", "gen", "front"]);
    expect(ids(pickerAssets(list, {}, "edit"))).toEqual(["idea", "gen", "edit"]);
    expect(photoCount(list)).toBe(3);
  });
});
