import { describe, expect, it } from "vitest";
import { assetSchema } from "../src/assets/manifest.ts";
import { assetIdFromPath, scanCandidates, scanKind } from "../src/assets/scan.ts";

describe("assets:scan", () => {
  it("derives ids from paths", () => {
    expect(assetIdFromPath("cards/Rhonas the Indomitable.jpg")).toBe("cards-rhonas-the-indomitable");
    expect(assetIdFromPath("arm-photos/anubis1_nr.JPG")).toBe("arm-photos-anubis1-nr");
    expect(assetIdFromPath("refs/__.png")).toBe("refs");
  });

  it("catalogues images in the known folders with the folder's kind", () => {
    const { candidates, unsupported, outside } = scanCandidates([
      "refs/pin/medusa.webp",
      "cards/rhonas.jpg",
      "cards/rhonas.txt",
      "existing/anubis.HEIC",
      "arm-photos/front.JPG",
      "ideas/page-01-img-01.png",
      "ideas.pdf",
      "loose.png",
      "exports/handout.png",
      "edits/medusa-edit-1.png",
      "new/pegasus.jpg",
      ".trash/x.png",
    ]);
    expect(candidates).toEqual([
      { id: "arm-photos-front", file: "arm-photos/front.JPG", kind: "arm-photo", tags: [] },
      { id: "cards-rhonas", file: "cards/rhonas.jpg", kind: "card-art", tags: [] },
      { id: "refs-pin-medusa", file: "refs/pin/medusa.webp", kind: "reference", tags: [] },
    ]);
    for (const c of candidates) expect(assetSchema.parse(c)).toEqual(c);
    expect(unsupported).toEqual(["existing/anubis.HEIC"]);
    expect(outside).toEqual(["loose.png", "new/pegasus.jpg"]);
  });

  it("knows the new sub-folders, persons and backgrounds, and skips dot folders", () => {
    expect(scanKind("photos/measuring/front.jpg")).toBe("arm-photo");
    expect(scanKind("photos/existing/rose.jpg")).toBe("existing");
    expect(scanKind("photos/side.jpg")).toBe("arm-photo");
    expect(scanKind("persons/anna/photos/existing/a.jpg")).toBe("existing");
    expect(scanKind("persons/anna/photos/b.jpg")).toBe("arm-photo");
    expect(scanKind("persons/anna/layouts/x.png")).toBeNull();
    expect(scanKind("persons/Bad_Id/photos/b.jpg")).toBeNull();
    expect(scanKind("backgrounds/paper.png")).toBe("background");
    expect(scanKind("photos/.trash/x.png")).toBeNull();
    expect(scanKind(".trash-pending/abc/files/images/a.png")).toBeNull();
    expect(scanKind("loose.png")).toBeNull();
    const { candidates, outside } = scanCandidates([
      "persons/anna/photos/a.jpg",
      "persons/anna/notes/b.png",
      ".trash/2026/images/old.png",
    ]);
    expect(candidates.map((c) => c.id)).toEqual(["persons-anna-photos-a"]);
    expect(outside).toEqual([]);
  });
});
