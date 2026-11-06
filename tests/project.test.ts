import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { browseFolder } from "../server/project/browse.ts";
import { inspectFolder } from "../server/project/folder.ts";
import { migrateFolder } from "../server/project/migrate.ts";
import { ProjectStore } from "../server/project/store.ts";
import { addRecent, readUserConfig, userConfigFile } from "../server/project/userConfig.ts";
import { parseProjectText, newProjectText, updateProjectText } from "../src/project/yamlDoc.ts";

describe("project.yaml", () => {
  it("round-trips a new file", () => {
    const text = newProjectText({ name: " Jan's sleeve ", body: "male" });
    expect(parseProjectText(text)).toEqual({
      ok: true,
      project: { version: 1, name: "Jan's sleeve", body: "male" },
    });
  });

  it("keeps comments and unknown keys on update and removes a cleared height", () => {
    const original =
      "# mine\nversion: 1\nname: A # the name\nbody: female\nfuture: { x: 1 }\nheight_cm: 170\n";
    const text = updateProjectText(original, { name: "B", height_cm: null });
    expect(text).toContain("# mine");
    expect(text).toContain("name: B # the name");
    expect(text).toContain("future:");
    expect(text).not.toContain("height_cm");
    const parsed = parseProjectText(text);
    expect(parsed.ok && parsed.project).toMatchObject({ name: "B", body: "female", future: { x: 1 } });
  });

  it("refuses invalid values and newer versions", () => {
    expect(parseProjectText("version: 1\nname: A\nbody: alien\n").ok).toBe(false);
    expect(parseProjectText("version: 1\nname: ''\nbody: male\n").ok).toBe(false);
    expect(parseProjectText("version: 1\nname: A\nbody: male\nheight_cm: 9\n").ok).toBe(false);
    const newer = parseProjectText("version: 2\nname: A\nbody: male\n");
    expect(!newer.ok && newer.error).toContain("newer version");
    expect(() => updateProjectText("version: 1\nname: A\nbody: male\n", { height_cm: 1000 })).toThrow();
  });
});

describe("user config", () => {
  it("lives under XDG_CONFIG_HOME when it is absolute, else ~/.config", () => {
    expect(userConfigFile({}, "/home/u")).toBe("/home/u/.config/tattoo-planner/config.json");
    expect(userConfigFile({ XDG_CONFIG_HOME: "/x" }, "/home/u")).toBe("/x/tattoo-planner/config.json");
    expect(userConfigFile({ XDG_CONFIG_HOME: "rel" }, "/home/u")).toBe(
      "/home/u/.config/tattoo-planner/config.json",
    );
  });

  it("keeps recent projects unique and short", () => {
    const list = Array.from({ length: 10 }, (_, i) => `/p${i}`);
    expect(addRecent(list, "/p3").slice(0, 2)).toEqual(["/p3", "/p0"]);
    expect(addRecent(list, "/new")).toHaveLength(8);
  });
});

describe("projects on disk", () => {
  let tmp: string;
  let home: string;
  let configFile: string;
  let legacyConfig: string;

  const store = (envDir: string | null = null, legacy: string | null = legacyConfig) =>
    new ProjectStore({ envDir, configFile, home, legacyConfigDir: legacy });

  beforeEach(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), "tattoo-project-"));
    home = path.join(tmp, "home");
    configFile = path.join(home, ".config", "tattoo-planner", "config.json");
    legacyConfig = path.join(tmp, "repo", "config");
    await mkdir(path.join(legacyConfig, "layouts"), { recursive: true });
    await mkdir(path.join(legacyConfig, "projections"), { recursive: true });
    await writeFile(path.join(legacyConfig, "layouts", "v1.yaml"), "name: v1\n");
    await writeFile(path.join(legacyConfig, "projections", "anubis.yaml"), "name: anubis\n");
    await writeFile(path.join(legacyConfig, "measurements.yaml"), "arm: left\n");
    await mkdir(home, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it("starts with no project", async () => {
    const s = await store().status();
    expect(s).toMatchObject({ status: "none", path: null, locked: false, recent: [] });
    expect(await store().paths()).toEqual({
      dir: null,
      personDir: null,
      person: null,
      layoutsDir: null,
      projectionsDir: null,
      measurementsFile: null,
      readOnly: false,
    });
  });

  it("creates a project in a new folder, remembers it and lists it as recent", async () => {
    const dir = path.join(home, "Sleeve");
    const r = await store().create({ path: dir, name: "My sleeve", body: "female" });
    expect(r.migration).toBeNull();
    expect(r.project).toMatchObject({ status: "project", path: dir, name: "My sleeve", body: "female" });
    expect(await inspectFolder(dir)).toBe("project");
    expect(await readFile(path.join(dir, "manifest.yaml"), "utf8")).toContain("assets: []");
    expect(await readFile(path.join(dir, "layouts", "first-sketch.yaml"), "utf8")).toContain(
      "region: arm-left",
    );
    expect((await readUserConfig(configFile)).project).toBe(dir);
    const paths = await store().paths();
    expect(paths.layoutsDir).toBe(path.join(dir, "layouts"));
    expect(paths.measurementsFile).toBe(path.join(dir, "measurements.yaml"));
    expect((await store().close()).status).toBe("none");
    const after = await store().status();
    expect(after.recent).toEqual([{ path: dir, name: "My sleeve", available: true }]);
    expect((await store().open(dir)).status).toBe("project");
  });

  it("refuses to create in a folder with other files or in a project", async () => {
    const busy = path.join(home, "busy");
    await mkdir(busy);
    await writeFile(path.join(busy, "notes.txt"), "x");
    await expect(store().create({ path: busy, name: "A", body: "male" })).rejects.toMatchObject({
      status: 409,
    });
    await writeFile(path.join(home, ".DS_Store"), "x");
    const empty = path.join(home, "empty");
    await mkdir(empty);
    await writeFile(path.join(empty, ".DS_Store"), "x");
    await store().create({ path: empty, name: "A", body: "male" });
    await expect(store().create({ path: empty, name: "A", body: "male" })).rejects.toMatchObject({
      status: 409,
    });
    await expect(store().create({ path: "relative/x", name: "A", body: "male" })).rejects.toMatchObject({
      status: 400,
    });
    await expect(
      store().create({ path: path.join(home, "n"), name: "", body: "male" }),
    ).rejects.toMatchObject({
      status: 400,
    });
    await expect(
      store().create({ path: path.join(home, "a", "b"), name: "A", body: "male" }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("opens an old data folder as legacy and reads its layouts from the app's config/", async () => {
    const data = path.join(home, "data");
    await mkdir(data);
    await writeFile(path.join(data, "manifest.yaml"), "version: 1\nassets: []\n");
    const s = await store().open(data);
    expect(s).toMatchObject({ status: "legacy", name: "data", canMigrate: true });
    expect((await store().paths()).layoutsDir).toBe(path.join(legacyConfig, "layouts"));
    await expect(store().update({ name: "X" })).rejects.toMatchObject({ status: 409 });
    await expect(store().open(path.join(home, "nope"))).rejects.toMatchObject({ status: 404 });
  });

  it("lets TATTOO_DATA_DIR win and refuses switching then", async () => {
    const data = path.join(tmp, "seafile");
    await mkdir(data);
    const other = path.join(home, "other");
    await store().create({ path: other, name: "Other", body: "male" });
    const locked = store(data);
    expect(await locked.status()).toMatchObject({ status: "legacy", path: data, locked: true });
    await expect(locked.open(other)).rejects.toMatchObject({ status: 409 });
    await expect(locked.close()).rejects.toMatchObject({ status: 409 });
    expect((await store(path.join(tmp, "gone")).status()).problem).toContain("not found");
  });

  it("reports a remembered folder that disappeared", async () => {
    const dir = path.join(home, "p");
    await store().create({ path: dir, name: "P", body: "male" });
    await rm(dir, { recursive: true });
    const s = await store().status();
    expect(s.status).toBe("none");
    expect(s.problem).toContain(dir);
    expect(s.recent[0]).toMatchObject({ path: dir, available: false });
  });

  it("edits name, body and height and keeps comments", async () => {
    const dir = path.join(home, "p");
    await store().create({ path: dir, name: "P", body: "male" });
    const s = await store().update({ name: "Q", height_cm: 181 });
    expect(s).toMatchObject({ name: "Q", body: "male", height_cm: 181 });
    expect(await readFile(path.join(dir, "project.yaml"), "utf8")).toContain("# Tattoo Planner project");
    await expect(store().update({ body: "robot" })).rejects.toMatchObject({ status: 400 });
    await expect(store().update({ path: "/x" })).rejects.toMatchObject({ status: 400 });
  });

  it("moves the old config into the folder without overwriting", async () => {
    const data = path.join(home, "data");
    await mkdir(path.join(data, "layouts"), { recursive: true });
    await writeFile(path.join(data, "manifest.yaml"), "version: 1\nassets: []\n");
    await writeFile(path.join(data, "layouts", "v1.yaml"), "name: v1 # already here\n");
    await store().open(data);
    const { project, migration } = await store().migrate();
    expect(migration).toEqual({
      projectFile: "created",
      copied: ["projections/anubis.yaml", "measurements.yaml"],
      skipped: ["layouts/v1.yaml"],
    });
    expect(await readFile(path.join(data, "layouts", "v1.yaml"), "utf8")).toContain("already here");
    expect(project).toMatchObject({ status: "project", name: "data", body: "male" });
    expect((await store().paths()).layoutsDir).toBe(path.join(data, "layouts"));
    // Running it again changes nothing.
    const again = await migrateFolder(data, { configDir: legacyConfig });
    expect(again.projectFile).toBe("kept");
    expect(again.copied).toEqual([]);
    await expect(store().migrate()).rejects.toMatchObject({ status: 409 });
  });

  it("creating a project in an old data folder migrates it with the given name and body", async () => {
    const data = path.join(home, "data");
    await mkdir(data);
    await writeFile(path.join(data, "manifest.yaml"), "version: 1\nassets: []\n");
    const r = await store().create({ path: data, name: "Mine", body: "female" });
    expect(r.migration?.copied).toContain("layouts/v1.yaml");
    expect(r.project).toMatchObject({ status: "project", name: "Mine", body: "female" });
  });

  it("measurements come from the project, or from config/ for a legacy folder", async () => {
    const dir = path.join(home, "p");
    await store().create({ path: dir, name: "P", body: "male" });
    expect(await store().readMeasurements()).toBeNull();
    await store().writeMeasurements("arm: left # mine\n");
    expect(await readFile(path.join(dir, "measurements.yaml"), "utf8")).toBe("arm: left # mine\n");
    const legacy = path.join(tmp, "legacy");
    await mkdir(legacy);
    expect(await store(legacy).readMeasurements()).toBe("arm: left\n");
  });
});

describe("browseFolder", () => {
  let tmp: string;
  let home: string;

  beforeEach(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), "tattoo-browse-"));
    home = path.join(tmp, "home");
    await mkdir(path.join(home, "b", "inner"), { recursive: true });
    await mkdir(path.join(home, "a"));
    await mkdir(path.join(home, ".hidden"));
    await writeFile(path.join(home, "a", "project.yaml"), "version: 1\nname: A\nbody: male\n");
    await writeFile(path.join(home, "file.txt"), "x");
    await mkdir(path.join(tmp, "outside"));
    await symlink(path.join(tmp, "outside"), path.join(home, "escape"));
    await symlink(path.join(home, "b"), path.join(home, "link-b"));
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it("lists sub-folders of the home folder without hidden ones and symlink escapes", async () => {
    const l = await browseFolder(undefined, home);
    expect(l.parent).toBeNull();
    expect(l.empty).toBe(false);
    expect(l.folders.map((f) => [f.name, f.kind])).toEqual([
      ["a", "project"],
      ["b", "folder"],
      ["link-b", "folder"],
    ]);
  });

  it("goes down and up but never above home", async () => {
    const real = await browseFolder(undefined, home);
    const b = await browseFolder(path.join(home, "b"), home);
    expect(b.parent).toBe(real.path);
    expect(b.folders.map((f) => f.name)).toEqual(["inner"]);
    expect((await browseFolder(path.join(home, "b", "inner"), home)).empty).toBe(true);
    expect((await browseFolder("~/b", home)).path).toBe(b.path);
    await expect(browseFolder(tmp, home)).rejects.toMatchObject({ status: 403 });
    await expect(browseFolder(path.join(home, ".."), home)).rejects.toMatchObject({ status: 403 });
    await expect(browseFolder(path.join(home, "escape"), home)).rejects.toMatchObject({ status: 403 });
    await expect(browseFolder("relative", home)).rejects.toMatchObject({ status: 400 });
    await expect(browseFolder(path.join(home, "missing"), home)).rejects.toMatchObject({ status: 404 });
    await expect(browseFolder(path.join(home, "file.txt"), home)).rejects.toMatchObject({ status: 400 });
  });
});
