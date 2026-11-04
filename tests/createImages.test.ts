import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseManifestText } from "../src/assets/manifestDoc.ts";
import { createdAsset, nextVariant, OUTPUT_FILE, slugName } from "../src/edits/edit.ts";
import {
  buildCreatePrompt,
  buildEditForm,
  buildGenerationBody,
  buildGenerativePrompt,
  type OpenAISettings,
} from "../src/edits/openai.ts";
import { EditManager, type Runner } from "../src/edits/server/editsApi.ts";
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

describe("rules for new images", () => {
  it("turns a name into a manifest id", () => {
    expect(slugName("Rotes Dreieck, groß")).toBe("rotes-dreieck-gross");
    expect(slugName("  Ornament Ärmel #2 ")).toBe("ornament-armel-2");
    expect(slugName("")).toBe("generated");
    expect(slugName(undefined)).toBe("generated");
    expect(slugName("---")).toBe("generated");
    expect(slugName("a".repeat(60))).toHaveLength(40);
  });

  it("names kept new images <name>-N in generated/", () => {
    expect(nextVariant("dreieck", new Set(["dreieck-1"]), new Set(), "created")).toEqual({
      id: "dreieck-2",
      file: "generated/dreieck-2.png",
    });
  });

  it("writes kind, tag, prompts and references into the manifest entry", () => {
    expect(
      createdAsset(
        { id: "dreieck-1", file: "generated/dreieck-1.png" },
        ["Rotes Dreieck", "Remove the background"],
        ["gpt-image-2.5-sunburst", "claude -p"],
        ["skull-ref-01"],
      ),
    ).toEqual({
      id: "dreieck-1",
      file: "generated/dreieck-1.png",
      kind: "idea",
      notes:
        'Generated: "Rotes Dreieck" (gpt-image-2.5-sunburst), then "Remove the background" (claude -p); references: skull-ref-01',
      tags: ["generated"],
    });
  });

  it("names the references in the prompts", () => {
    const refs = [{ id: "triangle-ref", notes: "red triangle frame" }];
    const create = buildCreatePrompt("Ein rotes Dreieck um einen Totenkopf", refs);
    expect(create).toContain('Image 1: reference "triangle-ref" (red triangle frame)');
    expect(create).toContain("Ein rotes Dreieck um einen Totenkopf");
    expect(buildCreatePrompt("x", [])).not.toContain("reference");
    const edit = buildGenerativePrompt({
      instructions: ["Mache ein rotes Dreieck drumherum wie im Referenzbild"],
      asset: { id: "medusa-ref-01", kind: "reference" },
      references: refs,
    });
    expect(edit).toContain("Edit the first image");
    expect(edit).toContain('Image 2: reference "triangle-ref"');
  });

  it("sends several images as image[] and text-only requests as JSON", () => {
    const form = buildEditForm({
      images: [
        { bytes: png(2, 2), fileName: "input.png", mimeType: "image/png" },
        { bytes: png(3, 3), fileName: "ref-1.jpg", mimeType: "image/jpeg" },
      ],
      prompt: "p",
      settings: SETTINGS,
      size: "1024x1536",
      background: "transparent",
    });
    expect(form.has("image")).toBe(false);
    expect((form.getAll("image[]") as File[]).map((f) => f.name)).toEqual(["input.png", "ref-1.jpg"]);
    expect(form.get("size")).toBe("1024x1536");
    expect(form.get("background")).toBe("transparent");
    expect(
      buildGenerationBody({ prompt: "p", settings: SETTINGS, size: "1024x1024", background: "auto" }),
    ).toEqual({
      model: "gpt-image-2.5-sunburst",
      prompt: "p",
      n: 1,
      size: "1024x1024",
      quality: "high",
      output_format: "png",
    });
  });
});

describe("EditManager: new images and references", () => {
  let dir: string;
  let cache: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "tp-create-"));
    cache = await mkdtemp(path.join(os.tmpdir(), "tp-create-cache-"));
    await mkdir(path.join(dir, "refs"));
    await writeFile(path.join(dir, "refs", "medusa.png"), png(100, 50, 2));
    await writeFile(path.join(dir, "refs", "triangle.jpg"), png(20, 20));
    await writeFile(
      path.join(dir, "manifest.yaml"),
      `version: 1
assets:
  - id: medusa-ref-01
    file: refs/medusa.png
    kind: reference
    tags: [medusa]
  - id: triangle-ref
    file: refs/triangle.jpg
    kind: reference
    notes: red triangle frame
    tags: []
`,
    );
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    await rm(cache, { recursive: true, force: true });
  });

  type Call = { url: string; body: FormData | string; type: string | null };
  function manager(calls: Call[]): EditManager {
    const answer = png(64, 64).toString("base64");
    return new EditManager(dir, {
      bin: "claude",
      cacheDir: cache,
      checkClaude: async () => ({ enabled: true, claude: "test" }),
      openai: SETTINGS,
      fetchImpl: (async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({
          url: String(url),
          body: init?.body as FormData | string,
          type: new Headers(init?.headers).get("content-type"),
        });
        return new Response(JSON.stringify({ data: [{ b64_json: answer }] }), { status: 200 });
      }) as typeof fetch,
      runner: (async ({ cwd }) => {
        await writeFile(path.join(cwd, OUTPUT_FILE), png(64, 64));
        return { code: 0, stderr: "" };
      }) as Runner,
    });
  }

  async function finished(m: EditManager, id: string): Promise<EditJob> {
    for (let i = 0; i < 100; i++) {
      const j = m.get(id);
      if (j.state !== "running") return j;
      await new Promise((r) => setTimeout(r, 5));
    }
    throw new Error("job did not finish");
  }

  it("creates from text alone via /generations and keeps it in generated/", async () => {
    const calls: Call[] = [];
    const m = manager(calls);
    const started = await m.start({
      mode: "create",
      instruction: "Ein geometrisches Mandala",
      name: "Mandala",
      size: "1024x1536",
      background: "opaque",
    });
    expect(started).toMatchObject({ engine: "openai", created: { name: "mandala" }, assetId: "mandala" });
    const job = await finished(m, started.id);
    expect(job.state).toBe("done");
    expect(calls[0]!.url).toBe("https://api.openai.com/v1/images/generations");
    expect(calls[0]!.type).toBe("application/json");
    expect(JSON.parse(calls[0]!.body as string)).toMatchObject({
      size: "1024x1536",
      background: "opaque",
      model: "gpt-image-2.5-sunburst",
    });
    expect(() => m.file(job.id, "input")).toThrow();

    // Edit further locally, then keep: the chain stays a new image.
    const next = await m.start({ fromJob: job.id, instruction: "Remove the background" });
    expect(next.created).toEqual({ name: "mandala" });
    await finished(m, next.id);
    expect((await m.keep(next.id)).kept).toEqual({ id: "mandala-1", file: "generated/mandala-1.png" });
    expect(await readdir(path.join(dir, "generated"))).toEqual(["mandala-1.png"]);
    const entries = parseManifestText(await readFile(path.join(dir, "manifest.yaml"), "utf8")).toJS()
      .assets as { id: string; kind: string; derived_from?: string; tags: string[] }[];
    expect(entries[2]).toMatchObject({ id: "mandala-1", kind: "idea", tags: ["generated"] });
    expect(entries[2]!.derived_from).toBeUndefined();
    await m.close();
  });

  it("creates from reference images via /edits", async () => {
    const calls: Call[] = [];
    const m = manager(calls);
    const job = await finished(
      m,
      (
        await m.start({
          mode: "create",
          instruction: "Wie das Dreieck, aber blau",
          references: ["triangle-ref"],
        })
      ).id,
    );
    expect(job).toMatchObject({
      state: "done",
      references: ["triangle-ref"],
      created: { name: "generated" },
    });
    const form = calls[0]!.body as FormData;
    expect(calls[0]!.url).toBe("https://api.openai.com/v1/images/edits");
    expect((form.get("image") as File).name).toBe("ref-1.jpg");
    expect(String(form.get("prompt"))).toContain('reference "triangle-ref" (red triangle frame)');
    await m.close();
  });

  it("edits an image with a reference: the image first, then the reference", async () => {
    const calls: Call[] = [];
    const m = manager(calls);
    const job = await finished(
      m,
      (
        await m.start({
          assetId: "medusa-ref-01",
          engine: "openai",
          instruction: "Mache ein rotes Dreieck drumherum wie in diesem Referenzbild",
          references: ["triangle-ref"],
        })
      ).id,
    );
    expect(job.state).toBe("done");
    const files = (calls[0]!.body as FormData).getAll("image[]") as File[];
    expect(files.map((f) => [f.name, f.type])).toEqual([
      ["input.png", "image/png"],
      ["ref-1.jpg", "image/jpeg"],
    ]);
    // Kept as an edit of the original, with the reference in the job.
    expect((await m.keep(job.id)).kept?.id).toBe("medusa-ref-01-edit-1");
    await m.close();
  });

  it("refuses references and new images without GPT Image, and unknown references", async () => {
    const m = manager([]);
    await expect(
      m.start({ assetId: "medusa-ref-01", instruction: "x", references: ["triangle-ref"] }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(m.start({ mode: "create", engine: "claude", instruction: "x" })).rejects.toMatchObject({
      status: 400,
    });
    await expect(m.start({ mode: "create", instruction: "x", references: ["nope"] })).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      m.start({ mode: "create", instruction: "x", size: "999x999" as never }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      m.start({ mode: "create", instruction: "x", references: ["a", "b", "c", "d", "e"] }),
    ).rejects.toMatchObject({ status: 400 });
  });
});
