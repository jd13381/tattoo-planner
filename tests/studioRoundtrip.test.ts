// The Image studio ↔ projection round trip (2026-11-09): studio edits of a body photo belong to the
// photo's person and are offered stacked on the photo in the projection picker.
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { listAssets } from "../server/assetsApi.ts";
import { inheritPersons } from "../src/assets/category.ts";
import { originalOf, photoFields, projectionPhotoGroups } from "../src/assets/projectionPhotos.ts";
import type { AssetInfo } from "../src/assets/types.ts";

function info(
  id: string,
  file: string,
  effectiveCategory: AssetInfo["effectiveCategory"],
  effectivePerson: string | null,
  extra: Partial<AssetInfo> = {},
): AssetInfo {
  return { id, file, kind: "x", tags: [], exists: true, effectiveCategory, effectivePerson, ...extra };
}

describe("inheritPersons", () => {
  it("gives an edit its original's person, along the chain, without touching the rest", () => {
    const list = [
      info("front", "photos/front.jpg", "measuring", "me"),
      info("front-edit-1", "edits/front-edit-1.png", "edit", null, { derived_from: "front" }),
      // An older chained entry: an edit of an edit.
      info("front-edit-2", "edits/front-edit-2.png", "edit", null, { derived_from: "front-edit-1" }),
      info("rose", "persons/anna/photos/rose.jpg", "existing", "anna"),
      info("rose-edit-1", "edits/rose-edit-1.png", "edit", null, { derived_from: "rose" }),
      info("idea", "images/idea.png", "reference", null),
      info("idea-edit-1", "edits/idea-edit-1.png", "edit", null, { derived_from: "idea" }),
      info("lost-edit-1", "edits/lost-edit-1.png", "edit", null, { derived_from: "lost" }),
      info("pinned", "edits/pinned.png", "edit", null, { derived_from: "front", person: "anna" }),
      info("loop-a", "edits/a.png", "edit", null, { derived_from: "loop-b" }),
      info("loop-b", "edits/b.png", "edit", null, { derived_from: "loop-a" }),
    ];
    const out = inheritPersons(list);
    const person = Object.fromEntries(out.map((a) => [a.id, a.effectivePerson]));
    expect(person).toEqual({
      front: "me",
      "front-edit-1": "me",
      "front-edit-2": "me",
      rose: "anna",
      "rose-edit-1": "anna",
      idea: null,
      "idea-edit-1": null,
      "lost-edit-1": null,
      pinned: "anna",
      "loop-a": null,
      "loop-b": null,
    });
    // Unchanged entries are the same objects; the category stays "edit".
    expect(out[0]).toBe(list[0]);
    expect(out[5]).toBe(list[5]);
    expect(out[1]!.effectiveCategory).toBe("edit");
  });

  it("is applied by the listing, which leaves the manifest as it is", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "tattoo-roundtrip-"));
    try {
      await mkdir(path.join(dir, "photos"), { recursive: true });
      await mkdir(path.join(dir, "edits"), { recursive: true });
      await writeFile(path.join(dir, "photos", "front.jpg"), "jpeg");
      await writeFile(path.join(dir, "edits", "front-edit-1.png"), "png");
      await writeFile(
        path.join(dir, "manifest.yaml"),
        [
          "assets:",
          "  - { id: front, file: photos/front.jpg, kind: arm-photo }",
          "  - { id: front-edit-1, file: edits/front-edit-1.png, kind: arm-photo, derived_from: front }",
        ].join("\n"),
      );
      const r = await listAssets(dir);
      expect(r.status).toBe("ok");
      if (r.status !== "ok") return;
      const edit = r.assets.find((a) => a.id === "front-edit-1")!;
      expect(edit.effectiveCategory).toBe("edit");
      expect(edit.effectivePerson).toBe(r.assets.find((a) => a.id === "front")!.effectivePerson);
      expect(edit.effectivePerson).not.toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("projectionPhotoGroups", () => {
  const assets = inheritPersons([
    info("anubis", "photos/anubis.jpg", "existing", "me"),
    info("front", "photos/front.jpg", "measuring", "me"),
    info("front-edit-1", "edits/front-edit-1.png", "edit", null, { derived_from: "front", tags: ["ink"] }),
    info("front-edit-2", "edits/front-edit-2.png", "edit", null, { derived_from: "front", hidden: true }),
    info("rose", "persons/anna/photos/rose.jpg", "existing", "anna"),
    info("rose-edit-1", "edits/rose-edit-1.png", "edit", null, { derived_from: "rose" }),
    info("idea", "images/idea.png", "reference", null),
    info("idea-edit-1", "edits/idea-edit-1.png", "edit", null, { derived_from: "idea" }),
    info("secret", "photos/secret.jpg", "measuring", "me", { hidden: true }),
  ]);

  it("stacks edits on the person's photos and keeps other persons and hidden images out", () => {
    const g = projectionPhotoGroups(assets, "me");
    expect(g.tattoos.map((c) => [c.photo.id, c.edits.map((e) => e.id)])).toEqual([["anubis", []]]);
    expect(g.measuring.map((c) => [c.photo.id, c.edits.map((e) => e.id)])).toEqual([
      ["front", ["front-edit-1"]],
    ]);
    expect(g.others.map((a) => a.id)).toEqual(["idea", "idea-edit-1"]);
    const anna = projectionPhotoGroups(assets, "anna");
    expect(anna.tattoos.map((c) => [c.photo.id, c.edits.map((e) => e.id)])).toEqual([
      ["rose", ["rose-edit-1"]],
    ]);
    expect(anna.measuring).toEqual([]);
  });

  it("shows a photo when the filter matches one of its edits", () => {
    const g = projectionPhotoGroups(assets, "me", "ink");
    expect(g.measuring.map((c) => c.photo.id)).toEqual(["front"]);
    expect(g.tattoos).toEqual([]);
    expect(g.others).toEqual([]);
  });
});

describe("photoFields", () => {
  const assets = [
    info("front", "photos/front.jpg", "measuring", "me"),
    info("front-edit-1", "edits/front-edit-1.png", "edit", "me", { derived_from: "front" }),
    info("idea", "images/idea.png", "reference", null),
    info("idea-edit-1", "edits/idea-edit-1.png", "edit", null, { derived_from: "idea" }),
  ];
  const byId = (id: string) => assets.find((a) => a.id === id)!;

  it("keeps the photo as the frame and draws the edit as its cleaned version", () => {
    expect(photoFields(byId("front-edit-1"), assets)).toEqual({
      file: "photos/front.jpg",
      cleaned: "edits/front-edit-1.png",
    });
    expect(photoFields(byId("front"), assets)).toEqual({ file: "photos/front.jpg" });
    // An edit of an idea is no photo's cleaned version.
    expect(photoFields(byId("idea-edit-1"), assets)).toEqual({ file: "edits/idea-edit-1.png" });
    expect(originalOf(byId("front-edit-1"), assets)?.id).toBe("front");
    expect(originalOf(byId("front"), assets)).toBeNull();
  });
});
