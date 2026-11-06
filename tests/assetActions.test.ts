// The Assets tab's actions end to end through the HTTP API, on a folder shaped like Jan's older
// data folder (refs/, cards/, ideas/, existing/, arm-photos/ with upper-case extensions, edits/,
// generated/) whose layouts and projections live in the app's config/ (docs/adr/0020).
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  AssetListing,
  BatchResult,
  DeleteRefusal,
  ImportResult,
  UsageListing,
} from "../src/assets/types.ts";
import { createContext } from "../server/context.ts";
import { SAMPLE_FOLDER, SAMPLE_READ_ONLY } from "../server/project/sample.ts";
import { startServer } from "../server/standalone.ts";
import { PENDING_FOLDER, PendingDeletes, projectTrasher } from "../server/trash.ts";

export const JAN_MANIFEST = `# Asset manifest (PROJECT_BRIEF.md §12.4). Hand edits welcome.
version: 1
assets:
  # Pinterest finds
  - id: medusa
    file: refs/medusa.jpg   # the face
    kind: reference
    source: Pinterest
    tags: [medusa, realistic]

  - id: cards-rhonas
    file: cards/rhonas.jpg
    kind: card-art
    tags: []

  - id: ideas-p01-01
    file: ideas/page-01-img-01.png
    kind: idea
    page: 1
    bbox: [1, 2, 3, 4]
    tags: [medusa-tattoo]

  - id: existing-anubis
    file: existing/anubis.jpg
    kind: existing
    tags: []

  # Arm photos for measuring
  - id: arm-photos-front
    file: arm-photos/front.JPG
    kind: arm-photo
    tags: []

  - id: arm-photos-anubis1-nr
    file: arm-photos/anubis1_nr.JPG
    kind: arm-photo
    tags: []

  - id: medusa-edit-1
    file: edits/medusa-edit-1.png
    kind: reference
    derived_from: medusa
    tags: [medusa, realistic, edited]

  - id: skull-1
    file: generated/skull-1.png
    kind: idea
    notes: "Generated: a skull"
    tags: [generated]
`;

const FILES = [
  "refs/medusa.jpg",
  "refs/medusa.txt",
  "cards/rhonas.jpg",
  "ideas/page-01-img-01.png",
  "existing/anubis.jpg",
  "arm-photos/front.JPG",
  "arm-photos/anubis1_nr.JPG",
  "edits/medusa-edit-1.png",
  "generated/skull-1.png",
];

const PROJECTION = `name: anubis
description: Anubis forearm
photos:
  - file: arm-photos/anubis1_nr.JPG
    edges: { left: [{ x: 0.1, y: 0 }, { x: 0.1, y: 1 }], right: [{ x: 0.9, y: 0 }, { x: 0.9, y: 1 }] }
    along: [{ x: 0.5, y: 0.9, cm: 0 }, { x: 0.5, y: 0.2, cm: 12 }]
    u_view: { wrist: 0.5, elbow: 0.5 }
patch: { u: [0.3, 0.7], v: [0.05, 0.4] }
`;

const LAYOUT = `name: v1-baseline
elements:
  - { id: medusa, type: figure, asset: medusa, position: { u: 0.5, v: 0.5 }, size_cm: { h: 10 } }
`;

describe("asset actions (Jan's legacy folder)", () => {
  let tmp: string;
  let data: string;
  let trashBin: string;
  let server: { url: string; close: () => Promise<void> };

  beforeEach(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), "tattoo-actions-"));
    data = path.join(tmp, "data");
    trashBin = path.join(tmp, "Trash");
    await mkdir(trashBin);
    for (const f of FILES) {
      await mkdir(path.dirname(path.join(data, f)), { recursive: true });
      await writeFile(path.join(data, f), f.endsWith(".txt") ? "Pinterest board" : `bytes of ${f}`);
    }
    await writeFile(path.join(data, "manifest.yaml"), JAN_MANIFEST);
    await mkdir(path.join(tmp, "config", "projections"), { recursive: true });
    await mkdir(path.join(tmp, "config", "layouts"), { recursive: true });
    await writeFile(path.join(tmp, "config", "projections", "anubis.yaml"), PROJECTION);
    await writeFile(path.join(tmp, "config", "layouts", "v1-baseline.yaml"), LAYOUT);
    await mkdir(path.join(tmp, "dist"));
    await writeFile(path.join(tmp, "dist", "index.html"), "<!doctype html><title>t</title>");
    server = await startServer({
      dist: path.join(tmp, "dist"),
      port: 0,
      context: createContext({
        env: { TATTOO_DATA_DIR: data },
        root: tmp,
        home: tmp,
        configFile: path.join(tmp, "config.json"),
        sampleDir: null,
        // A stand-in for the system Trash.
        trashItem: async (file) => {
          const { rename } = await import("node:fs/promises");
          await rename(file, path.join(trashBin, path.basename(file)));
        },
      }),
    });
  });

  afterEach(async () => {
    await server.close();
    await rm(tmp, { recursive: true, force: true });
  });

  const api = (p: string, init?: RequestInit) => fetch(new URL(p, server.url), init);
  const post = (p: string, body: unknown) =>
    api(p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const manifest = () => readFile(path.join(data, "manifest.yaml"), "utf8");
  const listing = async () =>
    (await (await api("api/assets")).json()) as Extract<AssetListing, { status: "ok" }>;

  it("derives sections without touching the manifest", async () => {
    const l = await listing();
    const cat = Object.fromEntries(l.assets.map((a) => [a.id, [a.effectiveCategory, a.effectivePerson]]));
    expect(cat).toEqual({
      medusa: ["reference", null],
      "cards-rhonas": ["reference", null],
      "ideas-p01-01": ["reference", null],
      "existing-anubis": ["existing", "me"],
      "arm-photos-front": ["measuring", "me"],
      "arm-photos-anubis1-nr": ["existing", "me"],
      "medusa-edit-1": ["edit", null],
      "skull-1": ["generated", null],
    });
    expect(l.trash).toBe("system");
    expect(l.persons).toEqual([{ id: "me", name: "Me", implicit: true }]);
    const usage = ((await (await api("api/assets/usage")).json()) as UsageListing).usage;
    expect(usage.medusa).toEqual([
      { kind: "layout", person: "me", layout: "v1-baseline", element: "medusa" },
      { kind: "derived", child: "medusa-edit-1" },
    ]);
    expect(usage["arm-photos-anubis1-nr"]?.[0]).toMatchObject({ kind: "projection", photo: 1 });
    expect((await api("api/assets/image/arm-photos-front")).status).toBe(200);
    expect(await manifest()).toBe(JAN_MANIFEST);
  });

  it("hides, moves and undoes byte for byte", async () => {
    const r = await post("api/assets/batch", { action: "hide", ids: ["medusa", "cards-rhonas"] });
    expect(r.status).toBe(200);
    const hidden = (await r.json()) as BatchResult;
    expect(hidden.changed).toEqual(["medusa", "cards-rhonas"]);
    expect(await manifest()).toContain("hidden: true");
    expect((await post(`api/assets/undo/${hidden.undo!.token}`, {})).status).toBe(200);
    expect(await manifest()).toBe(JAN_MANIFEST);

    const moved = (await (
      await post("api/assets/batch", {
        action: "set",
        ids: ["arm-photos-front"],
        patch: { category: "existing" },
      })
    ).json()) as BatchResult;
    const front =
      moved.listing.status === "ok" && moved.listing.assets.find((a) => a.id === "arm-photos-front");
    expect(front).toMatchObject({ category: "existing", effectiveCategory: "existing" });
    // The implicit person is the default and is not written.
    await post("api/assets/batch", { action: "set", ids: ["arm-photos-front"], patch: { person: "me" } });
    expect(await manifest()).not.toContain("person:");
    expect(
      (await post("api/assets/batch", { action: "set", ids: ["medusa"], patch: { person: "x" } })).status,
    ).toBe(400);
    expect((await post("api/assets/batch", { action: "nope", ids: ["medusa"] })).status).toBe(400);
    expect((await post("api/assets/batch", { action: "hide", ids: ["unknown"] })).status).toBe(404);
    // Undo after another change: refused, nothing lost.
    await post("api/assets/batch", { action: "hide", ids: ["skull-1"] });
    expect((await post(`api/assets/undo/${moved.undo!.token}`, {})).status).toBe(409);
  });

  it("asks before deleting a projection photo, then trashes it with undo", async () => {
    const refused = await post("api/assets/batch", { action: "delete", ids: ["arm-photos-anubis1-nr"] });
    expect(refused.status).toBe(409);
    const body = (await refused.json()) as DeleteRefusal;
    expect(body.projections[0]).toMatchObject({
      id: "arm-photos-anubis1-nr",
      use: { label: "Anubis forearm" },
    });
    expect(await manifest()).toBe(JAN_MANIFEST);

    const done = (await (
      await post("api/assets/batch", { action: "delete", ids: ["arm-photos-anubis1-nr"], force: true })
    ).json()) as BatchResult;
    expect(done.files).toBe(1);
    await expect(stat(path.join(data, "arm-photos/anubis1_nr.JPG"))).rejects.toThrow();
    const after = await manifest();
    expect(after).not.toContain("anubis1_nr");
    // Every other entry and comment stays byte for byte.
    expect(after).toBe(JAN_MANIFEST.replace(/ {2}- id: arm-photos-anubis1-nr\n[\s\S]*?tags: \[\]\n\n/, ""));
    expect(await readdir(path.join(data, PENDING_FOLDER))).toHaveLength(1);

    expect((await post(`api/assets/undo/${done.undo!.token}`, {})).status).toBe(200);
    expect(await readFile(path.join(data, "arm-photos/anubis1_nr.JPG"), "utf8")).toBe(
      "bytes of arm-photos/anubis1_nr.JPG",
    );
    expect(await manifest()).toBe(JAN_MANIFEST);
    expect(await readdir(path.join(data, PENDING_FOLDER))).toEqual([]);
  });

  it("commits a delete to the trash with its sidecar; undo is then refused", async () => {
    const done = (await (
      await post("api/assets/batch", { action: "delete", ids: ["medusa"] })
    ).json()) as BatchResult;
    expect(done.files).toBe(2);
    const listed = await listing();
    expect(listed.assets.map((a) => a.id)).not.toContain("medusa");
    // The edit keeps its dangling derived_from.
    expect(listed.assets.find((a) => a.id === "medusa-edit-1")?.derived_from).toBe("medusa");
    expect((await api(`api/assets/commit/${done.undo!.token}`, { method: "POST", body: "" })).status).toBe(
      200,
    );
    expect((await readdir(trashBin)).sort()).toEqual(["medusa.jpg", "medusa.txt"]);
    expect((await post(`api/assets/undo/${done.undo!.token}`, {})).status).toBe(410);
    expect(await readdir(path.join(data, PENDING_FOLDER))).toEqual([]);
  });

  it("refuses to delete an image open in the Image studio", async () => {
    expect((await post("api/edits/sessions", { mode: "edit", assetId: "skull-1" })).status).toBe(200);
    const r = await post("api/assets/batch", { action: "delete", ids: ["skull-1", "cards-rhonas"] });
    expect(r.status).toBe(409);
    expect(((await r.json()) as DeleteRefusal).inSession).toEqual(["skull-1"]);
    expect(await manifest()).toBe(JAN_MANIFEST);
  });

  it("imports a dropped photo into its section and refuses HEIC", async () => {
    const send = (q: string, type = "image/jpeg") =>
      api(`api/assets/import?${q}`, {
        method: "POST",
        headers: { "Content-Type": type },
        body: "jpeg bytes",
      });
    expect((await send("name=IMG_1.HEIC&category=existing")).status).toBe(415);
    expect((await send("name=rose.JPG&category=generated")).status).toBe(400);
    expect((await send("name=rose.JPG&category=existing", "text/plain")).status).toBe(415);
    const r = (await (await send("name=rose.JPG&category=existing")).json()) as ImportResult;
    expect(r).toMatchObject({ id: "photos-existing-rose", file: "photos/existing/rose.JPG" });
    const again = (await (await send("name=rose.JPG&category=existing")).json()) as ImportResult;
    expect(again.file).toBe("photos/existing/rose-2.JPG");
    const entry = (await listing()).assets.find((a) => a.id === r.id);
    expect(entry).toMatchObject({
      kind: "existing",
      category: "existing",
      effectivePerson: "me",
      exists: true,
    });
    expect(await manifest()).toContain(JAN_MANIFEST.trimEnd());
  });
});

describe("pending deletes", () => {
  it("are made final by a sweep once old, into the project trash where there is no system one", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "tattoo-pending-"));
    try {
      await mkdir(path.join(dir, "images"));
      await writeFile(path.join(dir, "images/a.png"), "a");
      await writeFile(path.join(dir, "manifest.yaml"), "version: 1\nassets: []\n");
      const pending = new PendingDeletes(projectTrasher);
      const { token } = await pending.stage(dir, {
        files: ["images/a.png"],
        entries: [{ id: "a", file: "images/a.png", kind: "reference", tags: [] }],
        manifestBefore: "version: 1\nassets:\n  - { id: a, file: images/a.png, kind: reference }\n",
        manifestAfter: "version: 1\nassets: []\n",
      });
      await pending.sweep(dir); // too young
      expect(await readdir(path.join(dir, PENDING_FOLDER))).toEqual([token]);
      await pending.sweep(dir, 0);
      expect(await readdir(path.join(dir, PENDING_FOLDER))).toEqual([]);
      const [folder] = await readdir(path.join(dir, ".trash"));
      expect(folder).toMatch(/-a$/);
      expect(await readFile(path.join(dir, ".trash", folder!, "images/a.png"), "utf8")).toBe("a");
      expect(await readFile(path.join(dir, ".trash", folder!, "entry.yaml"), "utf8")).toContain("id: a");
      await pending.commitAll();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("the sample project", () => {
  it("refuses every catalogue action", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "tattoo-sample-actions-"));
    await mkdir(path.join(tmp, "dist"));
    await writeFile(path.join(tmp, "dist", "index.html"), "<!doctype html>");
    const server = await startServer({
      dist: path.join(tmp, "dist"),
      port: 0,
      context: createContext({
        env: {},
        root: tmp,
        home: tmp,
        configFile: path.join(tmp, "config.json"),
        sampleDir: path.resolve(import.meta.dirname, "..", SAMPLE_FOLDER),
      }),
    });
    try {
      const api = (p: string, init?: RequestInit) => fetch(new URL(p, server.url), init);
      await api("api/project/open-sample", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const l = (await (await api("api/assets")).json()) as Extract<AssetListing, { status: "ok" }>;
      expect(l.readOnly).toBe(true);
      expect(l.assets.every((a) => a.effectiveCategory === "reference")).toBe(true);
      for (const p of [
        "api/assets/batch",
        "api/assets/undo/abcdefgh12",
        "api/assets/import?name=a.png&category=reference",
      ]) {
        const r = await api(p, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
        expect(r.status, p).toBe(409);
        expect(((await r.json()) as { error: string }).error).toBe(SAMPLE_READ_ONLY);
      }
      expect((await api("api/assets/usage")).status).toBe(200);
    } finally {
      await server.close();
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
