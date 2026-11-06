// The standard-background generator (docs/adr/0019): PNG decoding, the seam fix on a returned image,
// `npm run backgrounds:generate` and the Image studio's Background mode against a fake OpenAI endpoint.
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { crc32, deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { generateStandardBackgrounds, seamlessPng } from "../server/backgrounds.ts";
import { EditManager } from "../server/editsApi.ts";
import { decodePng, encodeGreyPng, encodePng } from "../server/png.ts";
import { buildBackgroundPrompt } from "../src/edits/background.ts";
import { parseCatalogue } from "../src/render/backgrounds/catalogue.ts";
import { seamRatio } from "../src/render/backgrounds/seam.ts";

const root = path.join(import.meta.dirname, "..");

/** A PNG with an explicit filter byte per row (the encoder only writes filter 0). */
function filteredPng(width: number, height: number, rgb: Uint8Array, filters: number[]): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  const at = (x: number, y: number) => (x < 0 || y < 0 ? 0 : rgb[y * stride + x]!);
  for (let y = 0; y < height; y++) {
    const f = filters[y % filters.length]!;
    raw[y * (stride + 1)] = f;
    for (let x = 0; x < stride; x++) {
      const a = at(x - 3, y);
      const b = at(x, y - 1);
      const c = at(x - 3, y - 1);
      const p = a + b - c;
      const paeth =
        Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c)
          ? a
          : Math.abs(p - b) <= Math.abs(p - c)
            ? b
            : c;
      const pred = [0, a, b, (a + b) >> 1, paeth][f]!;
      raw[y * (stride + 1) + 1 + x] = (at(x, y) - pred) & 255;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** A tile that does not wrap: a horizontal and vertical ramp. */
function rampRgba(n: number): Uint8Array {
  const px = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const v = Math.round(255 * ((x + y) / (2 * n)));
      px.set([v, v, v, 255], (y * n + x) * 4);
    }
  return px;
}

describe("decodePng", () => {
  it("reads every row filter of an RGB PNG", () => {
    const w = 7;
    const h = 10;
    const rgb = Uint8Array.from({ length: w * h * 3 }, (_, i) => (i * 37 + (i >> 3) * 11) & 255);
    const img = decodePng(filteredPng(w, h, rgb, [0, 1, 2, 3, 4]));
    expect([img.width, img.height]).toEqual([w, h]);
    for (let k = 0; k < w * h; k++) {
      expect([...img.rgba.subarray(k * 4, k * 4 + 4)]).toEqual([
        rgb[k * 3],
        rgb[k * 3 + 1],
        rgb[k * 3 + 2],
        255,
      ]);
    }
  });

  it("round-trips the RGBA and greyscale encoders and refuses other files", () => {
    const rgba = Uint8Array.from({ length: 4 * 3 * 4 }, (_, i) => (i * 29) & 255);
    expect(decodePng(encodePng(4, 3, rgba)).rgba).toEqual(rgba);
    const grey = decodePng(encodeGreyPng(2, 1, Uint8Array.from([10, 200])));
    expect([...grey.rgba]).toEqual([10, 10, 10, 255, 200, 200, 200, 255]);
    expect(() => decodePng(Buffer.from("GIF89a"))).toThrow(/not a PNG/);
  });
});

describe("seamlessPng", () => {
  it("makes a returned tile seamless, scales it down and stores grey as greyscale", () => {
    const n = 64;
    const src = rampRgba(n);
    const before = seamRatio({ width: n, height: n, data: new Uint8ClampedArray(src) });
    const out = seamlessPng(encodePng(n, n, src), { maxPx: 32 });
    expect([out.width, out.height]).toEqual([32, 32]);
    expect(out.png[25]).toBe(0); // IHDR colour type 0: greyscale
    const img = decodePng(out.png);
    const after = seamRatio({ width: img.width, height: img.height, data: new Uint8ClampedArray(img.rgba) });
    expect(after).toBeLessThan(before / 2);
  });

  it("halves the tile while it is over the byte cap", () => {
    const n = 128;
    const noise = Uint8Array.from({ length: n * n * 4 }, (_, i) =>
      i % 4 === 3 ? 255 : (i * 2654435761) >>> 24,
    );
    const out = seamlessPng(encodePng(n, n, noise), { maxBytes: 20_000 });
    expect(out.png.length).toBeLessThanOrEqual(20_000);
    expect(out.width).toBeLessThan(n);
  });
});

describe("generateStandardBackgrounds", () => {
  const setup = () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "bg-gen-"));
    copyFileSync(
      path.join(root, "assets", "backgrounds", "backgrounds.yaml"),
      path.join(dir, "backgrounds.yaml"),
    );
    return dir;
  };
  const settings = {
    apiKey: "sk-test",
    model: "gpt-image-test",
    inputFidelity: null,
    quality: "high",
  } as const;
  const b64 = encodePng(64, 64, rampRgba(64)).toString("base64");

  it("asks for each chosen prompt, writes seamless PNGs and fills in the catalogue", async () => {
    const dir = setup();
    const before = readFileSync(path.join(dir, "backgrounds.yaml"), "utf8");
    const bodies: Record<string, unknown>[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      expect(url).toMatch(/images\/generations$/);
      expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk-test");
      bodies.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ data: [{ b64_json: b64 }] }), { status: 200 });
    }) as typeof fetch;
    const r = await generateStandardBackgrounds({
      folder: dir,
      settings,
      names: ["clouds", "stars"],
      fetchImpl,
      today: "2026-11-06",
    });
    expect(r.written).toEqual(["clouds.png", "stars.png"]);
    expect(bodies[0]).toMatchObject({ model: "gpt-image-test", size: "1024x1024", background: "opaque" });
    const cat = parseCatalogue(before);
    expect(bodies[0]!.prompt).toBe(buildBackgroundPrompt(cat.ok ? cat.catalogue.backgrounds[0]!.prompt : ""));
    const png = decodePng(readFileSync(path.join(dir, "clouds.png")));
    expect(png.width).toBe(64);

    const after = readFileSync(path.join(dir, "backgrounds.yaml"), "utf8");
    const parsed = parseCatalogue(after);
    expect(parsed.ok).toBe(true);
    const clouds = parsed.ok ? parsed.catalogue.backgrounds.find((e) => e.name === "clouds") : undefined;
    expect(clouds).toMatchObject({ file: "clouds.png", generated: "gpt-image-test, 2026-11-06" });
    expect(clouds?.licence).toMatch(/GPT Image/);
    // Only the three keys of the two entries are added; comments and prompts stay as they were.
    const added = after.split("\n").filter((l) => !before.split("\n").includes(l));
    expect(added.map((l) => l.trim().split(":")[0])).toEqual([
      "file",
      "generated",
      "licence",
      "file",
      "generated",
      "licence",
    ]);
    expect(before.split("\n").every((l) => after.includes(l))).toBe(true);
  });

  it("skips entries that have a file, reports API errors and refuses unknown names", async () => {
    const dir = setup();
    writeFileSync(path.join(dir, "smoke.png"), encodePng(1, 1, Uint8Array.from([0, 0, 0, 255])));
    const text = readFileSync(path.join(dir, "backgrounds.yaml"), "utf8");
    writeFileSync(
      path.join(dir, "backgrounds.yaml"),
      text.replace("  - name: smoke\n", "  - name: smoke\n    file: smoke.png\n"),
    );
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ error: { message: "quota" } }), {
        status: 429,
      })) as unknown as typeof fetch;
    const r = await generateStandardBackgrounds({ folder: dir, settings, fetchImpl });
    expect(r.skipped).toEqual(["smoke"]);
    expect(r.written).toEqual([]);
    expect(r.failed[0]).toEqual({ name: "clouds", error: "OpenAI: quota" });
    await expect(
      generateStandardBackgrounds({ folder: dir, settings, names: ["nope"], fetchImpl }),
    ).rejects.toThrow(/not in backgrounds.yaml: nope/);
  });
});

describe("Image studio: Background mode", () => {
  it("asks for a square opaque tile, fixes its seam and keeps it in backgrounds/ as kind background", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "bg-studio-"));
    writeFileSync(path.join(dir, "manifest.yaml"), "version: 1\nassets: []\n");
    const bodies: Record<string, unknown>[] = [];
    const answer = encodePng(64, 64, rampRgba(64)).toString("base64");
    const m = new EditManager(dir, {
      openai: { apiKey: "sk-test", model: "gpt-image-test", inputFidelity: null, quality: "high" },
      fetchImpl: (async (_url: string, init: RequestInit) => {
        bodies.push(JSON.parse(String(init.body)));
        return new Response(JSON.stringify({ data: [{ b64_json: answer }] }), { status: 200 });
      }) as typeof fetch,
    });
    const s = await m.startSession({ mode: "create", name: "Night sky", size: "1024x1536", tileable: true });
    expect(s.create).toEqual({ name: "night-sky", size: "1024x1024", background: "opaque", tileable: true });
    const started = await m.start({ session: s.id, instruction: "Sterne und Punkte" });
    expect(started.created).toEqual({ name: "night-sky", tileable: true });
    let job = m.get(started.id);
    for (let i = 0; i < 200 && job.state === "running"; i++) {
      await new Promise((r) => setTimeout(r, 5));
      job = m.get(started.id);
    }
    expect(job.state).toBe("done");
    expect(bodies[0]).toMatchObject({ size: "1024x1024", background: "opaque" });
    expect(bodies[0]!.prompt).toBe(buildBackgroundPrompt("Sterne und Punkte"));
    expect(job.log.join("\n")).toMatch(/Seam fixed/);
    const kept = await m.keep(job.id);
    expect(kept.kept).toEqual({ id: "night-sky-1", file: "backgrounds/night-sky-1.png" });
    const out = decodePng(readFileSync(path.join(dir, "backgrounds", "night-sky-1.png")));
    const ramp = seamRatio({ width: 64, height: 64, data: new Uint8ClampedArray(rampRgba(64)) });
    const fixed = seamRatio({ width: out.width, height: out.height, data: new Uint8ClampedArray(out.rgba) });
    expect(fixed).toBeLessThan(ramp / 2);
    const manifest = readFileSync(path.join(dir, "manifest.yaml"), "utf8");
    expect(manifest).toMatch(/kind: background/);
    expect(manifest).toMatch(/background\b.*\n?.*tags/s);
  });
});
