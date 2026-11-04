import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseManifestText } from "../src/assets/manifestDoc.ts";
import {
  buildEditPrompt,
  checkInstruction,
  claudeArgs,
  keptAsset,
  nextVariant,
  OUTPUT_FILE,
  parseStreamLine,
  readPngInfo,
  rootAssetId,
  showInStudio,
} from "../src/edits/edit.ts";
import { EditManager, editOptionsFromEnv, type Runner } from "../src/edits/server/editsApi.ts";
import type { EditJob } from "../src/edits/types.ts";

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

describe("prompt and command line", () => {
  const asset = { id: "pegasus-ref-01", kind: "reference", notes: "Pegasus, side view" };
  it("names the files, the rules and the instruction", () => {
    const p = buildEditPrompt({
      inputFile: "input.jpg",
      instructions: ["Remove the background"],
      asset,
      cacheDir: "/cache/tp",
    });
    expect(p).toContain("./input.jpg");
    expect(p).toContain(`./${OUTPUT_FILE}`);
    expect(p).toContain("Remove the background");
    expect(p).toContain("/cache/tp/venv");
    expect(p).toMatch(/Never upload/);
    expect(p).not.toContain("already been edited");
    expect(p).not.toMatch(/\n\n\n/);
  });
  it("mentions earlier steps of a chain", () => {
    const p = buildEditPrompt({
      inputFile: "input.png",
      instructions: ["Remove the background", "Mirror it"],
      asset,
      cacheDir: "/c",
    });
    expect(p).toContain('already been edited with these instructions, in order: "Remove the background"');
    expect(p.split("<<<")[1]).toContain("Mirror it");
  });
  it("allows local tools and no web tools", () => {
    const args = claudeArgs("/c", "opus");
    expect(args[0]).toBe("-p");
    expect(args).toContain("stream-json");
    expect(args.slice(args.indexOf("--add-dir"), args.indexOf("--add-dir") + 2)).toEqual(["--add-dir", "/c"]);
    expect(args.slice(args.indexOf("--model"), args.indexOf("--model") + 2)).toEqual(["--model", "opus"]);
    expect(args.slice(args.indexOf("--disallowedTools") + 1)).toEqual(["WebFetch", "WebSearch"]);
    expect(claudeArgs("/c")).not.toContain("--model");
  });
  it("checks the instruction", () => {
    expect(checkInstruction("  mirror  ")).toEqual({ ok: true, text: "mirror" });
    expect(checkInstruction("   ").ok).toBe(false);
    expect(checkInstruction(42).ok).toBe(false);
    expect(checkInstruction("x".repeat(2001)).ok).toBe(false);
  });
  it("reads options from the environment", () => {
    const o = editOptionsFromEnv({ TATTOO_CLAUDE_BIN: "/opt/claude", TATTOO_EDIT_MODEL: "sonnet" });
    expect(o.bin).toBe("/opt/claude");
    expect(o.model).toBe("sonnet");
    expect(o.cacheDir).toBe(path.join(os.homedir(), ".cache", "tattoo-planner"));
    expect(editOptionsFromEnv({ TATTOO_EDIT_CACHE: "~/x" }).cacheDir).toBe(path.join(os.homedir(), "x"));
    expect(editOptionsFromEnv({}).bin).toBe("claude");
  });
});

describe("parseStreamLine", () => {
  it("turns assistant text and tool calls into log lines", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "Looking at the\nimage." },
          {
            type: "tool_use",
            name: "Bash",
            input: { command: "python3 cut.py", description: "Remove background" },
          },
          { type: "tool_use", name: "Read", input: { file_path: "/tmp/x/output.png" } },
        ],
      },
    });
    expect(parseStreamLine(line)).toEqual({
      kind: "log",
      lines: ["Looking at the image.", "→ Bash: Remove background", "→ Read: output.png"],
    });
  });
  it("reads the result and ignores the rest", () => {
    expect(
      parseStreamLine(
        JSON.stringify({ type: "result", subtype: "success", is_error: false, result: " Done. " }),
      ),
    ).toEqual({ kind: "result", ok: true, text: "Done." });
    expect(
      parseStreamLine(JSON.stringify({ type: "result", subtype: "error_max_turns", is_error: true })),
    ).toEqual({
      kind: "result",
      ok: false,
      text: "error_max_turns",
    });
    expect(parseStreamLine(JSON.stringify({ type: "system", subtype: "init" }))).toEqual({ kind: "none" });
    expect(parseStreamLine("")).toEqual({ kind: "none" });
    expect(parseStreamLine("plain text")).toEqual({ kind: "log", lines: ["plain text"] });
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
    const a = keptAsset(original, v, ["Remove the background", "Mirror"], true);
    expect(a).toEqual({
      ...v,
      kind: "reference",
      derived_from: "pegasus-ref-01",
      source: "Pinterest",
      notes: 'Edited with claude -p: "Remove the background", then "Mirror"',
      tags: ["pegasus", "edited"],
      crop: original.crop,
    });
    expect(keptAsset(original, v, ["x"], false).crop).toBeUndefined();
  });
});

describe("EditManager", () => {
  let dir: string;
  let cache: string;
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
    cache = await mkdtemp(path.join(os.tmpdir(), "tp-cache-"));
    await mkdir(path.join(dir, "refs"));
    await writeFile(path.join(dir, "refs", "pegasus.png"), png(100, 50, 2));
    await writeFile(path.join(dir, "manifest.yaml"), MANIFEST);
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    await rm(cache, { recursive: true, force: true });
  });

  const enabled = async () => ({ enabled: true as const, claude: "test" });

  /** A runner that behaves like Claude: logs, writes output.png, reports a result. */
  const fakeClaude =
    (write: Buffer | null, seen: { stdin?: string; files?: string[] } = {}): Runner =>
    async ({ cwd, stdin, onLine }) => {
      seen.stdin = stdin;
      seen.files = await readdir(cwd);
      onLine(
        JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "Working" }] } }),
      );
      if (write) await writeFile(path.join(cwd, OUTPUT_FILE), write);
      onLine(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "Removed it." }));
      return { code: 0, stderr: "" };
    };

  async function finished(m: EditManager, id: string): Promise<EditJob> {
    for (let i = 0; i < 100; i++) {
      const j = m.get(id);
      if (j.state !== "running") return j;
      await new Promise((r) => setTimeout(r, 5));
    }
    throw new Error("job did not finish");
  }

  it("is disabled without a data folder", async () => {
    const m = new EditManager(null, { bin: "claude", cacheDir: cache, checkClaude: enabled });
    expect((await m.availability()).enabled).toBe(false);
    await expect(m.start({ assetId: "x", instruction: "y" })).rejects.toMatchObject({ status: 409 });
  });

  it("edits a copy, keeps the result as a new asset and leaves the original alone", async () => {
    const seen: { stdin?: string; files?: string[] } = {};
    const m = new EditManager(dir, {
      bin: "claude",
      cacheDir: cache,
      checkClaude: enabled,
      runner: fakeClaude(png(100, 50), seen),
    });
    const started = await m.start({ assetId: "pegasus-ref-01", instruction: "Remove the background" });
    const job = await finished(m, started.id);
    expect(job.state).toBe("done");
    expect(job.summary).toBe("Removed it.");
    expect(job.log).toEqual(["Working"]);
    expect(job.output).toEqual({ width: 100, height: 50, bytes: expect.any(Number), alpha: true });
    expect(seen.files).toEqual(["input.png"]);
    expect(seen.stdin).toContain("Remove the background");

    const kept = await m.keep(job.id);
    expect(kept.state).toBe("kept");
    expect(kept.kept).toEqual({ id: "pegasus-ref-01-edit-1", file: "edits/pegasus-ref-01-edit-1.png" });
    expect(await readdir(path.join(dir, "edits"))).toEqual(["pegasus-ref-01-edit-1.png"]);
    expect(await readFile(path.join(dir, "refs", "pegasus.png"))).toEqual(png(100, 50, 2));
    const text = await readFile(path.join(dir, "manifest.yaml"), "utf8");
    expect(text.startsWith(MANIFEST.trimEnd())).toBe(true);
    expect(text).toContain("# hand comment");
    const entries = parseManifestText(text).toJS().assets as {
      id: string;
      derived_from?: string;
      tags: string[];
    }[];
    expect(entries[1]).toMatchObject({
      id: "pegasus-ref-01-edit-1",
      derived_from: "pegasus-ref-01",
      tags: ["pegasus", "edited"],
    });

    // A second edit, chained on the first result, gets the next number and both instructions.
    const next = await m.start({ fromJob: job.id, instruction: "Mirror" });
    expect(next.instructions).toEqual(["Remove the background", "Mirror"]);
    expect((await finished(m, next.id)).state).toBe("done");
    expect((await m.keep(next.id)).kept?.id).toBe("pegasus-ref-01-edit-2");
    await expect(m.discard(job.id)).rejects.toMatchObject({ status: 409 });
    await m.close();
  });

  it("runs a session on its last version, saves the edit of an edit and closes cleanly", async () => {
    const m = new EditManager(dir, {
      bin: "claude",
      cacheDir: cache,
      checkClaude: enabled,
      runner: fakeClaude(png(100, 50)),
    });
    const s = await m.startSession({ mode: "edit", assetId: "pegasus-ref-01" });
    expect(await m.startSession({ mode: "edit", assetId: "pegasus-ref-01" })).toBe(s);
    expect((await m.overview()).sessions.map((x) => x.id)).toEqual([s.id]);

    // v0 → two attempts; the session ignores a stray assetId / fromJob.
    const a = await finished(m, (await m.start({ session: s.id, instruction: "One" })).id);
    const b = await finished(m, (await m.start({ session: s.id, assetId: "nope", instruction: "Two" })).id);
    expect(a.session).toBe(s.id);
    expect(b.fromJob).toBeUndefined();
    await expect(m.save(s.id, {})).rejects.toMatchObject({ status: 409 });
    expect(m.pick(s.id, { job: b.id }).versions).toEqual([b.id]);

    // The next run starts from v1 without naming it.
    const c = await finished(m, (await m.start({ session: s.id, instruction: "Three" })).id);
    expect(c.fromJob).toBe(b.id);
    expect(c.instructions).toEqual(["Two", "Three"]);
    expect(m.pick(s.id, { job: c.id }).versions).toEqual([b.id, c.id]);
    // Picking the other v0 attempt drops v1 and v2.
    expect(m.pick(s.id, { job: a.id }).versions).toEqual([a.id]);
    expect(m.truncate(s.id, { length: 0 }).versions).toEqual([]);
    m.pick(s.id, { job: b.id });
    m.pick(s.id, { job: c.id });

    const saved = await m.save(s.id, {});
    expect(saved.kept?.id).toBe("pegasus-ref-01-edit-1");
    expect(await m.closeSession(s.id)).toEqual({ closed: s.id });
    expect((await m.overview()).sessions).toEqual([]);
    expect(m.list().map((j) => j.id)).toEqual([c.id]);
    expect(() => m.file(a.id, "input")).toThrow();

    // A new session on the saved edit: its own source, entry built from it, derived_from the original.
    const s2 = await m.startSession({ mode: "edit", assetId: "pegasus-ref-01-edit-1" });
    expect(s2.id).not.toBe(s.id);
    const d = await finished(m, (await m.start({ session: s2.id, instruction: "Four" })).id);
    expect(d.instructions).toEqual(["Four"]);
    m.pick(s2.id, { job: d.id });
    expect((await m.save(s2.id, {})).kept?.id).toBe("pegasus-ref-01-edit-2");
    const entries = parseManifestText(await readFile(path.join(dir, "manifest.yaml"), "utf8")).toJS()
      .assets as { id: string; derived_from?: string; notes?: string; tags: string[] }[];
    expect(entries[2]).toMatchObject({
      id: "pegasus-ref-01-edit-2",
      derived_from: "pegasus-ref-01",
      tags: ["pegasus", "edited"],
    });
    expect(entries[2]!.notes).toMatch(/^From pegasus-ref-01-edit-1\. Edited with claude -p: "Four"$/);
    expect(() => m.pick("s999-x", { job: d.id })).toThrow(/no open session/);
    await m.close();
  });

  it("fails when Claude writes no PNG, and discards cleanly", async () => {
    const m = new EditManager(dir, {
      bin: "claude",
      cacheDir: cache,
      checkClaude: enabled,
      runner: fakeClaude(Buffer.from("not a png at all, but long enough to be read")),
    });
    const job = await finished(m, (await m.start({ assetId: "pegasus-ref-01", instruction: "x" })).id);
    expect(job.state).toBe("failed");
    expect(job.error).toContain("not a PNG");
    await expect(m.keep(job.id)).rejects.toMatchObject({ status: 409 });
    expect((await m.discard(job.id)).state).toBe("discarded");
    expect(m.list()).toEqual([]);
    expect(() => m.file(job.id, "input")).toThrow();
  });

  it("stops a running job", async () => {
    const runner: Runner = ({ signal }) =>
      new Promise((resolve) => signal.addEventListener("abort", () => resolve({ code: null, stderr: "" })));
    const m = new EditManager(dir, { bin: "claude", cacheDir: cache, checkClaude: enabled, runner });
    const job = await m.start({ assetId: "pegasus-ref-01", instruction: "x" });
    m.cancel(job.id);
    expect((await finished(m, job.id)).state).toBe("cancelled");
  });

  it("refuses unknown assets and empty instructions", async () => {
    const m = new EditManager(dir, {
      bin: "claude",
      cacheDir: cache,
      checkClaude: enabled,
      runner: fakeClaude(null),
    });
    await expect(m.start({ assetId: "nope", instruction: "x" })).rejects.toMatchObject({ status: 404 });
    await expect(m.start({ assetId: "pegasus-ref-01", instruction: " " })).rejects.toMatchObject({
      status: 400,
    });
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
});
