import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseManifestText } from "../src/assets/manifestDoc.ts";
import { keptAsset, OUTPUT_FILE } from "../src/edits/edit.ts";
import {
  buildEditForm,
  buildGenerativePrompt,
  DEFAULT_OPENAI_MODEL,
  estimateCostUsd,
  openaiInputType,
  openaiSettingsFromEnv,
  parseEditResponse,
  rejectsInputFidelity,
  type OpenAISettings,
} from "../src/edits/openai.ts";
import { EditManager, editOptionsFromEnv, type Runner } from "../src/edits/server/editsApi.ts";
import type { EditJob } from "../src/edits/types.ts";

/** Header-only PNG: signature, IHDR with the given size and colour type, IEND. */
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

const SETTINGS: OpenAISettings = {
  apiKey: "sk-test",
  model: "gpt-image-2.5-sunburst",
  inputFidelity: "high",
  quality: "high",
};

describe("OpenAI edit rules", () => {
  it("reads settings from the environment, with a key only", () => {
    expect(openaiSettingsFromEnv({})).toBeNull();
    expect(openaiSettingsFromEnv({ TATTOO_OPENAI_API_KEY: "  " })).toBeNull();
    expect(openaiSettingsFromEnv({ TATTOO_OPENAI_API_KEY: "sk-a" })).toEqual({
      apiKey: "sk-a",
      model: DEFAULT_OPENAI_MODEL,
      inputFidelity: "high",
      quality: "high",
    });
    expect(
      openaiSettingsFromEnv({
        OPENAI_API_KEY: "sk-b",
        TATTOO_OPENAI_MODEL: "gpt-image-2.5-flare",
        TATTOO_OPENAI_FIDELITY: "default",
        TATTOO_OPENAI_QUALITY: "medium",
      }),
    ).toEqual({ apiKey: "sk-b", model: "gpt-image-2.5-flare", inputFidelity: null, quality: "medium" });
    expect(editOptionsFromEnv({ TATTOO_OPENAI_API_KEY: "sk-a" }).openai?.apiKey).toBe("sk-a");
    expect(editOptionsFromEnv({}).openai).toBeNull();
  });

  it("accepts PNG, JPEG and WebP only", () => {
    expect(openaiInputType("refs/a.JPG")).toBe("image/jpeg");
    expect(openaiInputType("input.webp")).toBe("image/webp");
    expect(openaiInputType("input.gif")).toBeNull();
  });

  it("asks to keep everything the instruction does not mention", () => {
    const p = buildGenerativePrompt({
      instructions: ["Remove the background", "Weniger Schlangen, Schädel lösen"],
      asset: { id: "medusa-ref-01", kind: "reference" },
    });
    expect(p).toContain("Weniger Schlangen, Schädel lösen");
    expect(p).not.toContain("Remove the background");
    expect(p).toContain("Keep everything the instruction does not mention");
  });

  it("builds the multipart request", async () => {
    const form = buildEditForm({
      images: [{ bytes: png(10, 10), fileName: "input.png", mimeType: "image/png" }],
      prompt: "fewer snakes",
      settings: SETTINGS,
    });
    expect(form.get("model")).toBe("gpt-image-2.5-sunburst");
    expect(form.get("prompt")).toBe("fewer snakes");
    expect(form.get("n")).toBe("1");
    expect(form.get("input_fidelity")).toBe("high");
    expect(form.get("output_format")).toBe("png");
    const image = form.get("image") as File;
    expect(image.name).toBe("input.png");
    expect(image.type).toBe("image/png");
    expect(Buffer.from(await image.arrayBuffer())).toEqual(png(10, 10));
    const noFidelity = buildEditForm({
      images: [{ bytes: png(1, 1), fileName: "i.png", mimeType: "image/png" }],
      prompt: "x",
      settings: { ...SETTINGS, inputFidelity: null },
    });
    expect(noFidelity.has("input_fidelity")).toBe(false);
  });

  it("reads answers and errors", () => {
    const b64 = png(4, 3).toString("base64");
    const ok = parseEditResponse(200, { data: [{ b64_json: b64 }], usage: { output_tokens: 10 } });
    expect(ok.ok && Buffer.from(ok.png)).toEqual(png(4, 3));
    expect(parseEditResponse(200, { data: [] })).toEqual({ ok: false, message: "OpenAI returned no image" });
    expect(parseEditResponse(401, { error: { message: "Incorrect API key" } })).toEqual({
      ok: false,
      message: "OpenAI: Incorrect API key",
    });
    expect(parseEditResponse(500, null)).toEqual({ ok: false, message: "OpenAI: HTTP 500" });
    expect(rejectsInputFidelity("OpenAI: Unknown parameter: 'input_fidelity'.")).toBe(true);
    expect(rejectsInputFidelity("OpenAI: Incorrect API key")).toBe(false);
  });

  it("estimates the cost from token usage", () => {
    expect(estimateCostUsd(null)).toBeNull();
    // 100 text, 1000 image input, 4000 image output tokens.
    const cost = estimateCostUsd({
      input_tokens: 1100,
      output_tokens: 4000,
      input_tokens_details: { text_tokens: 100, image_tokens: 1000 },
    });
    expect(cost).toBeCloseTo((100 * 5 + 1000 * 8 + 4000 * 30) / 1e6, 10);
  });

  it("names each step's tool in the notes when the tools differ", () => {
    const original = { id: "m", file: "refs/m.png", kind: "reference", tags: [] };
    const v = { id: "m-edit-1", file: "edits/m-edit-1.png" };
    expect(keptAsset(original, v, ["a", "b"], false, ["claude -p", "gpt-image-2.5-sunburst"]).notes).toBe(
      'Edited: "a" (claude -p), then "b" (gpt-image-2.5-sunburst)',
    );
    expect(keptAsset(original, v, ["a"], false, ["gpt-image-2.5-sunburst"]).notes).toBe(
      'Edited with gpt-image-2.5-sunburst: "a"',
    );
  });
});

describe("EditManager with GPT Image", () => {
  let dir: string;
  let cache: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "tp-gen-"));
    cache = await mkdtemp(path.join(os.tmpdir(), "tp-gen-cache-"));
    await mkdir(path.join(dir, "refs"));
    await writeFile(path.join(dir, "refs", "medusa.png"), png(100, 50, 2));
    await writeFile(path.join(dir, "refs", "anim.gif"), "GIF89a");
    await writeFile(
      path.join(dir, "manifest.yaml"),
      `version: 1
assets:
  - id: medusa-ref-01
    file: refs/medusa.png
    kind: reference
    tags: [medusa]
  - id: anim
    file: refs/anim.gif
    kind: reference
    tags: []
`,
    );
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    await rm(cache, { recursive: true, force: true });
  });

  const enabled = async () => ({ enabled: true as const, claude: "test" });

  type Call = { url: string; auth: string | null; form: FormData };
  /** A fetch that answers like the edit endpoint; `answer` decides per call. */
  function fakeFetch(calls: Call[], answer: (n: number) => { status: number; body: unknown }): typeof fetch {
    return (async (url: string | URL | Request, init?: RequestInit) => {
      const form = init?.body as FormData;
      calls.push({ url: String(url), auth: new Headers(init?.headers).get("authorization"), form });
      const a = answer(calls.length);
      return new Response(JSON.stringify(a.body), { status: a.status });
    }) as typeof fetch;
  }

  async function finished(m: EditManager, id: string): Promise<EditJob> {
    for (let i = 0; i < 100; i++) {
      const j = m.get(id);
      if (j.state !== "running") return j;
      await new Promise((r) => setTimeout(r, 5));
    }
    throw new Error("job did not finish");
  }

  it("is disabled without a key and says how to set one", async () => {
    const m = new EditManager(dir, { bin: "claude", cacheDir: cache, checkClaude: enabled, openai: null });
    const o = await m.overview();
    expect(o.availability.enabled).toBe(true);
    expect(o.generative).toMatchObject({
      enabled: false,
      reason: expect.stringContaining("TATTOO_OPENAI_API_KEY"),
    });
    await expect(
      m.start({ assetId: "medusa-ref-01", instruction: "x", engine: "openai" }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("sends a copy, keeps the answer as a new asset and chains with a local edit", async () => {
    const calls: Call[] = [];
    const answer = png(100, 50).toString("base64");
    const m = new EditManager(dir, {
      bin: "claude",
      cacheDir: cache,
      checkClaude: enabled,
      openai: SETTINGS,
      fetchImpl: fakeFetch(calls, () => ({
        status: 200,
        body: {
          data: [{ b64_json: answer }],
          usage: { input_tokens: 1000, output_tokens: 4000, input_tokens_details: { image_tokens: 1000 } },
        },
      })),
      runner: (async ({ cwd }) => {
        await writeFile(path.join(cwd, OUTPUT_FILE), png(100, 50));
        return { code: 0, stderr: "" };
      }) as Runner,
    });
    expect((await m.overview()).generative).toEqual({ enabled: true, model: "gpt-image-2.5-sunburst" });
    const started = await m.start({
      assetId: "medusa-ref-01",
      instruction: "Weniger Schlangen",
      engine: "openai",
    });
    expect(started).toMatchObject({ engine: "openai", tools: ["gpt-image-2.5-sunburst"] });
    const job = await finished(m, started.id);
    expect(job.state).toBe("done");
    expect(job.output).toMatchObject({ width: 100, height: 50, alpha: true });
    expect(job.costUsd).toBeCloseTo((1000 * 8 + 4000 * 30) / 1e6, 10);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://api.openai.com/v1/images/edits");
    expect(calls[0]!.auth).toBe("Bearer sk-test");
    expect(String(calls[0]!.form.get("prompt"))).toContain("Weniger Schlangen");

    // Then a local edit on the generative result.
    const next = await m.start({ fromJob: job.id, instruction: "Remove the background" });
    expect(next.tools).toEqual(["gpt-image-2.5-sunburst", "claude -p"]);
    expect((await finished(m, next.id)).state).toBe("done");
    await m.keep(next.id);
    const text = await readFile(path.join(dir, "manifest.yaml"), "utf8");
    const entry = (parseManifestText(text).toJS().assets as { id: string; notes?: string }[])[2]!;
    expect(entry.id).toBe("medusa-ref-01-edit-1");
    expect(entry.notes).toBe(
      'Edited: "Weniger Schlangen" (gpt-image-2.5-sunburst), then "Remove the background" (claude -p)',
    );
    expect(await readFile(path.join(dir, "refs", "medusa.png"))).toEqual(png(100, 50, 2));
    await m.close();
  });

  it("retries without input_fidelity when the model refuses it, and reports API errors", async () => {
    const calls: Call[] = [];
    const answer = png(8, 8).toString("base64");
    const m = new EditManager(dir, {
      bin: "claude",
      cacheDir: cache,
      checkClaude: enabled,
      openai: SETTINGS,
      fetchImpl: fakeFetch(calls, (n) =>
        n === 1
          ? { status: 400, body: { error: { message: "Unknown parameter: 'input_fidelity'." } } }
          : n === 2
            ? { status: 200, body: { data: [{ b64_json: answer }] } }
            : { status: 401, body: { error: { message: "Incorrect API key provided" } } },
      ),
    });
    const job = await finished(
      m,
      (await m.start({ assetId: "medusa-ref-01", instruction: "x", engine: "openai" })).id,
    );
    expect(job.state).toBe("done");
    expect(calls.map((c) => c.form.has("input_fidelity"))).toEqual([true, false]);
    expect(job.costUsd).toBeUndefined();

    const failed = await finished(
      m,
      (await m.start({ assetId: "medusa-ref-01", instruction: "y", engine: "openai" })).id,
    );
    expect(failed).toMatchObject({ state: "failed", error: "OpenAI: Incorrect API key provided" });
    await m.close();
  });

  it("refuses image types the API does not take and unknown engines", async () => {
    const m = new EditManager(dir, {
      bin: "claude",
      cacheDir: cache,
      checkClaude: enabled,
      openai: SETTINGS,
      fetchImpl: fakeFetch([], () => ({ status: 500, body: {} })),
    });
    await expect(m.start({ assetId: "anim", instruction: "x", engine: "openai" })).rejects.toMatchObject({
      status: 415,
    });
    await expect(
      m.start({ assetId: "medusa-ref-01", instruction: "x", engine: "dall-e" as never }),
    ).rejects.toMatchObject({ status: 400 });
  });
});
