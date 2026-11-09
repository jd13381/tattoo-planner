// Padding generative edits to GPT Image's output sizes and cropping the answer back (src/edits/pad.ts).
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  changesInput,
  closestSize,
  contentRect,
  cropRgba,
  isPadded,
  needsPngSource,
  padFill,
  padPlan,
  padPromptLine,
  padRgba,
  type Rgba,
} from "../src/edits/pad.ts";
import { openaiSettingsFromEnv, type OpenAISettings } from "../src/edits/openai.ts";
import { EditManager } from "../server/editsApi.ts";
import { decodePng, encodePng } from "../server/png.ts";
import type { EditJob } from "../src/edits/types.ts";

function solid(
  width: number,
  height: number,
  rgba: [number, number, number, number],
): Rgba & { data: Uint8Array } {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < data.length; i += 4) data.set(rgba, i);
  return { width, height, data };
}

function pixel(img: Rgba, x: number, y: number): number[] {
  const i = (y * img.width + x) * 4;
  return [...img.data.subarray(i, i + 4)];
}

describe("pad plan", () => {
  it("picks the closest supported shape by aspect", () => {
    expect(closestSize(1000, 1000)).toBe("1024x1024");
    expect(closestSize(4032, 3024)).toBe("1536x1024"); // 4:3 photo → 3:2
    expect(closestSize(3024, 4032)).toBe("1024x1536");
    expect(closestSize(1100, 1000)).toBe("1024x1024");
    expect(closestSize(3000, 1000)).toBe("1536x1024");
  });

  it("pads the short side, centres the image and scales down to the output size", () => {
    const p = padPlan(4032, 3024);
    expect(p).toEqual({
      size: "1536x1024",
      source: { width: 4032, height: 3024 },
      padded: { width: 4536, height: 3024 },
      offset: { x: 252, y: 0 },
      send: { width: 1536, height: 1024 },
    });
    expect(isPadded(p)).toBe(true);
    const tall = padPlan(300, 1000);
    expect(tall.size).toBe("1024x1536");
    expect(tall.padded).toEqual({ width: 667, height: 1000 });
    expect(tall.offset).toEqual({ x: 183, y: 0 });
    // Already the right shape and small: nothing to do, but the size is still explicit.
    const exact = padPlan(1024, 1024);
    expect(changesInput(exact)).toBe(false);
    // The right shape but large: only scaled down, no bars, no crop.
    const big = padPlan(3072, 2048);
    expect(isPadded(big)).toBe(false);
    expect(changesInput(big)).toBe(true);
    expect(big.send).toEqual({ width: 1536, height: 1024 });
    expect(() => padPlan(0, 10)).toThrow();
  });

  it("crops an answer back to the original's aspect", () => {
    const p = padPlan(4032, 3024);
    const r = contentRect(p, { width: 1536, height: 1024 });
    expect(r).toEqual({ x: 85, y: 0, width: 1366, height: 1024 });
    expect(r.width / r.height).toBeCloseTo(4032 / 3024, 2);
    // An answer in another size is scaled the same way.
    expect(contentRect(p, { width: 768, height: 512 })).toEqual({ x: 43, y: 0, width: 682, height: 512 });
    const wide = padPlan(300, 100);
    expect(contentRect(wide, { width: 1536, height: 1024 })).toEqual({
      x: 0,
      y: 256,
      width: 1536,
      height: 512,
    });
  });
});

describe("pad pixels", () => {
  it("adds grey bars to an opaque image and keeps transparency for a cut-out", () => {
    const red = solid(4, 2, [255, 0, 0, 255]);
    expect(padFill(red)).toBe("grey");
    const p = padPlan(4, 2);
    expect(p.padded).toEqual({ width: 4, height: 3 });
    const out = padRgba(red, p, "grey");
    expect(out).toMatchObject({ width: 4, height: 3 });
    expect(pixel(out, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(pixel(out, 0, 2)).toEqual([128, 128, 128, 255]);
    const cut = solid(4, 2, [0, 0, 255, 0]);
    cut.data.set([0, 0, 255, 255], 0);
    expect(padFill(cut)).toBe("transparent");
    expect(pixel(padRgba(cut, p, "transparent"), 1, 2)).toEqual([0, 0, 0, 0]);
  });

  it("averages blocks when scaling down, weighting colour by alpha", () => {
    const img = solid(3072, 2048, [0, 0, 0, 0]);
    // Every second pixel opaque white: averaged to white at half alpha, no dark fringe.
    for (let i = 0; i < img.data.length; i += 8) img.data.set([255, 255, 255, 255], i);
    const p = padPlan(3072, 2048);
    const out = padRgba(img, p, "transparent");
    expect(out).toMatchObject({ width: 1536, height: 1024 });
    expect(pixel(out, 10, 10)).toEqual([255, 255, 255, 128]);
  });

  it("round-trips: pad, scale to the answer size, crop gives the original's shape and pixels", () => {
    const img = solid(30, 10, [10, 200, 30, 255]);
    const p = padPlan(30, 10);
    const sent = padRgba(img, p, "grey");
    expect(sent).toMatchObject({ width: 30, height: 20 });
    const back = cropRgba(sent, contentRect(p, sent));
    expect(back).toMatchObject({ width: 30, height: 10 });
    expect(pixel(back, 0, 0)).toEqual([10, 200, 30, 255]);
    expect(pixel(back, 29, 9)).toEqual([10, 200, 30, 255]);
  });

  it("names the bars in the prompt only when there are any", () => {
    expect(padPromptLine(padPlan(30, 10), "grey")).toContain("plain grey padding bars at the top and bottom");
    expect(padPromptLine(padPlan(10, 30), "transparent")).toContain(
      "transparent padding bars at the left and right",
    );
    expect(padPromptLine(padPlan(1024, 1024), "grey")).toBeNull();
  });

  it("asks the page for a PNG copy of anything but a PNG", () => {
    expect(needsPngSource("photos/front.JPG")).toBe(true);
    expect(needsPngSource("images/a.webp")).toBe(true);
    expect(needsPngSource("edits/a-edit-1.PNG")).toBe(false);
  });

  it("is on by default and can be switched off in the environment", () => {
    expect(openaiSettingsFromEnv({ TATTOO_OPENAI_API_KEY: "sk" })?.padToSize).toBeUndefined();
    expect(openaiSettingsFromEnv({ TATTOO_OPENAI_API_KEY: "sk", TATTOO_OPENAI_PAD: "off" })?.padToSize).toBe(
      false,
    );
  });
});

describe("EditManager pads GPT Image requests", () => {
  const SETTINGS: OpenAISettings = { apiKey: "sk-test", model: "m", inputFidelity: null, quality: "high" };
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "tp-pad-"));
    await mkdir(path.join(dir, "photos"));
    await writeFile(
      path.join(dir, "photos", "wide.png"),
      encodePng(300, 100, solid(300, 100, [200, 50, 50, 255]).data),
    );
    await writeFile(path.join(dir, "photos", "front.jpg"), "jpeg bytes");
    await writeFile(
      path.join(dir, "manifest.yaml"),
      `assets:
  - { id: wide, file: photos/wide.png, kind: arm-photo }
  - { id: front, file: photos/front.jpg, kind: arm-photo }
`,
    );
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  type Call = { form: FormData };
  /** Answers every request with a 600 × 400 PNG: red where the image was, blue in the bars. */
  function fakeFetch(calls: Call[]): typeof fetch {
    const answer = solid(600, 400, [0, 0, 255, 255]);
    for (let y = 100; y < 300; y++)
      for (let x = 0; x < 600; x++) answer.data.set([220, 40, 40, 255], (y * 600 + x) * 4);
    const b64 = encodePng(600, 400, answer.data).toString("base64");
    return (async (_url: string | URL | Request, init?: RequestInit) => {
      calls.push({ form: init?.body as FormData });
      return new Response(JSON.stringify({ data: [{ b64_json: b64 }] }), { status: 200 });
    }) as typeof fetch;
  }

  async function finished(m: EditManager, id: string): Promise<EditJob> {
    for (let i = 0; i < 200; i++) {
      const j = m.get(id);
      if (j.state !== "running") return j;
      await new Promise((r) => setTimeout(r, 5));
    }
    throw new Error("job did not finish");
  }

  async function sentImage(call: Call) {
    const file = call.form.get("image") as Blob;
    return decodePng(new Uint8Array(await file.arrayBuffer()));
  }

  it("pads a PNG to the output shape, names the bars and crops the answer back", async () => {
    const calls: Call[] = [];
    const m = new EditManager(dir, { openai: SETTINGS, fetchImpl: fakeFetch(calls) });
    const job = await finished(
      m,
      (await m.start({ assetId: "wide", instruction: "x", engine: "openai" })).id,
    );
    expect(job.state).toBe("done");
    expect(calls[0]!.form.get("size")).toBe("1536x1024");
    expect(String(calls[0]!.form.get("prompt"))).toContain("padding bars at the top and bottom");
    const sent = await sentImage(calls[0]!);
    expect([sent.width, sent.height]).toEqual([300, 200]);
    expect([...sent.rgba.subarray(0, 4)]).toEqual([128, 128, 128, 255]);
    // 600 × 400 answer, image in rows 100–299: cropped to 600 × 200, the original's 3:1.
    expect(job.output).toMatchObject({ width: 600, height: 200, alpha: false });
    const out = decodePng(new Uint8Array(await readFile(m.file(job.id, "output"))));
    expect([...out.rgba.subarray(0, 4)]).toEqual([220, 40, 40, 255]);
    expect(job.log.some((l) => l.startsWith("Cropped the padding off"))).toBe(true);
    await m.close();
  });

  it("sends a JPEG as it is unless the page gave a PNG copy, and can be switched off", async () => {
    const calls: Call[] = [];
    const m = new EditManager(dir, { openai: SETTINGS, fetchImpl: fakeFetch(calls) });
    const session = await m.startSession({ mode: "edit", assetId: "front" });
    const plain = await finished(
      m,
      (await m.start({ session: session.id, instruction: "x", engine: "openai" })).id,
    );
    expect(calls[0]!.form.get("size")).toBe("auto");
    expect(plain.log.some((l) => l.startsWith("Not padded (not a PNG)"))).toBe(true);

    await expect(m.setSource(session.id, Buffer.from("nope"))).rejects.toMatchObject({ status: 415 });
    await m.setSource(session.id, encodePng(300, 100, solid(300, 100, [200, 50, 50, 255]).data));
    const padded = await finished(
      m,
      (await m.start({ session: session.id, instruction: "y", engine: "openai" })).id,
    );
    expect(padded.state).toBe("done");
    expect(calls[1]!.form.get("size")).toBe("1536x1024");
    expect((await sentImage(calls[1]!)).height).toBe(200);
    expect(padded.output).toMatchObject({ width: 600, height: 200 });

    const off = new EditManager(dir, {
      openai: { ...SETTINGS, padToSize: false },
      fetchImpl: fakeFetch(calls),
    });
    await finished(off, (await off.start({ assetId: "wide", instruction: "z", engine: "openai" })).id);
    expect(calls[2]!.form.get("size")).toBe("auto");
    await off.close();
    await m.closeSession(session.id);
    await m.close();
  });
});
