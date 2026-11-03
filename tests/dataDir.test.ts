import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { expandUser, listDataFiles, resolveDataDir } from "../src/data/server/dataDir.ts";

describe("resolveDataDir", () => {
  const root = "/repo";
  const home = "/home/jan";

  it("returns null when the variable is unset or blank", () => {
    expect(resolveDataDir({}, root, home)).toBeNull();
    expect(resolveDataDir({ TATTOO_DATA_DIR: "  " }, root, home)).toBeNull();
  });

  it("expands ~ and keeps spaces in folder names", () => {
    expect(resolveDataDir({ TATTOO_DATA_DIR: "~/Your Secure Cloud/Lib/data" }, root, home)).toBe(
      "/home/jan/Your Secure Cloud/Lib/data",
    );
  });

  it("resolves relative paths against the repo root", () => {
    expect(resolveDataDir({ TATTOO_DATA_DIR: "../data" }, root, home)).toBe("/data");
  });

  it("only expands a leading ~", () => {
    expect(expandUser("~", home)).toBe(home);
    expect(expandUser("/a/~/b", home)).toBe("/a/~/b");
    expect(expandUser("~other/x", home)).toBe("~other/x");
  });
});

describe("listDataFiles", () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "tattoo-data-"));
    await writeFile(path.join(dir, "ideas.pdf"), "x");
    await writeFile(path.join(dir, ".DS_Store"), "x");
    await mkdir(path.join(dir, "existing"));
    await writeFile(path.join(dir, "existing", "photo1.jpg"), "xyz");
    await mkdir(path.join(dir, ".hidden"));
    await writeFile(path.join(dir, ".hidden", "secret.txt"), "x");
    await mkdir(path.join(dir, "refs"));
  });

  afterAll(() => rm(dir, { recursive: true, force: true }));

  it("lists files recursively, sorted, without dot entries", async () => {
    const listing = await listDataFiles(dir);
    expect(listing.status).toBe("ok");
    if (listing.status !== "ok") return;
    expect(listing.files.map((f) => f.path)).toEqual(["existing/photo1.jpg", "ideas.pdf"]);
    expect(listing.files[0]?.size).toBe(3);
    expect(listing.truncated).toBe(false);
  });

  it("truncates at maxFiles", async () => {
    const listing = await listDataFiles(dir, { maxFiles: 1 });
    expect(listing.status === "ok" && listing.truncated).toBe(true);
  });

  it("reports a missing folder or a file instead of a folder", async () => {
    expect(await listDataFiles(path.join(dir, "nope"))).toMatchObject({
      status: "error",
      message: "folder not found",
    });
    expect(await listDataFiles(path.join(dir, "ideas.pdf"))).toMatchObject({
      status: "error",
      message: "not a folder",
    });
  });
});
