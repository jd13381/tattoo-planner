import { describe, expect, it } from "vitest";
import {
  assetReferences,
  deleteCheck,
  describeUse,
  isInUse,
  layoutAssetRefs,
  projectionPhotoKeys,
  usageBadge,
} from "../src/assets/references.ts";

const assets = [
  { id: "compass", file: "images/compass.png" },
  { id: "anubis-side", file: "arm-photos/anubis1_nr.JPG" },
  { id: "anubis-copy", file: "arm-photos/ANUBIS1_NR.jpg" },
  { id: "compass-edit-1", file: "edits/compass-edit-1.png", derived_from: "compass" },
  { id: "paper", file: "backgrounds/paper.png" },
  { id: "lonely", file: "images/lonely.png" },
];

const layouts = [
  {
    person: "me",
    name: "left-arm",
    text: `name: left-arm
elements:
  - { id: compass, type: figure, asset: compass, position: { u: 0, v: 0.5 }, size_cm: { h: 5 } }
  - { id: anubis, type: existing, asset: anubis-side, projection: anubis, position: { u: 0, v: 0.2 }, size_cm: { h: 9 } }
backgrounds:
  - { id: bg1, background_asset: paper }
`,
  },
  {
    person: "anna",
    name: "torso",
    text: "name: torso\nelements:\n  - { id: c2, type: figure, asset: compass }\n",
  },
  { person: "me", name: "broken", text: "name: [" },
];

const projections = [
  {
    person: "me",
    name: "anubis",
    text: `name: anubis
description: Anubis forearm
photos:
  - { file: arm-photos/other.jpg }
  - { file: arm-photos/anubis1_nr.JPG }
`,
  },
];

describe("assetReferences", () => {
  const usage = assetReferences({ assets, layouts, projections, sessions: ["lonely", "unknown"] });

  it("collects layout uses of every person, any asset key included", () => {
    expect(usage.compass).toEqual([
      { kind: "layout", person: "me", layout: "left-arm", element: "compass" },
      { kind: "layout", person: "anna", layout: "torso", element: "c2" },
      { kind: "derived", child: "compass-edit-1" },
    ]);
    expect(usage.paper).toEqual([{ kind: "layout", person: "me", layout: "left-arm", element: "bg1" }]);
  });

  it("matches projection photos case-insensitively, for every entry naming the file", () => {
    const p = { kind: "projection", person: "me", projection: "anubis", label: "Anubis forearm", photo: 2 };
    expect(usage["anubis-side"]).toEqual([
      { kind: "layout", person: "me", layout: "left-arm", element: "anubis" },
      p,
    ]);
    expect(usage["anubis-copy"]).toEqual([p]);
    expect(projectionPhotoKeys(projections).has("arm-photos/anubis1_nr.jpg")).toBe(true);
  });

  it("counts a photo's cleaned version as a use of the projection", () => {
    const withEdit = [
      ...assets,
      { id: "front", file: "photos/front.jpg" },
      { id: "front-edit-1", file: "edits/front-edit-1.png", derived_from: "front" },
    ];
    const text = `name: arm
photos:
  - { file: photos/front.jpg, cleaned: Edits/Front-Edit-1.png, cleaned_fit: stretch }
  - { file: photos/front.jpg, cleaned: photos/front.jpg }
`;
    const u = assetReferences({
      assets: withEdit,
      layouts: [],
      projections: [{ person: "me", name: "arm", text }],
    });
    const use = { kind: "projection", person: "me", projection: "arm", label: "arm", photo: 1 } as const;
    expect(u["front-edit-1"]).toEqual([{ ...use, cleaned: true }]);
    // A cleaned file equal to the photo counts once, as the photo.
    expect(u.front).toEqual([use, { ...use, photo: 2 }, { kind: "derived", child: "front-edit-1" }]);
    expect(isInUse(u["front-edit-1"])).toBe(true);
    expect(usageBadge(u["front-edit-1"])).toBe("1 projection");
    expect(deleteCheck(["front-edit-1"], u).projections).toHaveLength(1);
    expect(describeUse("front-edit-1", u["front-edit-1"]![0]!)).toBe(
      "front-edit-1: cleaned version of photo 1 of projection arm",
    );
    // The frames stay the photos: the edit does not become a tattoo photo.
    expect(projectionPhotoKeys([{ text }]).has("edits/front-edit-1.png")).toBe(false);
  });

  it("lists open studio sessions and leaves unused images out", () => {
    expect(usage.lonely).toEqual([{ kind: "session" }]);
    expect(usage["compass-edit-1"]).toBeUndefined();
    expect(usage.unknown).toBeUndefined();
  });

  it("summarises and describes uses", () => {
    expect(usageBadge(usage.compass)).toBe("2 layouts");
    expect(usageBadge(usage["anubis-side"])).toBe("1 layout · 1 projection");
    expect(usageBadge(undefined)).toBe("Unused");
    expect(usageBadge([{ kind: "derived", child: "x" }])).toBe("Unused");
    expect(isInUse([{ kind: "derived", child: "x" }])).toBe(false);
    expect(isInUse(usage.lonely)).toBe(true);
    expect(describeUse("compass", usage.compass![0]!)).toBe("compass: element compass in layout left-arm");
    expect(describeUse("anubis-side", usage["anubis-side"]![1]!)).toBe(
      "anubis-side: photo 2 of projection Anubis forearm",
    );
  });

  it("sorts uses for the trash dialog", () => {
    const c = deleteCheck(["compass", "anubis-side", "lonely"], usage);
    expect(c.inSession).toEqual(["lonely"]);
    expect(c.projections.map((p) => p.id)).toEqual(["anubis-side"]);
    expect(c.layouts.map((p) => p.id)).toEqual(["compass", "compass", "anubis-side"]);
  });

  it("walks nested structures for asset keys", () => {
    expect(
      layoutAssetRefs({
        elements: [{ id: "f", image: "not-a-ref" }],
        backgrounds: [
          { id: "bg", source: { image: "paper", tile_cm: 4 } },
          { id: "p", source: { pattern: "dots" } },
        ],
      }),
    ).toEqual([{ asset: "paper", element: "bg" }]);
    expect(layoutAssetRefs({ a: [{ id: "x", asset: "one", sub: { id: "y", cover_asset: "two" } }] })).toEqual(
      [
        { asset: "one", element: "x" },
        { asset: "two", element: "y" },
      ],
    );
  });
});
