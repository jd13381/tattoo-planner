// Dev-server endpoint that edits reference images, either with `claude -p` and local tools on Jan's
// Mac (ADR 0007) or generatively with the OpenAI Images API (ADR 0008).
//   GET  /api/edits                     → EditOverview: can edits run, and every job of this server run
//   POST /api/edits                     body EditRequest → EditJob (starts it; engine claude | openai;
//                                       mode edit | create, optional reference assets for GPT Image)
//   GET  /api/edits/jobs/<id>           → EditJob
//   GET  /api/edits/jobs/<id>/input     the image the job edits
//   GET  /api/edits/jobs/<id>/output    the result (when done)
//   POST /api/edits/jobs/<id>/keep      writes edits/<root>-edit-N.png and a manifest entry → EditJob
//   POST /api/edits/jobs/<id>/discard   stops the job if needed and deletes its working folder
//   POST /api/edits/jobs/<id>/cancel    stops a running job
// Each job works on a copy of the image in its own temp folder; originals are never touched. The data
// folder only changes on "keep", and then only by a new file in edits/ (or generated/ for new images)
// plus one appended manifest entry.
import { execFile, spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import type { Plugin } from "vite";
import { MANIFEST_FILE, type Asset } from "../../assets/manifest.ts";
import { mergeManifest } from "../../assets/manifestDoc.ts";
import { imageContentType, isInside, listAssets, resolveInside } from "../../data/server/assetsApi.ts";
import { HttpError, isCrossSite, readRawBody } from "../../export/server/exportsApi.ts";
import {
  buildEditPrompt,
  checkInstruction,
  CLAUDE_TOOL,
  claudeArgs,
  createdAsset,
  EDIT_TIMEOUT_MS,
  INPUT_BASENAME,
  keptAsset,
  MAX_OUTPUT_BYTES,
  MAX_RUNNING,
  nextVariant,
  OUTPUT_FILE,
  parseStreamLine,
  readPngInfo,
  slugName,
} from "../edit.ts";
import {
  buildCreatePrompt,
  buildEditForm,
  buildGenerationBody,
  buildGenerativePrompt,
  estimateCostUsd,
  MAX_OPENAI_INPUT_BYTES,
  MAX_REFERENCES,
  MAX_RUNNING_OPENAI,
  OPENAI_EDITS_URL,
  OPENAI_GENERATIONS_URL,
  openaiInputType,
  openaiSettingsFromEnv,
  parseEditResponse,
  rejectsInputFidelity,
  type FormImage,
  type OpenAISettings,
  type PromptReference,
} from "../openai.ts";
import {
  CREATE_BACKGROUNDS,
  CREATE_SIZES,
  EDITS_ENDPOINT,
  EDITS_FOLDER,
  GENERATED_FOLDER,
  GENERATED_KIND,
  GENERATED_TAG,
  type CreateBackground,
  type CreateSize,
  type EditAvailability,
  type EditEngine,
  type EditJob,
  type EditOverview,
  type EditRequest,
  type GenerativeAvailability,
} from "../types.ts";

const MAX_LOG_LINES = 400;

export type RunOptions = {
  cwd: string;
  args: string[];
  stdin: string;
  signal: AbortSignal;
  onLine: (line: string) => void;
};
/** Runs Claude; resolves with the exit code and the end of stderr. Replaceable in tests. */
export type Runner = (opts: RunOptions) => Promise<{ code: number | null; stderr: string }>;

export function spawnRunner(bin: string): Runner {
  return ({ cwd, args, stdin, signal, onLine }) =>
    new Promise((resolve, reject) => {
      const child = spawn(bin, args, { cwd, signal, stdio: ["pipe", "pipe", "pipe"], env: process.env });
      let stderr = "";
      child.stderr.on("data", (d: Buffer) => {
        stderr = (stderr + d.toString("utf8")).slice(-4000);
      });
      createInterface({ input: child.stdout }).on("line", onLine);
      child.on("error", (e: NodeJS.ErrnoException) => {
        if (e.name === "AbortError") return;
        reject(e.code === "ENOENT" ? new Error(`${bin} not found on PATH`) : e);
      });
      child.on("close", (code) => resolve({ code, stderr }));
      child.stdin.end(stdin);
    });
}

type Reference = { path: string; fileName: string; mimeType: string; prompt: PromptReference };

type Job = {
  info: EditJob;
  asset: Asset;
  dir: string;
  /** Empty for a new image (mode "create" without fromJob): there is no input. */
  inputPath: string;
  /** Reference images sent with a GPT Image request (copies in the working folder). */
  refs: Reference[];
  /** Mode "create" without fromJob: output size and background. */
  create?: { size: CreateSize; background: CreateBackground };
  /** Result file in the working folder. */
  outputPath?: string;
  abort: AbortController;
};

export type EditOptions = {
  bin: string;
  cacheDir: string;
  model?: string;
  runner?: Runner;
  timeoutMs?: number;
  /** Override for the availability check (tests). */
  checkClaude?: () => Promise<EditAvailability>;
  /** Generative edits; null or missing when no OpenAI key is set. */
  openai?: OpenAISettings | null;
  /** Replaceable in tests. */
  fetchImpl?: typeof fetch;
};

function checkClaudeBinary(bin: string): Promise<EditAvailability> {
  return new Promise((resolve) => {
    execFile(bin, ["--version"], { timeout: 15_000 }, (err, stdout) => {
      if (err)
        resolve({
          enabled: false,
          reason:
            (err as NodeJS.ErrnoException).code === "ENOENT"
              ? `Claude Code (${bin}) is not on the PATH of npm run dev. Install it or set TATTOO_CLAUDE_BIN in .env.`
              : `${bin} --version failed: ${err.message}`,
        });
      else resolve({ enabled: true, claude: stdout.trim() || bin });
    });
  });
}

export class EditManager {
  private readonly jobs = new Map<string, Job>();
  private readonly runner: Runner;
  private counter = 0;
  private claudeCheck: { at: number; result: Promise<EditAvailability> } | null = null;
  private manifestLock: Promise<unknown> = Promise.resolve();

  private readonly dataDir: string | null;
  private readonly opts: EditOptions;

  constructor(dataDir: string | null, opts: EditOptions) {
    this.dataDir = dataDir;
    this.opts = opts;
    this.runner = opts.runner ?? spawnRunner(opts.bin);
  }

  /** Null when the data folder is usable, else why not. */
  private async dataFolderProblem(): Promise<string | null> {
    if (!this.dataDir) return "TATTOO_DATA_DIR is not set, so there are no images to edit.";
    try {
      if (!(await stat(this.dataDir)).isDirectory()) throw new Error();
    } catch {
      return `data folder not found: ${this.dataDir}`;
    }
    return null;
  }

  async generativeAvailability(): Promise<GenerativeAvailability> {
    const problem = await this.dataFolderProblem();
    if (problem) return { enabled: false, reason: problem };
    if (!this.opts.openai)
      return {
        enabled: false,
        reason: "No OpenAI API key: set TATTOO_OPENAI_API_KEY in .env and restart npm run dev.",
      };
    return { enabled: true, model: this.opts.openai.model };
  }

  async availability(): Promise<EditAvailability> {
    const problem = await this.dataFolderProblem();
    if (problem) return { enabled: false, reason: problem };
    // `claude --version` takes a moment; check at most once a minute.
    const now = Date.now();
    if (!this.claudeCheck || now - this.claudeCheck.at > 60_000)
      this.claudeCheck = {
        at: now,
        result: (this.opts.checkClaude ?? (() => checkClaudeBinary(this.opts.bin)))(),
      };
    return this.claudeCheck.result;
  }

  async overview(): Promise<EditOverview> {
    const [availability, generative] = await Promise.all([
      this.availability(),
      this.generativeAvailability(),
    ]);
    return { availability, generative, jobs: this.list() };
  }

  list(): EditJob[] {
    return [...this.jobs.values()].map((j) => j.info).filter((j) => j.state !== "discarded");
  }

  get(id: string): EditJob {
    return this.job(id).info;
  }

  private job(id: string): Job {
    const job = this.jobs.get(id);
    if (!job) throw new HttpError(404, `unknown edit ${id}`);
    return job;
  }

  /** Path of a job's input or output image, for previews. */
  file(id: string, which: "input" | "output"): string {
    const job = this.job(id);
    const p = which === "input" ? job.inputPath : job.outputPath;
    if (!p || job.info.state === "discarded") throw new HttpError(404, `no ${which} for ${id}`);
    return p;
  }

  async start(body: unknown): Promise<EditJob> {
    const req = (body ?? {}) as Partial<EditRequest>;
    if (req.engine !== undefined && req.engine !== "claude" && req.engine !== "openai")
      throw new HttpError(400, `unknown engine ${String(req.engine)}`);
    if (req.mode !== undefined && req.mode !== "edit" && req.mode !== "create")
      throw new HttpError(400, `unknown mode ${String(req.mode)}`);
    // A new image needs GPT Image; with fromJob, "create" means editing the created result further.
    const creating = req.mode === "create" && req.fromJob === undefined;
    if (creating && req.engine === "claude")
      throw new HttpError(400, "new images are made with GPT Image, not with claude -p");
    const engine: EditEngine = req.engine ?? (creating ? "openai" : "claude");
    const refIds = req.references ?? [];
    if (!Array.isArray(refIds) || refIds.some((r) => typeof r !== "string"))
      throw new HttpError(400, "references must be a list of asset ids");
    if (refIds.length > 0 && engine !== "openai")
      throw new HttpError(400, "reference images only work with GPT Image");
    if (refIds.length > MAX_REFERENCES)
      throw new HttpError(400, `at most ${MAX_REFERENCES} reference images`);
    const size = req.size ?? "1024x1024";
    const background = req.background ?? "transparent";
    if (!CREATE_SIZES.some((o) => o.value === size)) throw new HttpError(400, `unknown size ${String(size)}`);
    if (!CREATE_BACKGROUNDS.some((o) => o.value === background))
      throw new HttpError(400, `unknown background ${String(background)}`);
    const availability =
      engine === "openai" ? await this.generativeAvailability() : await this.availability();
    if (!availability.enabled) throw new HttpError(409, availability.reason);
    const instruction = checkInstruction(req.instruction);
    if (!instruction.ok) throw new HttpError(400, instruction.message);
    const limit = engine === "openai" ? MAX_RUNNING_OPENAI : MAX_RUNNING;
    const running = [...this.jobs.values()].filter(
      (j) => j.info.state === "running" && j.info.engine === engine,
    );
    if (running.length >= limit)
      throw new HttpError(429, `${limit} edits of this kind are running already; wait for one to finish`);

    let asset: Asset;
    let source: string | null;
    let earlier: string[] = [];
    let earlierTools: string[] = [];
    let earlierRefs: string[] = [];
    let created: { name: string } | undefined;
    if (creating) {
      const name = slugName(req.name);
      created = { name };
      asset = { id: name, file: "", kind: GENERATED_KIND, tags: [GENERATED_TAG] };
      source = null;
    } else if (req.fromJob !== undefined) {
      const prev = this.job(String(req.fromJob));
      if (!prev.outputPath || (prev.info.state !== "done" && prev.info.state !== "kept"))
        throw new HttpError(409, "that edit has no result to work on");
      asset = prev.asset;
      source = prev.outputPath;
      earlier = prev.info.instructions;
      earlierTools = prev.info.tools;
      earlierRefs = prev.info.references ?? [];
      created = prev.info.created;
    } else {
      if (typeof req.assetId !== "string") throw new HttpError(400, "assetId missing");
      const listing = await listAssets(this.dataDir);
      if (listing.status !== "ok") throw new HttpError(409, "cannot read the manifest");
      const found = listing.assets.find((a) => a.id === req.assetId);
      if (!found) throw new HttpError(404, `unknown asset ${req.assetId}`);
      const { exists, ...plain } = found;
      void exists;
      asset = plain;
      if (!imageContentType(asset.file).ok)
        throw new HttpError(415, `${asset.file} is not an image the planner reads`);
      const resolved = await resolveInside(this.dataDir!, asset.file);
      if (!resolved.ok) throw new HttpError(404, `${asset.file}: ${resolved.message}`);
      source = resolved.path;
    }

    const references = await this.resolveReferences(refIds);
    const ext = source ? path.extname(source).toLowerCase() || ".png" : ".png";
    if (engine === "openai" && source) {
      if (!openaiInputType(`x${ext}`))
        throw new HttpError(
          415,
          `GPT Image takes PNG, JPEG or WebP, not ${ext}; convert it with a local edit first`,
        );
      if ((await stat(source)).size > MAX_OPENAI_INPUT_BYTES)
        throw new HttpError(413, "the image is larger than 50 MB, which GPT Image does not take");
    }
    const dir = await mkdtemp(path.join(os.tmpdir(), "tattoo-edit-"));
    const inputFile = `${INPUT_BASENAME}${ext}`;
    const inputPath = source ? path.join(dir, inputFile) : "";
    if (source) await copyFile(source, inputPath);
    // Copies of the references, so a manifest change during the request cannot swap them.
    const refs: Reference[] = [];
    for (const [i, r] of references.entries()) {
      const fileName = `ref-${i + 1}${path.extname(r.path).toLowerCase()}`;
      await copyFile(r.path, path.join(dir, fileName));
      refs.push({ ...r, path: path.join(dir, fileName), fileName });
    }
    await mkdir(this.opts.cacheDir, { recursive: true });

    const id = `e${++this.counter}-${Date.now().toString(36)}`;
    const info: EditJob = {
      id,
      assetId: asset.derived_from ?? asset.id,
      ...(req.fromJob !== undefined ? { fromJob: String(req.fromJob) } : {}),
      ...(created ? { created } : {}),
      ...(earlierRefs.length + refIds.length > 0
        ? { references: [...new Set([...earlierRefs, ...refIds])] }
        : {}),
      engine,
      instructions: [...earlier, instruction.text],
      tools: [
        ...earlier.map((_, i) => earlierTools[i] ?? CLAUDE_TOOL),
        engine === "openai" ? this.opts.openai!.model : CLAUDE_TOOL,
      ],
      state: "running",
      startedAt: new Date().toISOString(),
      log: [],
    };
    const job: Job = {
      info,
      asset,
      dir,
      inputPath,
      refs,
      ...(creating ? { create: { size, background } } : {}),
      abort: new AbortController(),
    };
    this.jobs.set(id, job);
    if (engine === "openai") {
      void this.runOpenAI(job, inputFile);
      return info;
    }
    const prompt = buildEditPrompt({
      inputFile,
      instructions: info.instructions,
      asset,
      cacheDir: this.opts.cacheDir,
    });
    void this.run(job, prompt);
    return info;
  }

  /** Manifest assets to send as reference images: their file, type and notes. */
  private async resolveReferences(ids: readonly string[]): Promise<Omit<Reference, "fileName">[]> {
    if (ids.length === 0) return [];
    const listing = await listAssets(this.dataDir);
    if (listing.status !== "ok") throw new HttpError(409, "cannot read the manifest");
    const out: Omit<Reference, "fileName">[] = [];
    for (const id of new Set(ids)) {
      const a = listing.assets.find((x) => x.id === id);
      if (!a) throw new HttpError(404, `unknown reference ${id}`);
      const mimeType = openaiInputType(a.file);
      if (!mimeType) throw new HttpError(415, `reference ${id}: GPT Image takes PNG, JPEG or WebP only`);
      const resolved = await resolveInside(this.dataDir!, a.file);
      if (!resolved.ok) throw new HttpError(404, `reference ${id}: ${resolved.message}`);
      if ((await stat(resolved.path)).size > MAX_OPENAI_INPUT_BYTES)
        throw new HttpError(413, `reference ${id} is larger than 50 MB`);
      out.push({
        path: resolved.path,
        mimeType,
        prompt: { id: a.id, ...(a.notes ? { notes: a.notes } : {}) },
      });
    }
    return out;
  }

  private log(job: Job, lines: string[]) {
    job.info.log.push(...lines);
    if (job.info.log.length > MAX_LOG_LINES) job.info.log.splice(0, job.info.log.length - MAX_LOG_LINES);
  }

  private async run(job: Job, prompt: string) {
    const timer = setTimeout(() => {
      this.log(job, ["Stopped: the edit took too long."]);
      job.abort.abort();
    }, this.opts.timeoutMs ?? EDIT_TIMEOUT_MS);
    let result: { ok: boolean; text: string } | null = null;
    let exit: { code: number | null; stderr: string } | null = null;
    let failure: string | null = null;
    try {
      exit = await this.runner({
        cwd: job.dir,
        args: claudeArgs(this.opts.cacheDir, this.opts.model),
        stdin: prompt,
        signal: job.abort.signal,
        onLine: (line) => {
          const ev = parseStreamLine(line);
          if (ev.kind === "log") this.log(job, ev.lines);
          else if (ev.kind === "result") result = { ok: ev.ok, text: ev.text };
        },
      });
    } catch (e) {
      failure = e instanceof Error ? e.message : String(e);
    } finally {
      clearTimeout(timer);
    }
    const info = job.info;
    info.finishedAt = new Date().toISOString();
    const final = result as { ok: boolean; text: string } | null;
    if (final?.text) info.summary = final.text;
    if (info.state === "discarded") return;
    if (job.abort.signal.aborted) {
      info.state = "cancelled";
      return;
    }
    if (failure) {
      info.state = "failed";
      info.error = failure;
      return;
    }
    const outputPath = path.join(job.dir, OUTPUT_FILE);
    let bytes: Buffer | null = null;
    try {
      bytes = await readFile(outputPath);
    } catch {
      // handled below
    }
    const png = bytes ? readPngInfo(bytes) : null;
    if (!bytes || !png || bytes.length > MAX_OUTPUT_BYTES) {
      info.state = "failed";
      const why = !bytes
        ? `Claude wrote no ${OUTPUT_FILE}`
        : !png
          ? `${OUTPUT_FILE} is not a PNG`
          : `${OUTPUT_FILE} is larger than ${MAX_OUTPUT_BYTES / 1024 / 1024} MB`;
      const detail =
        final && !final.ok
          ? final.text
          : exit && exit.code !== 0
            ? exit.stderr.trim().split("\n").at(-1)
            : "";
      info.error = detail ? `${why}: ${detail}` : `${why}.`;
      return;
    }
    job.outputPath = outputPath;
    info.output = { width: png.width, height: png.height, bytes: bytes.length, alpha: png.alpha };
    info.state = "done";
  }

  /** One generative edit: send the image and the instruction, write the answer as output.png. */
  private async runOpenAI(job: Job, inputFile: string) {
    const settings = this.opts.openai!;
    const doFetch = this.opts.fetchImpl ?? fetch;
    const timer = setTimeout(() => {
      this.log(job, ["Stopped: the edit took too long."]);
      job.abort.abort();
    }, this.opts.timeoutMs ?? EDIT_TIMEOUT_MS);
    const info = job.info;
    try {
      const images: FormImage[] = [];
      if (job.inputPath)
        images.push({
          bytes: await readFile(job.inputPath),
          fileName: inputFile,
          mimeType: openaiInputType(inputFile) ?? "image/png",
        });
      for (const r of job.refs)
        images.push({ bytes: await readFile(r.path), fileName: r.fileName, mimeType: r.mimeType });
      const refPrompts = job.refs.map((r) => r.prompt);
      const current = info.instructions.at(-1) ?? "";
      const prompt = job.create
        ? buildCreatePrompt(current, refPrompts)
        : buildGenerativePrompt({
            instructions: info.instructions,
            asset: job.asset,
            references: refPrompts,
          });
      const send = async (inputFidelity: OpenAISettings["inputFidelity"]) => {
        const what =
          images.length === 0
            ? "the description"
            : job.inputPath
              ? `the image${job.refs.length ? ` and ${job.refs.length} reference${job.refs.length > 1 ? "s" : ""}` : ""}`
              : `${job.refs.length} reference image${job.refs.length > 1 ? "s" : ""}`;
        this.log(job, [
          `→ Sending ${what} to ${settings.model}${images.length && inputFidelity ? ` (input fidelity ${inputFidelity})` : ""}…`,
        ]);
        // A new image from text alone goes to /generations; anything with images to /edits.
        const r =
          images.length === 0
            ? await doFetch(OPENAI_GENERATIONS_URL, {
                method: "POST",
                headers: { Authorization: `Bearer ${settings.apiKey}`, "Content-Type": "application/json" },
                body: JSON.stringify(
                  buildGenerationBody({
                    prompt,
                    settings,
                    size: job.create!.size,
                    background: job.create!.background,
                  }),
                ),
                signal: job.abort.signal,
              })
            : await doFetch(OPENAI_EDITS_URL, {
                method: "POST",
                headers: { Authorization: `Bearer ${settings.apiKey}` },
                body: buildEditForm({
                  images,
                  prompt,
                  settings: { ...settings, inputFidelity },
                  ...(job.create ? job.create : {}),
                }),
                signal: job.abort.signal,
              });
        return parseEditResponse(r.status, await r.json().catch(() => ({})));
      };
      let answer = await send(settings.inputFidelity);
      if (!answer.ok && settings.inputFidelity && rejectsInputFidelity(answer.message)) {
        this.log(job, ["The model does not take input_fidelity; trying again without it."]);
        answer = await send(null);
      }
      if (info.state === "discarded") return;
      if (!answer.ok) {
        info.state = "failed";
        info.error = answer.message;
        return;
      }
      const png = readPngInfo(answer.png);
      if (!png || answer.png.length > MAX_OUTPUT_BYTES) {
        info.state = "failed";
        info.error = "OpenAI returned something that is not a PNG.";
        return;
      }
      const outputPath = path.join(job.dir, OUTPUT_FILE);
      await writeFile(outputPath, answer.png);
      const cost = estimateCostUsd(answer.usage);
      if (cost !== null) info.costUsd = cost;
      this.log(job, [
        `Received ${png.width} × ${png.height} px${cost !== null ? `, about $${cost.toFixed(2)}` : ""}.`,
      ]);
      job.outputPath = outputPath;
      info.output = { width: png.width, height: png.height, bytes: answer.png.length, alpha: png.alpha };
      info.state = "done";
    } catch (e) {
      if (info.state === "discarded") return;
      if (job.abort.signal.aborted) info.state = "cancelled";
      else {
        info.state = "failed";
        const cause = e instanceof Error && e.cause instanceof Error ? e.cause.message : "";
        info.error =
          e instanceof TypeError && /fetch failed/i.test(e.message)
            ? `Cannot reach the OpenAI API${cause ? ` (${cause})` : ""}. Check the internet connection.`
            : e instanceof Error
              ? e.message
              : String(e);
      }
    } finally {
      clearTimeout(timer);
      info.finishedAt = new Date().toISOString();
    }
  }

  cancel(id: string): EditJob {
    const job = this.job(id);
    if (job.info.state === "running") job.abort.abort();
    return job.info;
  }

  async discard(id: string): Promise<EditJob> {
    const job = this.job(id);
    if (job.info.state === "kept")
      throw new HttpError(409, "a kept edit is in the manifest; remove it there");
    if (job.info.state === "running") job.abort.abort();
    job.info.state = "discarded";
    await rm(job.dir, { recursive: true, force: true });
    return job.info;
  }

  /** Writes the result into edits/ (or generated/) and appends its manifest entry; never overwrites. */
  keep(id: string): Promise<EditJob> {
    const run = this.manifestLock.then(() => this.keepNow(id));
    this.manifestLock = run.catch(() => undefined);
    return run;
  }

  private async keepNow(id: string): Promise<EditJob> {
    const job = this.job(id);
    if (job.info.state === "kept") return job.info;
    if (job.info.state !== "done" || !job.outputPath)
      throw new HttpError(409, "only a finished edit can be kept");
    const dataDir = this.dataDir;
    if (!dataDir) throw new HttpError(409, "TATTOO_DATA_DIR is not set");
    const root = await realpath(dataDir);
    const created = job.info.created;
    const folderName = created ? GENERATED_FOLDER : EDITS_FOLDER;
    const folder = path.join(root, folderName);
    await mkdir(folder, { recursive: true });
    const realFolder = await realpath(folder);
    if (!isInside(root, realFolder) || !(await stat(realFolder)).isDirectory())
      throw new HttpError(403, `${folderName}/ leads out of the data folder`);

    const manifestPath = path.join(root, MANIFEST_FILE);
    let manifestText: string | null = null;
    try {
      manifestText = await readFile(manifestPath, "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    const listing = await listAssets(dataDir);
    if (listing.status !== "ok") throw new HttpError(409, "cannot read the manifest");
    const takenIds = new Set(listing.assets.map((a) => a.id));
    const takenFiles = new Set([
      ...listing.assets.map((a) => a.file.toLowerCase()),
      ...(await readdir(realFolder)).map((f) => `${folderName}/${f}`.toLowerCase()),
    ]);
    const variant = created
      ? nextVariant(created.name, takenIds, takenFiles, "created")
      : nextVariant(job.info.assetId, takenIds, takenFiles);
    const original = created ? undefined : listing.assets.find((a) => a.id === job.info.assetId);
    let sameSize = false;
    if (original?.crop && job.info.output) {
      const orig = await resolveInside(dataDir, original.file);
      const png = orig.ok ? readPngInfo(await readFile(orig.path)) : null;
      sameSize = !!png && png.width === job.info.output.width && png.height === job.info.output.height;
    }
    const base = original ? { ...original } : job.asset;
    const entry = created
      ? createdAsset(variant, job.info.instructions, job.info.tools, job.info.references ?? [])
      : keptAsset(base, variant, job.info.instructions, sameSize, job.info.tools);
    const merged = mergeManifest(manifestText?.trim() ? manifestText : null, [entry]);
    if (!merged.added.includes(variant.id)) throw new HttpError(409, "the manifest refused the new entry");

    const target = path.join(realFolder, path.basename(variant.file));
    await writeFile(target, await readFile(job.outputPath), { flag: "wx" });
    try {
      const tmp = `${manifestPath}.tmp-${process.pid}`;
      await writeFile(tmp, merged.text, "utf8");
      await rename(tmp, manifestPath);
    } catch (e) {
      await rm(target, { force: true });
      throw e;
    }
    // The working folder stays until the server stops, so the before/after preview keeps working.
    job.info.state = "kept";
    job.info.kept = variant;
    return job.info;
  }

  /** Stops every job and removes the working folders (dev server shutdown). */
  async close(): Promise<void> {
    await Promise.all(
      [...this.jobs.values()].map(async (j) => {
        j.abort.abort();
        await rm(j.dir, { recursive: true, force: true });
      }),
    );
  }
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

async function sendImage(res: ServerResponse, file: string) {
  const type = imageContentType(file);
  if (!type.ok) return send(res, 415, { error: type.message });
  const s = await stat(file);
  res.statusCode = 200;
  res.setHeader("Content-Type", type.type);
  res.setHeader("Content-Length", String(s.size));
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  createReadStream(file).pipe(res);
}

/** Routes one request; exported for tests. */
export async function handleEditRequest(
  manager: EditManager,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const sub = ((req.url ?? "/").split("?")[0] ?? "/").replace(/^\/+/, "");
  if (req.method === "GET" && sub === "") return send(res, 200, await manager.overview());
  const m = /^jobs\/([a-z0-9-]+)(?:\/(input|output|keep|discard|cancel))?$/.exec(sub);
  if (req.method === "GET" && m) {
    const [, id, action] = m;
    if (!action) return send(res, 200, manager.get(id!));
    if (action === "input" || action === "output") return sendImage(res, manager.file(id!, action));
    throw new HttpError(405, "method not allowed");
  }
  if (req.method !== "POST") throw new HttpError(405, "method not allowed");
  // Only the planner page itself may start edits or write into the data folder.
  if (isCrossSite(req.headers)) throw new HttpError(403, "cross-site request refused");
  if (sub === "") {
    if ((req.headers["content-type"] ?? "").split(";")[0] !== "application/json")
      throw new HttpError(415, "JSON only");
    let body: unknown;
    try {
      body = JSON.parse((await readRawBody(req, 20_000)).toString("utf8"));
    } catch (e) {
      throw e instanceof HttpError ? e : new HttpError(400, "invalid JSON");
    }
    return send(res, 200, await manager.start(body));
  }
  if (!m || !m[2]) throw new HttpError(404, "not found");
  const [, id, action] = m;
  if (action === "keep") return send(res, 200, await manager.keep(id!));
  if (action === "discard") return send(res, 200, await manager.discard(id!));
  if (action === "cancel") return send(res, 200, manager.cancel(id!));
  throw new HttpError(405, "method not allowed");
}

export type EditEnv = Record<string, string | undefined>;

/**
 * Options from the environment: TATTOO_CLAUDE_BIN, TATTOO_EDIT_MODEL, TATTOO_EDIT_CACHE, and for
 * generative edits TATTOO_OPENAI_API_KEY (or OPENAI_API_KEY), TATTOO_OPENAI_MODEL,
 * TATTOO_OPENAI_FIDELITY, TATTOO_OPENAI_QUALITY.
 */
export function editOptionsFromEnv(env: EditEnv): EditOptions {
  const cache = env.TATTOO_EDIT_CACHE?.trim();
  return {
    bin: env.TATTOO_CLAUDE_BIN?.trim() || "claude",
    cacheDir: cache
      ? path.resolve(cache.replace(/^~(?=\/|$)/, os.homedir()))
      : path.join(os.homedir(), ".cache", "tattoo-planner"),
    ...(env.TATTOO_EDIT_MODEL?.trim() ? { model: env.TATTOO_EDIT_MODEL.trim() } : {}),
    openai: openaiSettingsFromEnv(env),
  };
}

export function editsPlugin(dataDir: string | null, env: EditEnv): Plugin {
  return {
    name: "tattoo-planner-edits",
    configureServer(server) {
      const manager = new EditManager(dataDir, editOptionsFromEnv(env));
      server.httpServer?.on("close", () => void manager.close());
      server.middlewares.use(EDITS_ENDPOINT, (req, res) => {
        handleEditRequest(manager, req, res).catch((e: unknown) => {
          const status = e instanceof HttpError ? e.status : 500;
          send(res, status, { error: e instanceof Error ? e.message : String(e) });
        });
      });
    },
  };
}
