import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseManifestText } from "../src/assets/manifestDoc.ts";
import {
  checkInstruction,
  endsWithIend,
  keptAsset,
  nextVariant,
  readPngInfo,
  rootAssetId,
  showInStudio,
} from "../src/edits/edit.ts";
import { EditManager, handleEditRequest } from "../server/editsApi.ts";

/** Header-only PNG: signature, IHDR with the given size and colour type, IEND. Enough for readPngInfo. */
function png(width: number, height: number, colourType = 6): Buffer {
  const b = Buffer.alloc(8 + 25 + 12);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12, "latin1");
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  b[24] = 8;
  b[25] = colourType;
  b.writeUInt32BE(0, 33);
  b.write("IEND", 37, "latin1");
  return b;
}

describe("readPngInfo", () => {
  it("reads size and alpha", () => {
    expect(readPngInfo(png(640, 480))).toEqual({ width: 640, height: 480, alpha: true });
    expect(readPngInfo(png(10, 20, 2))).toEqual({ width: 10, height: 20, alpha: false });
  });
  it("rejects anything that is not a PNG", () => {
    expect(
      readPngInfo(Buffer.from("\xff\xd8\xff\xe0 jpeg data that is long enough...", "latin1")),
    ).toBeNull();
    expect(readPngInfo(png(0, 10))).toBeNull();
    expect(readPngInfo(new Uint8Array(4))).toBeNull();
  });
});

describe("instructions and PNG checks", () => {
  it("checks the instruction", () => {
    expect(checkInstruction("  mirror  ")).toEqual({ ok: true, text: "mirror" });
    expect(checkInstruction("   ").ok).toBe(false);
    expect(checkInstruction(42).ok).toBe(false);
    expect(checkInstruction("x".repeat(2001)).ok).toBe(false);
  });
  it("detects a PNG that was cut off", () => {
    expect(endsWithIend(png(4, 4))).toBe(true);
    expect(endsWithIend(png(4, 4).subarray(0, 40))).toBe(false);
  });
});

describe("kept edits", () => {
  const original = {
    id: "pegasus-ref-01",
    file: "refs/pegasus.jpg",
    kind: "reference",
    source: "Pinterest",
    tags: ["pegasus"],
    crop: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 },
  };
  it("numbers variants after the original", () => {
    expect(rootAssetId(original)).toBe("pegasus-ref-01");
    expect(rootAssetId({ id: "pegasus-ref-01-edit-1", derived_from: "pegasus-ref-01" })).toBe(
      "pegasus-ref-01",
    );
    expect(nextVariant("pegasus-ref-01", new Set(), new Set())).toEqual({
      id: "pegasus-ref-01-edit-1",
      file: "edits/pegasus-ref-01-edit-1.png",
    });
    expect(nextVariant("a", new Set(["a-edit-1"]), new Set(["edits/a-edit-2.png"]))).toEqual({
      id: "a-edit-3",
      file: "edits/a-edit-3.png",
    });
  });
  it("inherits kind, source and tags, and the crop only at the same size", () => {
    const v = { id: "pegasus-ref-01-edit-1", file: "edits/pegasus-ref-01-edit-1.png" };
    const a = keptAsset(original, v, ["Remove background", "Mirror"], true, ["built-in", "built-in"]);
    expect(a).toEqual({
      ...v,
      kind: "reference",
      derived_from: "pegasus-ref-01",
      source: "Pinterest",
      notes: 'Edited with built-in: "Remove background", then "Mirror"',
      tags: ["pegasus", "edited"],
      crop: original.crop,
    });
    expect(keptAsset(original, v, ["x"], false, ["built-in"]).crop).toBeUndefined();
  });
});

describe("EditManager with built-in operations", () => {
  let dir: string;
  const MANIFEST = `# my catalogue
version: 1
assets:
  - id: pegasus-ref-01
    file: refs/pegasus.png
    kind: reference # hand comment
    tags: [pegasus]
`;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "tp-edits-"));
    await mkdir(path.join(dir, "refs"));
    await writeFile(path.join(dir, "refs", "pegasus.png"), png(100, 50, 2));
    await writeFile(path.join(dir, "manifest.yaml"), MANIFEST);
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("is disabled without a data folder", async () => {
    const m = new EditManager(null, {});
    expect((await m.builtinAvailability()).enabled).toBe(false);
    await expect(m.startSession({ mode: "edit", assetId: "x" })).rejects.toMatchObject({ status: 409 });
  });

  it("adds each result as the next version, saves it and leaves the original alone", async () => {
    const m = new EditManager(dir, {});
    expect((await m.overview()).builtin).toEqual({ enabled: true });
    const s = await m.startSession({ mode: "edit", assetId: "pegasus-ref-01" });
    expect(await m.startSession({ mode: "edit", assetId: "pegasus-ref-01" })).toBe(s);

    const a = await m.apply(s.id, png(100, 50), { step: "Remove background", base: "0" });
    expect(a).toMatchObject({
      state: "done",
      engine: "builtin",
      session: s.id,
      assetId: "pegasus-ref-01",
      instructions: ["Remove background"],
      tools: ["built-in"],
      output: { width: 100, height: 50, alpha: true },
    });
    expect(a.fromJob).toBeUndefined();
    expect(s.versions).toEqual([a.id]);
    expect(await readFile(m.file(a.id, "input"))).toEqual(png(100, 50, 2));

    // The next one starts from v1 and carries the chain.
    const b = await m.apply(s.id, png(50, 100), { step: "Rotate 90° right", base: "1" });
    expect(b.fromJob).toBe(a.id);
    expect(b.instructions).toEqual(["Remove background", "Rotate 90° right"]);
    expect(s.versions).toEqual([a.id, b.id]);

    // A result computed on an older version is refused.
    await expect(m.apply(s.id, png(1, 1), { step: "Mirror", base: "1" })).rejects.toMatchObject({
      status: 409,
    });
    // Undo: continue from v1, then apply again.
    m.truncate(s.id, { length: 1 });
    const c = await m.apply(s.id, png(100, 50), { step: "Mirror", base: "1" });
    expect(s.versions).toEqual([a.id, c.id]);

    const saved = await m.save(s.id, {});
    expect(saved.kept).toEqual({ id: "pegasus-ref-01-edit-1", file: "edits/pegasus-ref-01-edit-1.png" });
    expect(await readdir(path.join(dir, "edits"))).toEqual(["pegasus-ref-01-edit-1.png"]);
    expect(await readFile(path.join(dir, "edits", "pegasus-ref-01-edit-1.png"))).toEqual(png(100, 50));
    expect(await readFile(path.join(dir, "refs", "pegasus.png"))).toEqual(png(100, 50, 2));
    const text = await readFile(path.join(dir, "manifest.yaml"), "utf8");
    expect(text.startsWith(MANIFEST.trimEnd())).toBe(true);
    expect(text).toContain("# hand comment");
    const entries = parseManifestText(text).toJS().assets as {
      id: string;
      derived_from?: string;
      notes?: string;
      tags: string[];
    }[];
    expect(entries[1]).toMatchObject({
      id: "pegasus-ref-01-edit-1",
      derived_from: "pegasus-ref-01",
      notes: 'Edited with built-in: "Remove background", then "Mirror"',
      tags: ["pegasus", "edited"],
    });

    expect(await m.closeSession(s.id)).toEqual({ closed: s.id });
    expect(m.list().map((j) => j.id)).toEqual([c.id]);
    expect(() => m.file(b.id, "input")).toThrow();

    // A session on the saved edit: entry built from it, derived_from still the original.
    const s2 = await m.startSession({ mode: "edit", assetId: "pegasus-ref-01-edit-1" });
    await m.apply(s2.id, png(100, 50), { step: "Invert", base: "0" });
    expect((await m.save(s2.id, {})).kept?.id).toBe("pegasus-ref-01-edit-2");
    const after = parseManifestText(await readFile(path.join(dir, "manifest.yaml"), "utf8")).toJS()
      .assets as { notes?: string; derived_from?: string }[];
    expect(after[2]).toMatchObject({
      derived_from: "pegasus-ref-01",
      notes: 'From pegasus-ref-01-edit-1. Edited with built-in: "Invert"',
    });
    await m.close();
  });

  it("refuses what is not a complete PNG, a missing step and blank new images", async () => {
    const m = new EditManager(dir, {});
    const s = await m.startSession({ mode: "edit", assetId: "pegasus-ref-01" });
    const notPng = Buffer.from("not a png at all, but long enough to be read");
    await expect(m.apply(s.id, notPng, { step: "x", base: "0" })).rejects.toMatchObject({ status: 415 });
    await expect(m.apply(s.id, png(4, 4).subarray(0, 40), { step: "x", base: "0" })).rejects.toMatchObject({
      status: 415,
    });
    await expect(m.apply(s.id, png(4, 4), { step: " ", base: "0" })).rejects.toMatchObject({ status: 400 });
    await expect(m.apply(s.id, png(4, 4), { step: "x" })).rejects.toMatchObject({ status: 400 });
    await expect(m.apply("s999-x", png(4, 4), { step: "x", base: "0" })).rejects.toMatchObject({
      status: 404,
    });
    expect(s.versions).toEqual([]);
    const blank = await m.startSession({ mode: "create", name: "Neu" });
    await expect(m.apply(blank.id, png(4, 4), { step: "x", base: "0" })).rejects.toMatchObject({
      status: 409,
    });
    // Built-in is not an engine the server runs.
    await expect(m.start({ session: s.id, engine: "builtin", instruction: "x" })).rejects.toMatchObject({
      status: 400,
    });
    await expect(m.startSession({ mode: "edit", assetId: "nope" })).rejects.toMatchObject({ status: 404 });
    await m.close();
  });

  it("takes the PNG over HTTP, and only from the planner itself", async () => {
    const m = new EditManager(dir, {});
    const s = await m.startSession({ mode: "edit", assetId: "pegasus-ref-01" });
    const request = (body: Buffer, headers: Record<string, string>) =>
      Object.assign(Readable.from([body]), {
        method: "POST",
        url: `/sessions/${s.id}/apply?step=${encodeURIComponent("Line art (level 128)")}&base=0`,
        headers: { "content-length": String(body.length), ...headers },
      }) as unknown as IncomingMessage;
    const response = () => {
      const r = { statusCode: 0, body: "", setHeader: () => undefined, end: (t: string) => (r.body = t) };
      return r;
    };
    const res = response();
    await handleEditRequest(m, request(png(100, 50), { "content-type": "image/png" }), res as never);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({ instructions: ["Line art (level 128)"] });
    expect(s.versions).toHaveLength(1);
    await expect(
      handleEditRequest(m, request(png(1, 1), { "content-type": "application/json" }), response() as never),
    ).rejects.toMatchObject({ status: 415 });
    await expect(
      handleEditRequest(
        m,
        request(png(1, 1), { "content-type": "image/png", "sec-fetch-site": "cross-site" }),
        response() as never,
      ),
    ).rejects.toMatchObject({ status: 403 });
    await m.close();
  });
});

describe("showInStudio", () => {
  it("hides arm photos and photos of existing tattoos", () => {
    expect(showInStudio({ kind: "reference", file: "refs/medusa.png" })).toBe(true);
    expect(showInStudio({ kind: "idea", file: "generated/dreieck-1.png" })).toBe(true);
    expect(showInStudio({ kind: "arm-photo", file: "arm-photos/front.JPG" })).toBe(false);
    expect(showInStudio({ kind: "existing", file: "existing/anubis.jpg" })).toBe(false);
    // By folder too, whatever the kind says.
    expect(showInStudio({ kind: "reference", file: "Arm-Photos/anubis1_nr.JPG" })).toBe(false);
  });

  it("follows the catalogue section and leaves hidden images out", () => {
    const photo = { kind: "reference", file: "images/x.png" };
    expect(showInStudio({ ...photo, effectiveCategory: "measuring" })).toBe(false);
    expect(showInStudio({ ...photo, effectiveCategory: "background" })).toBe(true);
    expect(showInStudio({ ...photo, effectiveCategory: "edit", hidden: true })).toBe(false);
  });
});
