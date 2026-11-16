// Persons of a project (docs/adr/0017-persons.md): schema, project.yaml edits, the store's paths and
// person API, the trash, the sample's two persons and photo ownership.
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listLayouts } from "../server/layoutsApi.ts";
import { ProjectStore } from "../server/project/store.ts";
import { moveToTrash } from "../server/project/trash.ts";
import { isSampleWrite } from "../server/sampleApi.ts";
import { scanCandidates } from "../src/assets/scan.ts";
import {
  activeVariant,
  activeVariants,
  assetOwner,
  initials,
  newPersonId,
  personFolder,
  pickPerson,
  resolvePersons,
  ROOT_PERSON_ID,
  visibleToPerson,
} from "../src/project/persons.ts";
import {
  addPersonText,
  parseProjectText,
  removePersonText,
  updatePersonText,
  updateProjectText,
} from "../src/project/yamlDoc.ts";

const SAMPLE_DIR = path.resolve(import.meta.dirname, "..", "samples", "demo");
const PLAIN = "# mine\nversion: 1\nname: Sleeve # the name\nbody: male\nheight_cm: 180\n";

describe("persons in project.yaml", () => {
  it("gives a project without persons one root person on the top-level data", () => {
    const r = parseProjectText(PLAIN);
    if (!r.ok) throw new Error(r.error);
    const persons = resolvePersons(r.project);
    expect(persons).toEqual([
      {
        id: ROOT_PERSON_ID,
        name: "Me",
        body: "male",
        height_cm: 180,
        active: {},
        root: true,
        folder: "",
      },
    ]);
    expect(personFolder("me")).toBe("");
    expect(personFolder("xenia")).toBe("persons/xenia");
  });

  it("reads further persons, a named root entry and active variants; unknown regions are ignored", () => {
    const text = [
      "version: 1",
      "name: Us",
      "body: male",
      "active: { arm-left: v2, tail: x }",
      "persons:",
      "  - id: xenia",
      "    name: Xenia",
      "    body: female",
      "    active: { torso: back-1 }",
      "  - id: me",
      "    name: Jan",
      "    body: female", // ignored: the root person's body is the top level's
    ].join("\n");
    const r = parseProjectText(text);
    if (!r.ok) throw new Error(r.error);
    const persons = resolvePersons(r.project);
    expect(persons.map((p) => [p.id, p.name, p.body, p.folder])).toEqual([
      ["xenia", "Xenia", "female", "persons/xenia"],
      ["me", "Jan", "male", ""],
    ]);
    expect(persons[1]!.active).toEqual({ "arm-left": "v2" });
    expect(persons[0]!.active).toEqual({ torso: "back-1" });
    expect(pickPerson(persons, "nobody").id).toBe("xenia");
    expect(pickPerson(persons, "me").id).toBe("me");
  });

  it("refuses duplicate ids, a person without body and bad ids", () => {
    const base = "version: 1\nname: A\nbody: male\npersons:\n";
    expect(
      parseProjectText(`${base}  - { id: x, name: X, body: male }\n  - { id: x, name: Y, body: male }\n`).ok,
    ).toBe(false);
    expect(parseProjectText(`${base}  - { id: x, name: X }\n`).ok).toBe(false);
    expect(parseProjectText(`${base}  - { id: X!, name: X, body: male }\n`).ok).toBe(false);
    expect(parseProjectText(`${base}  - { id: me, name: Jan }\n`).ok).toBe(true);
  });

  it("adds, renames and removes persons keeping comments and the root's top level", () => {
    let text = addPersonText(PLAIN, { id: "xenia", name: " Xenia ", body: "female", height_cm: 168 });
    expect(text).toContain("# mine");
    expect(text).toContain("name: Sleeve # the name");
    expect(text).toContain("Further persons");
    text = updatePersonText(text, "me", { name: "Jan", height_cm: 182 });
    text = updatePersonText(text, "xenia", { body: "male" });
    const r = parseProjectText(text);
    if (!r.ok) throw new Error(r.error);
    expect(r.project).toMatchObject({ name: "Sleeve", body: "male", height_cm: 182 });
    expect(resolvePersons(r.project).map((p) => [p.id, p.name, p.body, p.height_cm])).toEqual([
      ["me", "Jan", "male", 182],
      ["xenia", "Xenia", "male", 168],
    ]);
    expect(() => addPersonText(text, { id: "xenia", name: "X", body: "male" })).toThrow(/exists/);
    expect(() => removePersonText(text, "me")).toThrow();
    const removed = removePersonText(text, "xenia");
    const back = parseProjectText(removed);
    expect(back.ok && resolvePersons(back.project).map((p) => p.name)).toEqual(["Jan"]);
  });

  it("sets and clears the active variant of the root person and of another person", () => {
    let text = addPersonText(PLAIN, { id: "xenia", name: "Xenia", body: "female" });
    text = updateProjectText(text, { active: { "arm-left": "v2" } });
    text = updateProjectText(text, { active: { torso: "t1" } }, "xenia");
    let r = parseProjectText(text);
    if (!r.ok) throw new Error(r.error);
    expect(resolvePersons(r.project).map((p) => p.active)).toEqual([{ "arm-left": "v2" }, { torso: "t1" }]);
    text = updateProjectText(text, { active: { "arm-left": null } });
    r = parseProjectText(text);
    expect(r.ok && r.project.active).toBeUndefined();
    expect(() => updateProjectText(text, { body: "male" }, "nobody")).toThrow(/no person/);
  });
});

describe("person helpers", () => {
  it("derives free ids from names and never 'me'", () => {
    expect(newPersonId("Xenia", [])).toBe("xenia");
    expect(newPersonId("Xenia", ["xenia"])).toBe("xenia-2");
    expect(newPersonId("Me", [])).toBe("me-2");
    expect(newPersonId("Zoë Müller", [])).toBe("zoe-muller");
    expect(newPersonId("???", [])).toBe("person");
    expect(initials("Jan Doe")).toBe("JD");
    expect(initials("xenia")).toBe("X");
  });

  it("picks the marked active variant, else the region's first", () => {
    const files = [
      { name: "b", region: "arm-left" as const },
      { name: "a", region: "arm-left" as const },
      { name: "t", region: "torso" as const },
    ];
    expect(activeVariant("arm-left", files, {})).toBe("a");
    expect(activeVariant("arm-left", files, { "arm-left": "b" })).toBe("b");
    expect(activeVariant("arm-left", files, { "arm-left": "gone" })).toBe("a");
    expect(activeVariant("arm-left", files, { "arm-left": "t" })).toBe("a");
    expect(activeVariants(files, {})).toMatchObject({ "arm-left": "a", torso: "t", "leg-left": null });
  });

  it("tells whose photo a file is", () => {
    expect(assetOwner("persons/xenia/photos/a.jpg")).toBe("xenia");
    expect(assetOwner("photos/a.jpg")).toBe("me");
    expect(assetOwner("existing/a.jpg")).toBe("me");
    expect(assetOwner("images/a.png")).toBeNull();
    expect(visibleToPerson("photos/a.jpg", "xenia")).toBe(false);
    expect(visibleToPerson("images/a.png", "xenia")).toBe(true);
    expect(visibleToPerson("persons/xenia/existing/a.jpg", "xenia")).toBe(true);
  });

  it("catalogues a person's photo folders", () => {
    const r = scanCandidates([
      "persons/xenia/photos/arm.jpg",
      "persons/xenia/existing/rose.png",
      "persons/xenia/layouts/x.png",
      "persons/xenia/loose.png",
    ]);
    expect(r.candidates.map((c) => [c.file, c.kind])).toEqual([
      ["persons/xenia/existing/rose.png", "existing"],
      ["persons/xenia/photos/arm.jpg", "arm-photo"],
    ]);
    expect(r.outside).toEqual(["persons/xenia/layouts/x.png", "persons/xenia/loose.png"]);
  });

  it("lets the sample switch persons but nothing else", () => {
    expect(isSampleWrite("POST", "/api/project/persons/sam/select")).toBe(false);
    expect(isSampleWrite("POST", "/api/project/persons")).toBe(true);
    expect(isSampleWrite("PATCH", "/api/project/persons/sam")).toBe(true);
    expect(isSampleWrite("DELETE", "/api/project/persons/sam")).toBe(true);
  });
});

describe("persons in the project store", () => {
  let tmp: string;
  let home: string;
  let configFile: string;
  let dir: string;

  const store = (envDir: string | null = null) =>
    new ProjectStore({
      envDir,
      configFile,
      home,
      legacyConfigDir: null,
      sampleDir: SAMPLE_DIR,
      platform: "win32", // the trash falls back to <project>/.trash, inside tmp
    });

  beforeEach(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), "tattoo-persons-"));
    home = path.join(tmp, "home");
    configFile = path.join(home, ".config", "tattoo-planner", "config.json");
    dir = path.join(home, "Us");
    await mkdir(path.join(dir, "layouts"), { recursive: true });
    await writeFile(path.join(dir, "project.yaml"), PLAIN);
    await writeFile(path.join(dir, "layouts", "v1.yaml"), "name: v1\nelements: []\n");
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it("opens a project from before persons unchanged, on the top-level folders", async () => {
    const s = store(dir);
    const status = await s.status();
    expect(status).toMatchObject({ status: "project", body: "male", height_cm: 180, person: "me" });
    expect(status.persons).toHaveLength(1);
    expect(await s.paths()).toMatchObject({
      dir,
      personDir: dir,
      person: "me",
      layoutsDir: path.join(dir, "layouts"),
      projectionsDir: path.join(dir, "projections"),
      measurementsFile: path.join(dir, "measurements.yaml"),
    });
    expect(await readFile(path.join(dir, "project.yaml"), "utf8")).toBe(PLAIN);
  });

  it("adds a person with an own folder, shows them and scopes every per-person path", async () => {
    const s = store(dir);
    const status = await s.addPerson({ name: "Xenia", body: "female", height_cm: 168 });
    expect(status).toMatchObject({ person: "xenia", body: "female", height_cm: 168 });
    const xenia = path.join(dir, "persons", "xenia");
    expect((await readdir(xenia)).sort()).toEqual(["layouts", "photos", "projections"]);
    const paths = await s.paths();
    expect(paths).toMatchObject({
      personDir: xenia,
      person: "xenia",
      layoutsDir: path.join(xenia, "layouts"),
      projectionsDir: path.join(xenia, "projections"),
      measurementsFile: path.join(xenia, "measurements.yaml"),
    });
    expect(await listLayouts(paths.layoutsDir!)).toEqual([]);
    // Body, height and active variants go to Xenia; the project name stays the project's.
    await s.update({ height_cm: 170, active: { torso: "back" }, name: "Our tattoos" });
    const text = await readFile(path.join(dir, "project.yaml"), "utf8");
    const r = parseProjectText(text);
    if (!r.ok) throw new Error(r.error);
    expect(r.project).toMatchObject({ name: "Our tattoos", body: "male", height_cm: 180 });
    expect(resolvePersons(r.project)[1]).toMatchObject({ height_cm: 170, active: { torso: "back" } });
    // The choice is remembered in the user config, not in project.yaml.
    expect(JSON.parse(await readFile(configFile, "utf8")).currentPerson).toEqual({ [dir]: "xenia" });
    expect(text).not.toContain("current");
    // A fresh store (a restart) shows Xenia again; selecting the root forgets the choice.
    expect((await store(dir).status()).person).toBe("xenia");
    expect((await s.selectPerson("me")).person).toBe("me");
    await expect(s.selectPerson("nobody")).rejects.toMatchObject({ status: 404 });
  });

  it("never reuses a folder that is already there", async () => {
    await mkdir(path.join(dir, "persons", "xenia"), { recursive: true });
    await writeFile(path.join(dir, "persons", "xenia", "keep.txt"), "x");
    const status = await store(dir).addPerson({ name: "Xenia", body: "female" });
    expect(status.person).toBe("xenia-2");
    expect(await readFile(path.join(dir, "persons", "xenia", "keep.txt"), "utf8")).toBe("x");
  });

  it("renames the root person without touching its data", async () => {
    const status = await store(dir).updatePerson("me", { name: "Jan" });
    expect(status.persons.map((p) => p.name)).toEqual(["Jan"]);
    expect(status.body).toBe("male");
    await expect(store(dir).updatePerson("me", { name: "  " })).rejects.toMatchObject({ status: 409 });
  });

  it("moves a removed person's folder to the trash instead of deleting it, and keeps the root", async () => {
    const s = store(dir);
    await s.addPerson({ name: "Xenia", body: "female" });
    await writeFile(path.join(dir, "persons", "xenia", "layouts", "x.yaml"), "name: x\nelements: []\n");
    await expect(s.removePerson("me")).rejects.toMatchObject({ status: 409 });
    const r = await s.removePerson("xenia");
    expect(r.project).toMatchObject({ person: "me" });
    expect(r.project.persons.map((p) => p.id)).toEqual(["me"]);
    expect(r.movedTo).toMatch(/\.trash/);
    expect(await readFile(path.join(r.movedTo!, "layouts", "x.yaml"), "utf8")).toContain("name: x");
    await expect(stat(path.join(dir, "persons", "xenia"))).rejects.toThrow();
  });

  it("moves into the freedesktop trash with an info file on Linux", async () => {
    const folder = path.join(dir, "persons", "x");
    await mkdir(folder, { recursive: true });
    const now = new Date(2026, 10, 6, 14, 3, 12);
    const to = await moveToTrash(folder, "x (Us)", { home, projectDir: dir, platform: "linux", now });
    expect(to).toBe(path.join(home, ".local", "share", "Trash", "files", "x (Us) 2026-11-06 14.03.12"));
    const info = await readFile(
      path.join(home, ".local", "share", "Trash", "info", "x (Us) 2026-11-06 14.03.12.trashinfo"),
      "utf8",
    );
    expect(info).toContain("[Trash Info]");
    expect(info).toContain(`Path=${encodeURI(folder)}`);
  });

  it("shows the sample's two persons and switches between them without writing", async () => {
    const s = store();
    const status = await s.openSample();
    expect(status.persons.map((p) => [p.id, p.name, p.body])).toEqual([
      ["me", "Alice", "female"],
      ["sam", "Sam", "male"],
    ]);
    const sam = await s.selectPerson("sam");
    expect(sam).toMatchObject({ person: "sam", body: "male", height_cm: 182, sample: true });
    const paths = await s.paths();
    expect(paths.layoutsDir).toBe(path.join(SAMPLE_DIR, "persons", "sam", "layouts"));
    expect((await listLayouts(paths.layoutsDir!)).length).toBeGreaterThan(0);
    await expect(s.addPerson({ name: "X", body: "male" })).rejects.toMatchObject({ status: 409 });
    await expect(readFile(configFile, "utf8")).rejects.toThrow();
    // Re-opening the sample starts with its first person again.
    await s.close();
    expect((await s.openSample()).person).toBe("me");
  });

  it("leaves the sample back to the project that was open before it", async () => {
    const s = store();
    await s.open(dir);
    await s.openSample();
    expect(await s.close()).toMatchObject({ status: "project", path: dir, sample: false });
  });

  it("refuses persons for an older data folder", async () => {
    const legacy = path.join(home, "legacy");
    await mkdir(legacy);
    await writeFile(path.join(legacy, "manifest.yaml"), "version: 1\nassets: []\n");
    const s = store(legacy);
    expect(await s.status()).toMatchObject({ status: "legacy", persons: [], person: null });
    await expect(s.addPerson({ name: "X", body: "male" })).rejects.toMatchObject({ status: 409 });
  });
});
