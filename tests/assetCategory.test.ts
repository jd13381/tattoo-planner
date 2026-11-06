import { describe, expect, it } from "vitest";
import {
  categoryOf,
  dropCategory,
  folderFor,
  kindFor,
  personOf,
  personPath,
  sectionCategories,
} from "../src/assets/category.ts";
import { fileKey } from "../src/assets/manifestDoc.ts";

const e = (file: string, kind: string, extra: Record<string, unknown> = {}) => ({ file, kind, ...extra });

describe("categoryOf", () => {
  // Jan's older data folder: refs/, cards/, ideas/, existing/, arm-photos/, edits/, generated/.
  const projected = new Set([fileKey("arm-photos/anubis1_nr.JPG")]);

  it("sorts Jan's legacy folders into the sections", () => {
    expect(categoryOf(e("refs/pin/medusa.webp", "reference"), projected)).toBe("reference");
    expect(categoryOf(e("cards/rhonas.jpg", "card-art"), projected)).toBe("reference");
    expect(categoryOf(e("ideas/page-01-img-01.png", "idea"), projected)).toBe("reference");
    expect(categoryOf(e("existing/anubis.jpg", "existing"), projected)).toBe("existing");
    expect(categoryOf(e("arm-photos/front.JPG", "arm-photo"), projected)).toBe("measuring");
    expect(categoryOf(e("arm-photos/Lateral.jpg", "arm-photo"), projected)).toBe("measuring");
    expect(categoryOf(e("edits/medusa-edit-1.png", "reference", { derived_from: "medusa" }))).toBe("edit");
    expect(categoryOf(e("generated/skull-1.png", "idea", { tags: ["generated"] }))).toBe("generated");
  });

  it("makes a body photo a tattoo photo when a projection uses it, case-insensitively", () => {
    expect(categoryOf(e("arm-photos/anubis1_nr.JPG", "arm-photo"), projected)).toBe("existing");
    expect(categoryOf(e("arm-photos/ANUBIS1_NR.jpg", "arm-photo"), projected)).toBe("existing");
    expect(categoryOf(e("arm-photos/anubis1_nr.JPG", "arm-photo"))).toBe("measuring");
  });

  it("follows the new folders and lets an explicit category win", () => {
    expect(categoryOf(e("images/a.png", "reference"))).toBe("reference");
    expect(categoryOf(e("photos/measuring/front.jpg", "arm-photo"), projected)).toBe("measuring");
    expect(categoryOf(e("photos/existing/rose.jpg", "arm-photo"))).toBe("existing");
    expect(categoryOf(e("photos/side.jpg", "arm-photo"))).toBe("measuring");
    expect(categoryOf(e("backgrounds/paper.png", "reference"))).toBe("background");
    expect(categoryOf(e("images/x.png", "background"))).toBe("background");
    expect(categoryOf(e("persons/anna/photos/measuring/a.jpg", "arm-photo"))).toBe("measuring");
    expect(categoryOf(e("persons/anna/photos/b.jpg", "reference"))).toBe("measuring");
    expect(categoryOf(e("arm-photos/front.JPG", "arm-photo", { category: "existing" }))).toBe("existing");
    expect(categoryOf(e("images/a.png", "reference", { category: "measuring" }))).toBe("measuring");
    // An unknown value (a newer planner's) counts as missing.
    expect(categoryOf(e("images/a.png", "reference", { category: "future" }))).toBe("reference");
    // derived_from wins over the folder: a kept edit of a photo is an edit.
    expect(categoryOf(e("edits/front-edit-1.png", "arm-photo", { derived_from: "front" }))).toBe("edit");
  });
});

describe("personOf and folders", () => {
  it("gives photos a person and the library none", () => {
    expect(personOf(e("arm-photos/front.JPG", "arm-photo"), "measuring")).toBe("me");
    expect(personOf(e("persons/anna/photos/x.jpg", "arm-photo"), "existing")).toBe("anna");
    expect(personOf(e("photos/x.jpg", "arm-photo", { person: "bob" }), "existing")).toBe("bob");
    expect(personOf(e("images/a.png", "reference", { person: "bob" }), "reference")).toBeNull();
    expect(personPath("persons/Bad_Id/x.png")).toBeNull();
    expect(personPath("persons/anna/photos/x.png")).toEqual({ id: "anna", rest: "photos/x.png" });
  });

  it("puts new files in the section's folder", () => {
    expect(folderFor("reference", null)).toBe("images");
    expect(folderFor("generated", null)).toBe("generated");
    expect(folderFor("edit", null)).toBe("edits");
    expect(folderFor("background", null)).toBe("backgrounds");
    expect(folderFor("measuring", "me")).toBe("photos/measuring");
    expect(folderFor("existing", null)).toBe("photos/existing");
    expect(folderFor("existing", "anna")).toBe("persons/anna/photos/existing");
    expect(kindFor("measuring")).toBe("arm-photo");
    expect(kindFor("background")).toBe("background");
  });

  it("maps sidebar sections", () => {
    expect(sectionCategories("studio")).toEqual(["generated", "edit"]);
    expect(sectionCategories("unused")).toBeNull();
    expect(dropCategory("existing")).toBe("existing");
    expect(dropCategory("studio")).toBeNull();
    expect(dropCategory("all")).toBe("reference");
  });
});
