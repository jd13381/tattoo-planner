// Deleting a projection (Settings → Projection): the file goes to the trash like a deleted image, the
// layouts named take the tattoo out (comments kept), others keep a "projection missing" element; per
// person; refused for the read-only sample.
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deleteProjection, projectionsHandler, type ProjectionFolders } from "../server/projectionsApi.ts";
import { isSampleWrite } from "../server/sampleApi.ts";
import { projectTrasher, type Trasher } from "../server/trash.ts";
import { parseLayout } from "../src/layout/yamlDoc.ts";
import { deletePlan } from "../src/projection/layoutLink.ts";

const PROJECTION = `name: back
region: torso
patch: { u: [0.3, 0.7], v: [0.2, 0.8] }
photos:
  - file: photos/back.jpg
    edges:
      left: [{ x: 0.3, y: 0.1 }, { x: 0.3, y: 0.9 }]
      right: [{ x: 0.7, y: 0.1 }, { x: 0.7, y: 0.9 }]
    along: [{ x: 0.5, y: 0.9, cm: 0 }, { x: 0.5, y: 0.3, cm: 30 }]
    u_view: { wrist: 0.5, elbow: 0.5 }
`;

const layout = (name: string, projection: string) => `# My torso, hand-written comment.
name: ${name}
region: torso
elements:
  - type: existing
    id: back
    projection: ${projection}
    locked: true
    position: { u: 0.5, v: 0.5 }
    size_cm: { h: 20 }
  # The moon stays.
  - type: figure
    id: moon
    asset: moon
    position: { u: 0.2, v: 0.4 }
    size_cm: { h: 5 }
`;

let tmp: string;
let folders: ProjectionFolders;

async function setUp(personFolder: string | null) {
  const base = personFolder ? path.join(tmp, personFolder) : tmp;
  folders = {
    dir: tmp,
    projectionsDir: path.join(base, "projections"),
    layoutsDir: path.join(base, "layouts"),
  };
  await mkdir(folders.projectionsDir!, { recursive: true });
  await mkdir(folders.layoutsDir!, { recursive: true });
  await writeFile(path.join(folders.projectionsDir!, "back.yaml"), PROJECTION);
  await writeFile(path.join(folders.layoutsDir!, "torso-1.yaml"), layout("torso-1", "back"));
  await writeFile(path.join(folders.layoutsDir!, "torso-2.yaml"), layout("torso-2", "back"));
  await writeFile(path.join(folders.layoutsDir!, "torso-3.yaml"), layout("torso-3", "other"));
}

/** Every file below the project's .trash, relative to it. */
async function trashed(): Promise<string[]> {
  const list = await readdir(path.join(tmp, ".trash"), { recursive: true, withFileTypes: true }).catch(
    () => [],
  );
  return list
    .filter((e) => e.isFile())
    .map((e) => path.relative(path.join(tmp, ".trash"), path.join(e.parentPath, e.name)))
    .map((p) => p.split(path.sep).slice(1).join("/"))
    .sort();
}

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), "tattoo-projection-delete-"));
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe("deleteProjection", () => {
  it("moves the file to the trash and takes the tattoo out of the layouts named", async () => {
    await setUp(null);
    const r = await deleteProjection(folders, "back", ["torso-1", "torso-3"], projectTrasher);
    expect(r.trash).toBe("project");
    expect(r.layouts.map((l) => l.name)).toEqual(["torso-1"]);
    expect(r.skipped).toEqual([]);
    await expect(readFile(path.join(folders.projectionsDir!, "back.yaml"))).rejects.toThrow();
    expect(await trashed()).toEqual(["entry.yaml", "projections/back.yaml"]);
    const one = await readFile(path.join(folders.layoutsDir!, "torso-1.yaml"), "utf8");
    expect(one).toBe(r.layouts[0]!.text);
    expect(one).toContain("# My torso, hand-written comment.");
    expect(one).toContain("# The moon stays.");
    const parsed = parseLayout(one);
    expect(parsed.ok && parsed.layout.elements.map((e) => e.id)).toEqual(["moon"]);
    // Not named: left with an element whose projection is missing.
    expect(await readFile(path.join(folders.layoutsDir!, "torso-2.yaml"), "utf8")).toBe(
      layout("torso-2", "back"),
    );
    const note = await readdir(path.join(tmp, ".trash"));
    const entry = await readFile(path.join(tmp, ".trash", note[0]!, "entry.yaml"), "utf8");
    expect(entry).toContain("projection");
    expect(entry).toContain("projections/back.yaml");
  });

  it("works in another person's folder", async () => {
    await setUp("persons/xenia");
    const r = await deleteProjection(folders, "back", ["torso-2"], projectTrasher);
    expect(r.layouts.map((l) => l.name)).toEqual(["torso-2"]);
    expect(await trashed()).toEqual(["entry.yaml", "persons/xenia/projections/back.yaml"]);
  });

  it("hands the file to the system trash when there is one", async () => {
    await setUp(null);
    const calls: string[][] = [];
    const system: Trasher = {
      mode: "system",
      trash: async (files) => {
        calls.push(files);
        for (const f of files) await rm(f);
      },
    };
    const r = await deleteProjection(folders, "back", [], system);
    expect(r.trash).toBe("system");
    expect(calls).toEqual([[path.join(folders.projectionsDir!, "back.yaml")]]);
  });

  it("refuses unknown and invalid names and leaves everything as it was", async () => {
    await setUp(null);
    await expect(deleteProjection(folders, "nope", [], projectTrasher)).rejects.toMatchObject({
      status: 404,
    });
    await expect(deleteProjection(folders, "../x", [], projectTrasher)).rejects.toMatchObject({
      status: 400,
    });
    await expect(deleteProjection(folders, "back", ["../x"], projectTrasher)).rejects.toMatchObject({
      status: 400,
    });
    expect(await readFile(path.join(folders.projectionsDir!, "back.yaml"), "utf8")).toBe(PROJECTION);
    await expect(
      deleteProjection({ dir: null, projectionsDir: null, layoutsDir: null }, "back", [], projectTrasher),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("skips a layout with errors or that is gone, and says so", async () => {
    await setUp(null);
    await writeFile(path.join(folders.layoutsDir!, "torso-1.yaml"), "name: [broken");
    const r = await deleteProjection(folders, "back", ["torso-1", "gone"], projectTrasher);
    expect(r.skipped).toEqual([
      { name: "torso-1", reason: "the file has errors" },
      { name: "gone", reason: "not found" },
    ]);
  });
});

describe("DELETE /api/projections/<name>", () => {
  let server: Server;
  let base: string;

  beforeEach(async () => {
    await setUp(null);
    server = createServer((req, res) => {
      const url = (req.url ?? "/").slice("/api/projections".length) || "/";
      void projectionsHandler(async () => folders, projectTrasher)(req, res, url);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/projections`;
  });
  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it("deletes with and without a body", async () => {
    const r = await fetch(`${base}/back`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ removeFrom: ["torso-1"] }),
    });
    expect(r.status).toBe(200);
    expect(((await r.json()) as { layouts: { name: string }[] }).layouts.map((l) => l.name)).toEqual([
      "torso-1",
    ]);
    const list = (await (await fetch(base)).json()) as unknown[];
    expect(list).toEqual([]);
    const again = await fetch(`${base}/back`, { method: "DELETE" });
    expect(again.status).toBe(404);
  });

  it("refuses a bad body", async () => {
    const r = await fetch(`${base}/back`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ removeFrom: "torso-1" }),
    });
    expect(r.status).toBe(400);
  });

  it("is a write the read-only sample refuses", () => {
    expect(isSampleWrite("DELETE", "/api/projections/back")).toBe(true);
  });
});

describe("deletePlan", () => {
  it("lists the layouts showing the tattoo and holds back one with unsaved edits", () => {
    const files = [
      { name: "torso-1", text: layout("torso-1", "back") },
      { name: "torso-2", text: layout("torso-2", "back") },
      { name: "torso-3", text: layout("torso-3", "other") },
    ];
    expect(deletePlan(files, "back")).toEqual({
      shownIn: ["torso-1", "torso-2"],
      removable: ["torso-1", "torso-2"],
      heldBack: null,
    });
    expect(deletePlan(files, "back", { name: "torso-2", dirty: true })).toEqual({
      shownIn: ["torso-1", "torso-2"],
      removable: ["torso-1"],
      heldBack: "torso-2",
    });
    expect(deletePlan(files, "back", { name: "torso-2", dirty: false }).heldBack).toBeNull();
  });
});
