import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { exportBase, isExportBase, isIsoDate, localIsoDate, parseExportPath } from "../src/export/names.ts";
import {
  checkExportFile,
  exportStatus,
  isCrossSite,
  reserveExport,
  writeExportFile,
} from "../src/export/server/exportsApi.ts";

const PDF = new Uint8Array(Buffer.from("%PDF-1.3\n%test\n"));
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

describe("export names", () => {
  it("builds <layout>-<date> and numbered repeats", () => {
    expect(exportBase("v1-baseline", "2026-11-03")).toBe("v1-baseline-2026-11-03");
    expect(exportBase("v1-baseline", "2026-11-03", 2)).toBe("v1-baseline-2026-11-03-2");
    expect(isExportBase("v1-baseline-2026-11-03")).toBe(true);
    expect(isExportBase("v1-baseline-2026-11-03-17")).toBe(true);
    expect(isExportBase("v1-baseline-2026-11-03-1")).toBe(false);
    expect(isExportBase("v1-baseline-2026-13-03")).toBe(false);
    expect(isExportBase("V1-2026-11-03")).toBe(false);
  });

  it("checks calendar dates and uses the local day", () => {
    expect(isIsoDate("2026-02-29")).toBe(false);
    expect(isIsoDate("2028-02-29")).toBe(true);
    expect(isIsoDate("2026-1-3")).toBe(false);
    expect(localIsoDate(new Date(2026, 10, 3, 23, 59))).toBe("2026-11-03");
  });

  it("accepts only <base>.pdf and <base>/<name>.png", () => {
    expect(parseExportPath("v1-baseline-2026-11-03.pdf")).toMatchObject({ kind: "pdf" });
    expect(parseExportPath("v1-baseline-2026-11-03-2/front-blockout.png")).toMatchObject({
      kind: "png",
      base: "v1-baseline-2026-11-03-2",
      file: "front-blockout",
    });
    for (const bad of [
      "../x.pdf",
      "v1-baseline-2026-11-03/../../x.png",
      "v1-baseline-2026-11-03/a/b.png",
      "v1-baseline-2026-11-03.PDF",
      "v1-baseline-2026-11-03.png",
      "v1-baseline-2026-11-03/front.pdf",
      "v1-baseline-2026-11-03/.png",
      "v1-baseline-2026-11-03/Front.png",
      "other/front.png",
      "v1-baseline.pdf",
      "/v1-baseline-2026-11-03.pdf",
      "v1-baseline-2026-11-03.pdf\0",
      "v1-baseline-2026-11-03\\a.png",
      "",
    ])
      expect(parseExportPath(bad), bad).toBeNull();
  });
});

describe("export endpoint logic", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "tattoo-exports-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("is disabled without a data folder and explains why", async () => {
    const s = await exportStatus(null);
    expect(s.enabled).toBe(false);
    if (!s.enabled) expect(s.reason).toContain("TATTOO_DATA_DIR");
    expect((await exportStatus(path.join(dir, "missing"))).enabled).toBe(false);
    expect(await exportStatus(dir)).toEqual({ enabled: true });
    await expect(reserveExport(null, "v1", "2026-11-03")).rejects.toMatchObject({ status: 409 });
    await expect(writeExportFile(null, "v1-2026-11-03.pdf", "application/pdf", PDF)).rejects.toMatchObject({
      status: 409,
    });
  });

  it("reserves a fresh name and adds -2, -3 when the day's export exists", async () => {
    const a = await reserveExport(dir, "v1-baseline", "2026-11-03");
    expect(a).toEqual({
      base: "v1-baseline-2026-11-03",
      pdf: "exports/v1-baseline-2026-11-03.pdf",
      folder: "exports/v1-baseline-2026-11-03/",
    });
    const b = await reserveExport(dir, "v1-baseline", "2026-11-03");
    expect(b.base).toBe("v1-baseline-2026-11-03-2");
    // A PDF without its folder (Jan deleted the PNGs) still blocks its name.
    await writeFile(path.join(dir, "exports", "v1-baseline-2026-11-03-3.pdf"), "x");
    expect((await reserveExport(dir, "v1-baseline", "2026-11-03")).base).toBe("v1-baseline-2026-11-03-4");
    expect(await readdir(path.join(dir, "exports"))).toContain("v1-baseline-2026-11-03-4");
  });

  it("rejects bad layout names and dates", async () => {
    await expect(reserveExport(dir, "../x", "2026-11-03")).rejects.toMatchObject({ status: 400 });
    await expect(reserveExport(dir, "V1", "2026-11-03")).rejects.toMatchObject({ status: 400 });
    await expect(reserveExport(dir, "v1", "03.11.2026")).rejects.toMatchObject({ status: 400 });
    await expect(reserveExport(dir, 7, "2026-11-03")).rejects.toMatchObject({ status: 400 });
  });

  it("writes reserved files once and never overwrites", async () => {
    const r = await reserveExport(dir, "v1-baseline", "2026-11-03");
    const pdf = await writeExportFile(dir, `${r.base}.pdf`, "application/pdf", PDF);
    expect(pdf.path).toBe("exports/v1-baseline-2026-11-03.pdf");
    expect(await readFile(pdf.absolute, "latin1")).toContain("%PDF-");
    const png = await writeExportFile(dir, `${r.base}/front-blockout.png`, "image/png", PNG);
    expect(png).toMatchObject({ path: "exports/v1-baseline-2026-11-03/front-blockout.png", bytes: 12 });
    await expect(writeExportFile(dir, `${r.base}.pdf`, "application/pdf", PDF)).rejects.toMatchObject({
      status: 409,
    });
    await expect(
      writeExportFile(dir, `${r.base}/front-blockout.png`, "image/png", PNG),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("refuses names that were not reserved", async () => {
    await expect(
      writeExportFile(dir, "v1-baseline-2026-11-03.pdf", "application/pdf", PDF),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      writeExportFile(dir, "v1-baseline-2026-11-03/front.png", "image/png", PNG),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("checks content type, magic bytes and size", () => {
    const root = path.join(dir, "exports");
    expect(() => checkExportFile(root, "a-2026-11-03.pdf", "image/png", PDF)).toThrow(/application\/pdf/);
    expect(() => checkExportFile(root, "a-2026-11-03.pdf", "application/pdf", PNG)).toThrow(/not a PDF/);
    expect(() => checkExportFile(root, "a-2026-11-03/x.png", "image/png", PDF)).toThrow(/not a PNG/);
    expect(() => checkExportFile(root, "a-2026-11-03.pdf", "application/pdf", new Uint8Array())).toThrow(
      /empty/,
    );
    expect(() => checkExportFile(root, "a-2026-11-03.exe", "application/pdf", PDF)).toThrow(/invalid/);
    expect(checkExportFile(root, "a-2026-11-03.pdf", "application/pdf; charset=binary", PDF).path).toBe(
      path.join(root, "a-2026-11-03.pdf"),
    );
  });

  it("refuses an exports folder or export folder that is a symlink out of the data folder", async () => {
    const outside = await mkdtemp(path.join(os.tmpdir(), "tattoo-outside-"));
    try {
      await symlink(outside, path.join(dir, "exports"));
      await expect(reserveExport(dir, "v1", "2026-11-03")).rejects.toMatchObject({ status: 403 });
      await rm(path.join(dir, "exports"));
      await mkdir(path.join(dir, "exports"));
      await symlink(outside, path.join(dir, "exports", "v1-2026-11-03"));
      await expect(writeExportFile(dir, "v1-2026-11-03/front.png", "image/png", PNG)).rejects.toMatchObject({
        status: 403,
      });
      expect(await readdir(outside)).toEqual([]);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("tells same-origin requests from cross-site ones", () => {
    expect(isCrossSite({})).toBe(false);
    expect(isCrossSite({ "sec-fetch-site": "same-origin" })).toBe(false);
    expect(isCrossSite({ "sec-fetch-site": "cross-site" })).toBe(true);
    expect(isCrossSite({ "sec-fetch-site": "same-site" })).toBe(true);
  });
});
