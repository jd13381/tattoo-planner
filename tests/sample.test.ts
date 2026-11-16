// The sample project (docs/adr/0012-project-folder.md, "Sample project"): its files, the drawn
// placeholders, the read-only guard and "Save as new project". The repo's samples/demo is only read.
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseDocument } from "yaml";
import { manifestSchema } from "../src/assets/manifest.ts";
import { REGION_IDS } from "../src/body/regions.ts";
import { regionOf } from "../src/body/regions.ts";
import { parseLayout } from "../src/layout/yamlDoc.ts";
import { parseProjectText } from "../src/project/yamlDoc.ts";
import { MOTIFS, motifForFile, renderMotif } from "../src/sample/placeholders.ts";
import { createContext } from "../server/context.ts";
import { encodePng } from "../server/png.ts";
import { copySample, placeholderPng, SAMPLE_FOLDER, SAMPLE_READ_ONLY } from "../server/project/sample.ts";
import { ProjectStore } from "../server/project/store.ts";
import { isSampleWrite } from "../server/sampleApi.ts";
import { startServer } from "../server/standalone.ts";

const SAMPLE_DIR = path.resolve(import.meta.dirname, "..", SAMPLE_FOLDER);

async function sampleText(rel: string): Promise<string> {
  return readFile(path.join(SAMPLE_DIR, rel), "utf8");
}

/** Every file below a folder, relative, with a hash of its content. */
async function snapshot(dir: string, rel = ""): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const name of await readdir(path.join(dir, rel))) {
    const sub = rel ? `${rel}/${name}` : name;
    if ((await stat(path.join(dir, sub))).isDirectory()) Object.assign(out, await snapshot(dir, sub));
    else
      out[sub] = createHash("sha256")
        .update(await readFile(path.join(dir, sub)))
        .digest("hex");
  }
  return out;
}

describe("sample project files", () => {
  it("has a project.yaml with a sample body", async () => {
    const r = parseProjectText(await sampleText("project.yaml"));
    expect(r.ok && r.project).toMatchObject({ version: 1, name: "Sample project", body: "female" });
  });

  it("has one layout per region, each valid and using only manifest entries", async () => {
    const manifest = manifestSchema.parse(parseDocument(await sampleText("manifest.yaml")).toJS());
    const ids = new Set(manifest.assets.map((a) => a.id));
    const files = (await readdir(path.join(SAMPLE_DIR, "layouts"))).filter((f) => f.endsWith(".yaml"));
    const regions: string[] = [];
    for (const f of files) {
      const r = parseLayout(await sampleText(`layouts/${f}`));
      if (!r.ok) throw new Error(`${f}: ${r.error}`);
      expect(r.layout.name).toBe(f.slice(0, -".yaml".length));
      regions.push(regionOf(r.layout));
      expect(r.layout.elements.length).toBeGreaterThan(0);
      for (const el of r.layout.elements)
        if (el.type === "figure" || el.type === "existing") {
          expect(el.asset, `${f}: ${el.id}`).toBeDefined();
          expect(ids.has(el.asset!), `${f}: ${el.id} → ${el.asset}`).toBe(true);
        }
    }
    expect(regions.sort()).toEqual([...REGION_IDS].sort());
  });

  it("names a drawn motif for every manifest entry but the shipped Anubis photos", async () => {
    const manifest = manifestSchema.parse(parseDocument(await sampleText("manifest.yaml")).toJS());
    expect(manifest.assets.length).toBeGreaterThanOrEqual(5);
    const photos = manifest.assets.filter((a) => a.file.startsWith("photos/")).map((a) => a.file);
    for (const a of manifest.assets)
      if (!photos.includes(a.file)) expect(motifForFile(a.file), a.file).not.toBeNull();
    // The only image files are those photos (docs/adr/0029), each named by the manifest.
    const files = Object.keys(await snapshot(SAMPLE_DIR));
    const images = files.filter((f) => !f.endsWith(".yaml"));
    expect(images.sort()).toEqual(photos.sort());
    expect(images.every((f) => /^photos\/[a-z0-9-]+\.jpg$/.test(f))).toBe(true);
  });
});

describe("placeholder motifs", () => {
  it("are deterministic and differ from each other", () => {
    const hashes = new Set<string>();
    for (const m of MOTIFS) {
      const a = renderMotif(m, 64);
      const b = renderMotif(m, 64);
      expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
      // Opaque paper with some dark ink on it.
      const alpha = a.filter((_, i) => i % 4 === 3);
      expect(alpha.every((x) => x === 255)).toBe(true);
      const red = a.filter((_, i) => i % 4 === 0);
      expect(red.some((x) => x > 240)).toBe(true);
      expect(red.some((x) => x < 80)).toBe(true);
      hashes.add(createHash("sha256").update(a).digest("hex"));
    }
    expect(hashes.size).toBe(MOTIFS.length);
  });

  it("become the same PNG bytes every time", () => {
    const png = placeholderPng("images/moon.png")!;
    expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    expect(png.readUInt32BE(16)).toBe(512);
    expect(encodePng(512, 512, renderMotif("moon")).equals(png)).toBe(true);
    expect(placeholderPng("images/unknown.png")).toBeNull();
    expect(placeholderPng("images/moon.jpg")).toBeNull();
  });

  it("maps file names to motifs", () => {
    expect(motifForFile("images/compass.png")).toBe("compass");
    expect(motifForFile("compass.png")).toBe("compass");
    expect(motifForFile("images/Compass.png")).toBeNull();
  });
});

describe("isSampleWrite", () => {
  it("refuses every change to the project but allows switching and saving as", () => {
    const writes: [string, string][] = [
      ["PUT", "/api/layouts/left-arm"],
      ["PUT", "/api/projections/x"],
      ["PUT", "/api/project/measurements"],
      ["PATCH", "/api/project"],
      ["POST", "/api/project/migrate"],
      ["POST", "/api/assets/scan"],
      ["PATCH", "/api/assets/entries/moon"],
      ["POST", "/api/edits"],
      ["POST", "/api/edits/sessions"],
      ["POST", "/api/edits/sessions/s1/apply?step=x"],
      ["POST", "/api/exports"],
      ["PUT", "/api/exports/2026-11-05-left-arm.pdf"],
      ["DELETE", "/api/layouts/left-arm"],
    ];
    for (const [m, u] of writes) expect(isSampleWrite(m, u), `${m} ${u}`).toBe(true);
    const allowed: [string, string][] = [
      ["GET", "/api/layouts"],
      ["GET", "/api/assets/image/moon"],
      ["GET", "/api/project/measurements"],
      ["POST", "/api/project/open"],
      ["POST", "/api/project/create"],
      ["POST", "/api/project/close"],
      ["POST", "/api/project/open-sample"],
      ["POST", "/api/project/save-sample"],
      ["HEAD", "/api/exports"],
    ];
    for (const [m, u] of allowed) expect(isSampleWrite(m, u), `${m} ${u}`).toBe(false);
  });
});

describe("sample in the project store", () => {
  let tmp: string;
  let home: string;
  let configFile: string;
  let before: Record<string, string>;

  const store = (envDir: string | null = null, sampleDir: string | null = SAMPLE_DIR) =>
    new ProjectStore({ envDir, configFile, home, legacyConfigDir: null, sampleDir });

  beforeEach(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), "tattoo-sample-"));
    home = path.join(tmp, "home");
    configFile = path.join(home, ".config", "tattoo-planner", "config.json");
    await mkdir(home, { recursive: true });
    before = await snapshot(SAMPLE_DIR);
  });

  afterEach(async () => {
    // The shipped sample is never written to.
    expect(await snapshot(SAMPLE_DIR)).toEqual(before);
    await rm(tmp, { recursive: true, force: true });
  });

  it("opens read-only, without remembering the app's folder, and closes to the start screen", async () => {
    const s = store();
    expect((await s.status()).sampleAvailable).toBe(true);
    const status = await s.openSample();
    expect(status).toMatchObject({ status: "project", sample: true, name: "Sample project", body: "female" });
    expect(s.readOnly).toBe(true);
    const paths = await s.paths();
    expect(paths).toMatchObject({ dir: SAMPLE_DIR, readOnly: true });
    expect(paths.layoutsDir).toBe(path.join(SAMPLE_DIR, "layouts"));
    await expect(readFile(configFile, "utf8")).rejects.toThrow();
    const closed = await s.close();
    expect(closed).toMatchObject({ status: "none", sample: false });
    expect(s.readOnly).toBe(false);
  });

  it("refuses every write while the sample is open", async () => {
    const s = store();
    await s.openSample();
    await expect(s.update({ name: "X" })).rejects.toMatchObject({ status: 409, message: SAMPLE_READ_ONLY });
    await expect(s.writeMeasurements("units: cm\n")).rejects.toMatchObject({ status: 409 });
    await expect(s.migrate()).rejects.toMatchObject({ status: 409 });
  });

  it("opens beside a TATTOO_DATA_DIR project and closes back to it, but is not saved there", async () => {
    const project = path.join(tmp, "fixed");
    await mkdir(project);
    const locked = store(project);
    expect((await locked.status()).sampleAvailable).toBe(true);
    expect(await locked.openSample()).toMatchObject({ sample: true, locked: true });
    expect(await locked.close()).toMatchObject({ status: "legacy", path: project, sample: false });
    await expect(locked.close()).rejects.toMatchObject({ status: 409 });
    await expect(
      locked.saveSampleAs({ path: path.join(tmp, "x"), name: "X", body: "male" }),
    ).rejects.toMatchObject({ status: 409 });
    const none = store(null, null);
    expect((await none.status()).sampleAvailable).toBe(false);
    await expect(none.openSample()).rejects.toMatchObject({ status: 404 });
  });

  it("saves as a new project with the placeholders as PNG files and opens it", async () => {
    const s = store();
    await s.openSample();
    const target = path.join(tmp, "copy");
    const r = await s.saveSampleAs({ path: target, name: "My copy", body: "male" });
    expect(r.project).toMatchObject({ status: "project", sample: false, name: "My copy", body: "male" });
    expect(r.project.path).toBe(target);
    expect(s.readOnly).toBe(false);
    expect(r.files).toContain("layouts/torso.yaml");
    expect(r.images).toContain("images/compass.png");
    const copied = await readFile(path.join(target, "images", "compass.png"));
    expect(copied.equals(placeholderPng("images/compass.png")!)).toBe(true);
    // The shipped Anubis photos (docs/adr/0029) are copied byte for byte.
    expect(r.images).toContain("photos/anubis-1.jpg");
    expect(
      (await readFile(path.join(target, "photos", "anubis-1.jpg"))).equals(
        await readFile(path.join(SAMPLE_DIR, "photos", "anubis-1.jpg")),
      ),
    ).toBe(true);
    for (const f of ["photos", "projections"])
      expect((await stat(path.join(target, f))).isDirectory()).toBe(true);
    const projectText = await readFile(path.join(target, "project.yaml"), "utf8");
    expect(projectText).toContain("# Sample project of the Tattoo Planner");
    expect(parseProjectText(projectText)).toMatchObject({
      ok: true,
      project: { name: "My copy", body: "male" },
    });
    expect(await readFile(path.join(target, "layouts", "left-arm.yaml"), "utf8")).toBe(
      await sampleText("layouts/left-arm.yaml"),
    );
    // The copy is an ordinary project now: it can be changed.
    expect((await s.update({ name: "Renamed" })).name).toBe("Renamed");
    expect(JSON.parse(await readFile(configFile, "utf8")).project).toBe(target);
  });

  it("refuses a folder that is not empty, a missing parent and the sample's own folder", async () => {
    const s = store();
    await s.openSample();
    const full = path.join(tmp, "full");
    await mkdir(full);
    await writeFile(path.join(full, "notes.txt"), "x");
    await expect(s.saveSampleAs({ path: full, name: "X", body: "male" })).rejects.toMatchObject({
      status: 409,
    });
    await expect(
      s.saveSampleAs({ path: path.join(tmp, "no", "such"), name: "X", body: "male" }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      s.saveSampleAs({ path: path.join(SAMPLE_DIR, "inner"), name: "X", body: "male" }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      s.saveSampleAs({ path: path.join(tmp, "ok"), name: "", body: "male" }),
    ).rejects.toMatchObject({
      status: 400,
    });
    // Still the sample after the refusals.
    expect(s.readOnly).toBe(true);
  });

  it("copySample never overwrites", async () => {
    const target = path.join(tmp, "t");
    await mkdir(target);
    await copySample(SAMPLE_DIR, target, { name: "A", body: "female" });
    await expect(copySample(SAMPLE_DIR, target, { name: "A", body: "female" })).rejects.toThrow();
  });
});

describe("sample over HTTP", () => {
  let tmp: string;
  let server: { url: string; close: () => Promise<void> };

  beforeEach(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), "tattoo-sample-http-"));
    const dist = path.join(tmp, "dist");
    await mkdir(dist);
    await writeFile(path.join(dist, "index.html"), "<!doctype html><title>t</title>");
    server = await startServer({
      dist,
      port: 0,
      context: createContext({
        env: {},
        root: tmp,
        home: tmp,
        configFile: path.join(tmp, "config.json"),
        sampleDir: SAMPLE_DIR,
      }),
    });
  });

  afterEach(async () => {
    await server.close();
    await rm(tmp, { recursive: true, force: true });
  });

  const api = (p: string, init?: RequestInit) => fetch(new URL(p, server.url), init);
  const json = (method: string, body: unknown): RequestInit => ({
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  it("opens the sample, serves its layouts and drawn images and refuses writes with 409", async () => {
    const opened = await api("api/project/open-sample", json("POST", {}));
    expect(opened.status).toBe(200);
    expect(await opened.json()).toMatchObject({ sample: true });

    const layouts = (await (await api("api/layouts")).json()) as { name: string }[];
    expect(layouts.map((l) => l.name).sort()).toEqual([
      "left-arm",
      "left-leg",
      "right-arm",
      "right-leg",
      "torso",
    ]);

    const assets = (await (await api("api/assets")).json()) as {
      status: string;
      assets: { exists: boolean }[];
    };
    expect(assets.status).toBe("ok");
    expect(assets.assets.every((a) => a.exists)).toBe(true);
    const image = await api("api/assets/image/moon");
    expect(image.status).toBe(200);
    expect(image.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await image.arrayBuffer()).equals(placeholderPng("images/moon.png")!)).toBe(true);
    expect((await api("api/assets/image/nope")).status).toBe(404);
    const photo = await api("api/assets/image/anubis-1");
    expect(photo.status).toBe(200);
    expect(photo.headers.get("content-type")).toBe("image/jpeg");

    expect(await (await api("api/exports")).json()).toEqual({ enabled: false, reason: SAMPLE_READ_ONLY });
    const edits = (await (await api("api/edits")).json()) as { generative: { enabled: boolean } };
    expect(edits.generative.enabled).toBe(false);

    const layout = { name: "left-arm", region: "arm-left", elements: [] };
    const refused = [
      await api("api/layouts/left-arm", json("PUT", { layout })),
      await api("api/project/measurements", json("PUT", { text: "units: cm\n" })),
      await api("api/project", json("PATCH", { name: "X" })),
      await api("api/assets/scan", json("POST", {})),
      await api("api/exports", json("POST", { layout: "left-arm", date: "2026-11-05" })),
      await api("api/projections/x", json("PUT", { calibration: {} })),
      await api("api/edits/sessions", json("POST", { mode: "edit", assetId: "moon" })),
    ];
    for (const r of refused) {
      expect(r.status).toBe(409);
      expect(await r.json()).toEqual({ error: SAMPLE_READ_ONLY });
    }

    const target = path.join(tmp, "mine");
    const saved = await api(
      "api/project/save-sample",
      json("POST", { path: target, name: "Mine", body: "female" }),
    );
    expect(saved.status).toBe(200);
    expect((await saved.json()).project).toMatchObject({ sample: false, name: "Mine" });
    const put = await api("api/layouts/left-arm", json("PUT", { layout }));
    expect(put.status).toBe(200);
    const listing = (await (await api("api/assets")).json()) as { assets: { exists: boolean }[] };
    expect(listing.assets.every((a) => a.exists)).toBe(true);
  });
});
