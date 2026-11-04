import { describe, expect, it } from "vitest";
import { assetSchema } from "../src/assets/manifest.ts";
import { assetIdFromPath, scanCandidates } from "../src/assets/scan.ts";

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
});
