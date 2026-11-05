import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assetPath,
  findAssetImage,
  imageContentType,
  isInside,
  listAssets,
  parseEntryPatch,
  parseManifestText,
  resolveInside,
  updateAssetEntry,
} from "../server/assetsApi.ts";

describe("imageContentType", () => {
  it("maps image extensions case-insensitively", () => {
    expect(imageContentType("arm-photos/anubis1_nr.JPG")).toEqual({ ok: true, type: "image/jpeg" });
    expect(imageContentType("a.jpeg")).toEqual({ ok: true, type: "image/jpeg" });
    expect(imageContentType("a.png")).toEqual({ ok: true, type: "image/png" });
    expect(imageContentType("a.WebP")).toEqual({ ok: true, type: "image/webp" });
    expect(imageContentType("a.gif")).toMatchObject({ ok: true });
    expect(imageContentType("a.avif")).toMatchObject({ ok: true });
  });

  it("rejects HEIC with a hint and anything that is not an image", () => {
    const heic = imageContentType("photo.HEIC");
    expect(heic).toMatchObject({ ok: false, status: 415 });
    if (!heic.ok) expect(heic.message).toContain("JPEG");
    expect(imageContentType("ideas.pdf")).toMatchObject({ ok: false, status: 415 });
    expect(imageContentType("manifest.yaml")).toMatchObject({ ok: false });
    expect(imageContentType("noext")).toMatchObject({ ok: false });
  });
});

describe("assetPath", () => {
  const dir = "/data/tattoo";
  it("accepts relative paths inside the folder, with spaces", () => {
    expect(assetPath(dir, "refs/medusa 01.jpg")).toEqual({
      ok: true,
      path: "/data/tattoo/refs/medusa 01.jpg",
    });
    expect(assetPath(dir, "./a.png")).toEqual({ ok: true, path: "/data/tattoo/a.png" });
  });

  it("rejects absolute paths, .., backslashes, ~ and NUL", () => {
    for (const bad of [
      "/etc/passwd",
      "../secret.png",
      "refs/../../x.png",
      "refs/..",
      "C:/x.png",
      "refs\\x.png",
      "~/x.png",
      "a\0.png",
      "",
      ".",
    ])
      expect(assetPath(dir, bad).ok, bad).toBe(false);
  });

  it("isInside is strict", () => {
    expect(isInside("/a", "/a/b")).toBe(true);
    expect(isInside("/a", "/a")).toBe(false);
    expect(isInside("/a", "/ab")).toBe(false);
    expect(isInside("/a", "/")).toBe(false);
  });
});

describe("parseManifestText", () => {
  it("keeps valid entries and turns invalid ones into warnings", () => {
    const r = parseManifestText(
      [
        "version: 1",
        "assets:",
        "  - { id: ok-one, file: refs/a.jpg, kind: reference }",
        "  - { id: Bad_Id, file: refs/b.jpg, kind: reference }",
        "  - { id: ok-one, file: refs/c.jpg, kind: reference }",
        "  - { id: no-file, kind: reference }",
        "extra: 1",
      ].join("\n"),
    );
    expect("error" in r).toBe(false);
    if ("error" in r) return;
    expect(r.assets.map((a) => a.id)).toEqual(["ok-one"]);
    expect(r.assets[0]!.tags).toEqual([]);
    expect(r.warnings).toHaveLength(4);
    expect(r.warnings.join("\n")).toContain("duplicate");
    expect(r.warnings.join("\n")).toContain("extra");
  });

  it("reports syntax errors and an empty file as no assets", () => {
    expect(parseManifestText("assets: [")).toHaveProperty("error");
    expect(parseManifestText("")).toEqual({ assets: [], warnings: [] });
  });
});

describe("listAssets and findAssetImage", () => {
  let root: string;
  let dir: string;
  beforeAll(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "tattoo-assets-"));
    dir = path.join(root, "data");
    await mkdir(path.join(dir, "refs"), { recursive: true });
    await writeFile(path.join(dir, "refs", "a.jpg"), "jpeg bytes");
    await writeFile(path.join(dir, "refs", "b.HEIC"), "heic bytes");
    await writeFile(path.join(root, "outside.png"), "secret");
    await symlink(path.join(root, "outside.png"), path.join(dir, "refs", "escape.png"));
    await symlink(path.join(dir, "refs", "a.jpg"), path.join(dir, "refs", "inside-link.jpg"));
    await writeFile(
      path.join(dir, "manifest.yaml"),
      [
        "assets:",
        "  - { id: a, file: refs/a.jpg, kind: reference, tags: [medusa] }",
        "  - { id: heic, file: refs/b.HEIC, kind: reference }",
        "  - { id: gone, file: refs/missing.jpg, kind: reference }",
        "  - { id: escape, file: refs/escape.png, kind: reference }",
        "  - { id: link, file: refs/inside-link.jpg, kind: reference }",
        "  - { id: dotdot, file: ../outside.png, kind: reference }",
      ].join("\n"),
    );
  });
  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("is unset without a folder and empty without a manifest", async () => {
    expect(await listAssets(null)).toEqual({ status: "unset" });
    const empty = await mkdtemp(path.join(os.tmpdir(), "tattoo-empty-"));
    expect(await listAssets(empty)).toEqual({ status: "ok", assets: [], manifestFound: false, warnings: [] });
    await rm(empty, { recursive: true });
    expect(await listAssets(path.join(root, "nope"))).toMatchObject({ status: "error" });
  });

  it("lists assets with an existence check and warns about escaping paths", async () => {
    const r = await listAssets(dir);
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.manifestFound).toBe(true);
    const exists = Object.fromEntries(r.assets.map((a) => [a.id, a.exists]));
    expect(exists).toEqual({ a: true, heic: true, gone: false, escape: false, link: true, dotdot: false });
    expect(r.warnings.some((w) => w.startsWith("escape:"))).toBe(true);
    expect(r.warnings.some((w) => w.startsWith("dotdot:"))).toBe(true);
  });

  it("serves only manifest images inside the folder", async () => {
    expect(await findAssetImage(dir, "a")).toMatchObject({ ok: true, type: "image/jpeg" });
    expect(await findAssetImage(dir, "link")).toMatchObject({ ok: true });
    expect(await findAssetImage(dir, "heic")).toMatchObject({ ok: false, status: 415 });
    expect(await findAssetImage(dir, "gone")).toMatchObject({ ok: false, status: 404 });
    expect(await findAssetImage(dir, "escape")).toMatchObject({ ok: false, status: 400 });
    expect(await findAssetImage(dir, "dotdot")).toMatchObject({ ok: false, status: 400 });
    expect(await findAssetImage(dir, "unknown")).toMatchObject({ ok: false, status: 404 });
    expect(await findAssetImage(dir, "../manifest")).toMatchObject({ ok: false, status: 400 });
  });

  it("resolveInside follows symlinks before the containment check", async () => {
    expect(await resolveInside(dir, "refs/escape.png")).toMatchObject({ ok: false });
    expect(await resolveInside(dir, "refs")).toMatchObject({ ok: false, message: "not a file" });
  });
});

describe("entry updates", () => {
  let root: string;
  beforeAll(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "assets-entry-"));
    await writeFile(
      path.join(root, "manifest.yaml"),
      "version: 1\nassets:\n  - id: medusa # keep\n    file: refs/medusa.jpg\n    kind: reference\n",
    );
  });
  afterAll(() => rm(root, { recursive: true, force: true }));

  it("accepts only tags, notes and hidden", () => {
    expect(parseEntryPatch({ tags: ["a"], notes: null, hidden: true })).toEqual({
      tags: ["a"],
      notes: null,
      hidden: true,
    });
    expect(parseEntryPatch({ file: "../x" })).toBeNull();
    expect(parseEntryPatch({ tags: "a" })).toBeNull();
    expect(parseEntryPatch({ hidden: "yes" })).toBeNull();
    expect(parseEntryPatch(null)).toBeNull();
  });

  it("writes the change into manifest.yaml and keeps comments", async () => {
    expect(await updateAssetEntry(root, "medusa", { tags: ["face"], hidden: true })).toEqual({ ok: true });
    const listing = await listAssets(root);
    expect(listing).toMatchObject({ status: "ok", assets: [{ id: "medusa", tags: ["face"], hidden: true }] });
    expect(await readFile(path.join(root, "manifest.yaml"), "utf8")).toContain("# keep");
    expect(await updateAssetEntry(root, "nope", { hidden: true })).toMatchObject({ ok: false, status: 404 });
    expect(await updateAssetEntry(root, "../x", {})).toMatchObject({ ok: false, status: 400 });
  });
});
