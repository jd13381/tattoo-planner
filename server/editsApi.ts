// API of the Image studio. Generative edits run here with the OpenAI Images API
// (ADR 0008, 0009); built-in operations run in the page and arrive as finished PNGs (ADR 0013).
//   GET  /api/edits                     → EditOverview: can edits run, and every job of this server run
//   POST /api/edits                     body EditRequest → EditJob (starts a GPT Image request;
//                                       mode edit | create, optional reference assets)
//   GET  /api/edits/jobs/<id>           → EditJob
//   GET  /api/edits/jobs/<id>/input     the image the job edits
//   GET  /api/edits/jobs/<id>/output    the result (when done)
//   POST /api/edits/jobs/<id>/keep      writes edits/<root>-edit-N.png and a manifest entry → EditJob
//   POST /api/edits/jobs/<id>/discard   stops the job if needed and deletes its working folder
//   POST /api/edits/jobs/<id>/cancel    stops a running job
//   POST /api/edits/sessions            body SessionRequest → EditSession (one open session per image)
//   POST /api/edits/sessions/<id>/pick  body { job } → EditSession (the job's result becomes a version)
//   POST /api/edits/sessions/<id>/truncate  body { length } → EditSession ("continue from vK")
//   POST /api/edits/sessions/<id>/save  body { job? } → EditJob (keeps a version, default the last)
//   POST /api/edits/sessions/<id>/close discards every unsaved job of the session and ends it
//   POST /api/edits/sessions/<id>/apply?step=…&base=N  body image/png → EditJob: a built-in operation's
//                                       result, added as the session's next version
// Sessions (ADR 0010) hold the version stack; a POST /api/edits with `session` runs on its last version.
// Each job works on a copy of the image in its own temp folder; originals are never touched. The data
// folder only changes on "keep", and then only by a new file in edits/ (or generated/ for new images)
// plus one appended manifest entry.
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
import { MANIFEST_FILE, type Asset } from "../src/assets/manifest.ts";
import { mergeManifest } from "../src/assets/manifestDoc.ts";
import { imageContentType, isInside, listAssets, resolveInside } from "./assetsApi.ts";
import { HttpError, isCrossSite, readRawBody, send, sendError, type Handler } from "./http.ts";
import { BUILTIN_TOOL } from "../src/edits/builtin.ts";
import {
  checkInstruction,
  createdAsset,
  EDIT_TIMEOUT_MS,
  endsWithIend,
  INPUT_BASENAME,
  keptAsset,
  MAX_OUTPUT_BYTES,
  MAX_OUTPUT_PIXELS,
  nextVariant,
  OUTPUT_FILE,
  readPngInfo,
  slugName,
} from "../src/edits/edit.ts";
import {
  backgroundAsset,
  BACKGROUND_EDIT_LINE,
  BACKGROUND_SIZE,
  BACKGROUNDS_FOLDER,
  buildBackgroundPrompt,
} from "../src/edits/background.ts";
import { seamlessPng } from "./backgrounds.ts";
import { pickVersion, runSource, sessionForAsset, truncateVersions } from "../src/edits/session.ts";
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
} from "../src/edits/openai.ts";
import {
  CREATE_BACKGROUNDS,
  CREATE_SIZES,
  EDITS_FOLDER,
  GENERATED_FOLDER,
  GENERATED_KIND,
  GENERATED_TAG,
  type BuiltinAvailability,
  type CreateBackground,
  type CreateSize,
  type EditJob,
  type EditOverview,
  type EditRequest,
  type EditSession,
  type GenerativeAvailability,
  type SessionRequest,
} from "../src/edits/types.ts";

const MAX_LOG_LINES = 400;

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
  /** GPT Image jobs: the settings when the job started (the desktop app can change the key meanwhile). */
  openai?: OpenAISettings;
};

export type EditOptions = {
  timeoutMs?: number;
  /** Generative edits; null or missing when no OpenAI key is set. */
  openai?: OpenAISettings | null;
  /** Replaceable in tests. */
  fetchImpl?: typeof fetch;
};

/** What a job starts from: the image, its file and the steps that led to it. */
type Source = {
  asset: Asset;
  /** Path of the source image; null for a new image without a first version. */
  path: string | null;
  earlier: string[];
  earlierTools: string[];
  earlierRefs: string[];
  created?: { name: string };
};

export class EditManager {
  private readonly jobs = new Map<string, Job>();
  private readonly sessions = new Map<string, EditSession>();
  private sessionCounter = 0;
  private counter = 0;
  private manifestLock: Promise<unknown> = Promise.resolve();

  private readonly dataDir: string | null;
  private readonly opts: EditOptions;

  constructor(dataDir: string | null, opts: EditOptions) {
    this.dataDir = dataDir;
    this.opts = opts;
  }

  /** Null when the data folder is usable, else why not. */
  private async dataFolderProblem(): Promise<string | null> {
    if (!this.dataDir) return "No project is open, so there are no images to edit.";
    try {
      if (!(await stat(this.dataDir)).isDirectory()) throw new Error();
    } catch {
      return `project folder not found: ${this.dataDir}`;
    }
    return null;
  }

  async generativeAvailability(): Promise<GenerativeAvailability> {
    const problem = await this.dataFolderProblem();
    if (problem) return { enabled: false, reason: problem };
    if (!this.opts.openai)
      return {
        enabled: false,
        reason: "Generative edits need an OpenAI API key, and none is set up.",
      };
    return { enabled: true, model: this.opts.openai.model };
  }

  /** Built-in operations run in the page; the server only needs the data folder to keep results. */
  async builtinAvailability(): Promise<BuiltinAvailability> {
    const problem = await this.dataFolderProblem();
    return problem ? { enabled: false, reason: problem } : { enabled: true };
  }

  async overview(): Promise<EditOverview> {
    const [builtin, generative] = await Promise.all([
      this.builtinAvailability(),
      this.generativeAvailability(),
    ]);
    return { builtin, generative, jobs: this.list(), sessions: [...this.sessions.values()] };
  }

  private session(id: string): EditSession {
    const s = this.sessions.get(id);
    if (!s) throw new HttpError(404, `no open session ${id} (sessions end when the planner closes)`);
    return s;
  }

  /** Opens a session on an image (or returns the one already open on it), or for a new image. */
  async startSession(body: unknown): Promise<EditSession> {
    const req = (body ?? {}) as Partial<SessionRequest> & Record<string, unknown>;
    const make = (fields: Omit<EditSession, "id" | "versions" | "startedAt">): EditSession => {
      const session: EditSession = {
        id: `s${++this.sessionCounter}-${Date.now().toString(36)}`,
        ...fields,
        versions: [],
        startedAt: new Date().toISOString(),
      };
      this.sessions.set(session.id, session);
      return session;
    };
    if (req.mode === "create") {
      // A background tile is always square and opaque: the seam fix needs a full square.
      const tileable = req.tileable === true;
      const size = tileable ? BACKGROUND_SIZE : (req.size ?? "1024x1024");
      const background = tileable ? "opaque" : (req.background ?? "transparent");
      if (!CREATE_SIZES.some((o) => o.value === size))
        throw new HttpError(400, `unknown size ${String(size)}`);
      if (!CREATE_BACKGROUNDS.some((o) => o.value === background))
        throw new HttpError(400, `unknown background ${String(background)}`);
      return make({
        mode: "create",
        create: { name: slugName(req.name), size, background, ...(tileable ? { tileable } : {}) },
      });
    }
    if (req.mode !== "edit") throw new HttpError(400, `unknown mode ${String(req.mode)}`);
    if (typeof req.assetId !== "string") throw new HttpError(400, "assetId missing");
    const open = sessionForAsset([...this.sessions.values()], req.assetId);
    if (open) return open;
    const problem = await this.dataFolderProblem();
    if (problem) throw new HttpError(409, problem);
    const listing = await listAssets(this.dataDir);
    if (listing.status !== "ok") throw new HttpError(409, "cannot read the manifest");
    if (!listing.assets.some((a) => a.id === req.assetId))
      throw new HttpError(404, `unknown asset ${req.assetId}`);
    return make({ mode: "edit", assetId: req.assetId });
  }

  /** Makes a result of this session the version after the one it started from. */
  pick(sessionId: string, body: unknown): EditSession {
    const session = this.session(sessionId);
    const jobId = (body as { job?: unknown } | null)?.job;
    if (typeof jobId !== "string") throw new HttpError(400, "job missing");
    const job = this.job(jobId);
    if (job.info.session !== session.id) throw new HttpError(409, "that result belongs to another session");
    const picked = pickVersion(session.versions, job.info);
    if (!picked.ok) throw new HttpError(409, picked.message);
    session.versions = picked.versions;
    return session;
  }

  /** Keeps v0 … v`length` ("continue from vK"). */
  truncate(sessionId: string, body: unknown): EditSession {
    const session = this.session(sessionId);
    const length = (body as { length?: unknown } | null)?.length;
    if (typeof length !== "number" || !Number.isInteger(length) || length < 0)
      throw new HttpError(400, "length must be a whole number");
    session.versions = truncateVersions(session.versions, length);
    return session;
  }

  /** Writes a version (default the last) into the data folder; the session stays open. */
  async save(sessionId: string, body: unknown): Promise<EditJob> {
    const session = this.session(sessionId);
    const jobId = (body as { job?: unknown } | null)?.job ?? session.versions.at(-1);
    if (typeof jobId !== "string") throw new HttpError(409, "nothing to save yet: pick a result first");
    if (!session.versions.includes(jobId))
      throw new HttpError(409, "only a version of this session can be saved");
    return this.keep(jobId);
  }

  /** Ends a session: every job of it that was not saved is stopped and its working folder removed. */
  async closeSession(sessionId: string): Promise<{ closed: string }> {
    const session = this.session(sessionId);
    this.sessions.delete(session.id);
    const own = [...this.jobs.values()].filter(
      (j) => j.info.session === session.id && j.info.state !== "kept" && j.info.state !== "discarded",
    );
    await Promise.all(own.map((j) => this.discard(j.info.id)));
    return { closed: session.id };
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
    const req = { ...((body ?? {}) as Partial<EditRequest>) };
    // In a session the source is always its last version, whatever else the request says.
    const session = req.session !== undefined ? this.session(String(req.session)) : null;
    if (session) {
      const from = runSource(session);
      delete req.assetId;
      delete req.fromJob;
      delete req.name;
      delete req.size;
      delete req.background;
      delete req.tileable;
      req.mode = session.mode;
      if (from.kind === "job") req.fromJob = from.jobId;
      else if (from.kind === "asset") req.assetId = from.assetId;
      else Object.assign(req, from.create);
    }
    if (req.engine === "builtin")
      throw new HttpError(
        400,
        "built-in operations run in the page; send the result to /api/edits/sessions/<id>/apply",
      );
    if (req.engine !== undefined && req.engine !== "openai")
      throw new HttpError(400, `unknown engine ${String(req.engine)}`);
    if (req.mode !== undefined && req.mode !== "edit" && req.mode !== "create")
      throw new HttpError(400, `unknown mode ${String(req.mode)}`);
    // With fromJob, "create" means editing the created result further.
    const creating = req.mode === "create" && req.fromJob === undefined;
    const refIds = req.references ?? [];
    if (!Array.isArray(refIds) || refIds.some((r) => typeof r !== "string"))
      throw new HttpError(400, "references must be a list of asset ids");
    if (refIds.length > MAX_REFERENCES)
      throw new HttpError(400, `at most ${MAX_REFERENCES} reference images`);
    const tileable = creating && req.tileable === true;
    const size = tileable ? BACKGROUND_SIZE : (req.size ?? "1024x1024");
    const background = tileable ? "opaque" : (req.background ?? "transparent");
    if (!CREATE_SIZES.some((o) => o.value === size)) throw new HttpError(400, `unknown size ${String(size)}`);
    if (!CREATE_BACKGROUNDS.some((o) => o.value === background))
      throw new HttpError(400, `unknown background ${String(background)}`);
    const availability = await this.generativeAvailability();
    if (!availability.enabled) throw new HttpError(409, availability.reason);
    const instruction = checkInstruction(req.instruction);
    if (!instruction.ok) throw new HttpError(400, instruction.message);
    const running = [...this.jobs.values()].filter((j) => j.info.state === "running");
    if (running.length >= MAX_RUNNING_OPENAI)
      throw new HttpError(429, `${MAX_RUNNING_OPENAI} edits are running already; wait for one to finish`);

    const from: Source = creating
      ? (() => {
          const name = slugName(req.name);
          return {
            asset: { id: name, file: "", kind: GENERATED_KIND, tags: [GENERATED_TAG] },
            path: null,
            earlier: [],
            earlierTools: [],
            earlierRefs: [],
            created: { name, ...(tileable ? { tileable } : {}) },
          };
        })()
      : await this.sourceOf(req.fromJob, req.assetId);
    const { asset, path: source } = from;

    const references = await this.resolveReferences(refIds);
    const ext = source ? path.extname(source).toLowerCase() || ".png" : ".png";
    if (source) {
      if (!openaiInputType(`x${ext}`))
        throw new HttpError(
          415,
          `GPT Image takes PNG, JPEG or WebP, not ${ext}; apply a built-in operation first (it saves a PNG)`,
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

    // Read once: the desktop app's key can be removed while the files are copied.
    const openai = this.opts.openai;
    if (!openai) {
      await rm(dir, { recursive: true, force: true });
      throw new HttpError(409, "Generative edits need an OpenAI API key, and none is set up.");
    }
    const info = this.newInfo({
      from,
      fromJob: req.fromJob,
      session,
      refIds,
      instruction: instruction.text,
      engine: "openai",
      tool: openai.model,
    });
    const job: Job = {
      info,
      asset,
      dir,
      inputPath,
      refs,
      ...(creating ? { create: { size, background } } : {}),
      abort: new AbortController(),
      openai,
    };
    this.jobs.set(info.id, job);
    void this.runOpenAI(job, inputFile);
    return info;
  }

  private newInfo(p: {
    from: Source;
    fromJob: string | undefined;
    session: EditSession | null;
    refIds: readonly string[];
    instruction: string;
    engine: EditJob["engine"];
    tool: string;
  }): EditJob {
    const { from } = p;
    return {
      id: `e${++this.counter}-${Date.now().toString(36)}`,
      assetId: from.asset.derived_from ?? from.asset.id,
      ...(p.fromJob !== undefined ? { fromJob: String(p.fromJob) } : {}),
      ...(p.session ? { session: p.session.id } : {}),
      ...(from.created ? { created: from.created } : {}),
      ...(from.earlierRefs.length + p.refIds.length > 0
        ? { references: [...new Set([...from.earlierRefs, ...p.refIds])] }
        : {}),
      engine: p.engine,
      instructions: [...from.earlier, p.instruction],
      tools: [...from.earlier.map((_, i) => from.earlierTools[i] ?? "unknown tool"), p.tool],
      state: "running",
      startedAt: new Date().toISOString(),
      log: [],
    };
  }

  /** The image a job works on: a finished job's result (fromJob) or a manifest image (assetId). */
  private async sourceOf(fromJob: unknown, assetId: unknown): Promise<Source> {
    if (fromJob !== undefined) {
      const prev = this.job(String(fromJob));
      if (!prev.outputPath || (prev.info.state !== "done" && prev.info.state !== "kept"))
        throw new HttpError(409, "that edit has no result to work on");
      return {
        asset: prev.asset,
        path: prev.outputPath,
        earlier: prev.info.instructions,
        earlierTools: prev.info.tools,
        earlierRefs: prev.info.references ?? [],
        ...(prev.info.created ? { created: prev.info.created } : {}),
      };
    }
    if (typeof assetId !== "string") throw new HttpError(400, "assetId missing");
    const problem = await this.dataFolderProblem();
    if (problem) throw new HttpError(409, problem);
    const listing = await listAssets(this.dataDir);
    if (listing.status !== "ok") throw new HttpError(409, "cannot read the manifest");
    const found = listing.assets.find((a) => a.id === assetId);
    if (!found) throw new HttpError(404, `unknown asset ${assetId}`);
    const { exists, ...asset } = found;
    void exists;
    if (!imageContentType(asset.file).ok)
      throw new HttpError(415, `${asset.file} is not an image the planner reads`);
    const resolved = await resolveInside(this.dataDir!, asset.file);
    if (!resolved.ok) throw new HttpError(404, `${asset.file}: ${resolved.message}`);
    return { asset, path: resolved.path, earlier: [], earlierTools: [], earlierRefs: [] };
  }

  /**
   * Adds the result of a built-in operation, run in the page on the session's last version, as the
   * session's next version. `base` is the number of versions the page saw; when the session has moved
   * on meanwhile, the result is refused so it cannot land on the wrong version.
   */
  async apply(sessionId: string, png: Buffer, query: { step?: unknown; base?: unknown }): Promise<EditJob> {
    const session = this.session(sessionId);
    const problem = await this.dataFolderProblem();
    if (problem) throw new HttpError(409, problem);
    const step = checkInstruction(query.step);
    if (!step.ok) throw new HttpError(400, step.message);
    const base = Number(query.base);
    const stale = () => !this.sessions.has(session.id) || session.versions.length !== base;
    if (query.base === undefined || query.base === "" || !Number.isInteger(base) || base < 0)
      throw new HttpError(400, "base must be the number of versions the operation started from");
    if (stale()) throw new HttpError(409, "the session changed meanwhile; apply the operation again");
    if (png.length > MAX_OUTPUT_BYTES)
      throw new HttpError(413, `the result is larger than ${MAX_OUTPUT_BYTES / 1024 / 1024} MB`);
    const info = readPngInfo(png);
    if (!info || !endsWithIend(png)) throw new HttpError(415, "the result is not a complete PNG");
    if (info.width * info.height > MAX_OUTPUT_PIXELS)
      throw new HttpError(413, "the result has too many pixels");
    const run = runSource(session);
    if (run.kind === "blank")
      throw new HttpError(409, "a new image needs a first version from GPT Image before built-in operations");
    const from =
      run.kind === "job"
        ? await this.sourceOf(run.jobId, undefined)
        : await this.sourceOf(undefined, run.assetId);

    const dir = await mkdtemp(path.join(os.tmpdir(), "tattoo-edit-"));
    const inputPath = path.join(dir, `${INPUT_BASENAME}${path.extname(from.path!).toLowerCase() || ".png"}`);
    const outputPath = path.join(dir, OUTPUT_FILE);
    try {
      await copyFile(from.path!, inputPath);
      await writeFile(outputPath, png);
    } catch (e) {
      await rm(dir, { recursive: true, force: true });
      throw e;
    }
    // Checked again: the copies took a moment, and another apply or a pick may have come in.
    if (stale()) {
      await rm(dir, { recursive: true, force: true });
      throw new HttpError(409, "the session changed meanwhile; apply the operation again");
    }
    const job: Job = {
      info: this.newInfo({
        from,
        fromJob: run.kind === "job" ? run.jobId : undefined,
        session,
        refIds: [],
        instruction: step.text,
        engine: "builtin",
        tool: BUILTIN_TOOL,
      }),
      asset: from.asset,
      dir,
      inputPath,
      refs: [],
      outputPath,
      abort: new AbortController(),
    };
    job.info.state = "done";
    job.info.finishedAt = job.info.startedAt;
    job.info.output = { width: info.width, height: info.height, bytes: png.length, alpha: info.alpha };
    this.jobs.set(job.info.id, job);
    session.versions = [...session.versions, job.info.id];
    return job.info;
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

  /** One generative edit: send the image and the instruction, write the answer as output.png. */
  private async runOpenAI(job: Job, inputFile: string) {
    const settings = job.openai!;
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
      const tileable = info.created?.tileable === true;
      const prompt =
        job.create && tileable
          ? buildBackgroundPrompt(current)
          : job.create
            ? buildCreatePrompt(current, refPrompts)
            : buildGenerativePrompt({
                instructions: info.instructions,
                asset: job.asset,
                references: refPrompts,
              }) + (tileable ? `\n\n${BACKGROUND_EDIT_LINE}` : "");
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
      let bytes = answer.png;
      if (tileable && readPngInfo(bytes)) {
        // Background mode: the model's tile is only roughly seamless; offset-and-blend closes it.
        try {
          bytes = seamlessPng(bytes).png;
          this.log(job, ["Seam fixed (offset-and-blend), so the tile repeats without an edge."]);
        } catch (e) {
          this.log(job, [`Seam fix skipped: ${e instanceof Error ? e.message : String(e)}`]);
        }
      }
      const png = readPngInfo(bytes);
      if (!png || bytes.length > MAX_OUTPUT_BYTES) {
        info.state = "failed";
        info.error = "OpenAI returned something that is not a PNG.";
        return;
      }
      const outputPath = path.join(job.dir, OUTPUT_FILE);
      await writeFile(outputPath, bytes);
      const cost = estimateCostUsd(answer.usage);
      if (cost !== null) info.costUsd = cost;
      this.log(job, [
        `Received ${png.width} × ${png.height} px${cost !== null ? `, about $${cost.toFixed(2)}` : ""}.`,
      ]);
      job.outputPath = outputPath;
      info.output = { width: png.width, height: png.height, bytes: bytes.length, alpha: png.alpha };
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
    if (!dataDir) throw new HttpError(409, "no project is open");
    const root = await realpath(dataDir);
    const created = job.info.created;
    const tile = created?.tileable === true;
    const folderName = tile ? BACKGROUNDS_FOLDER : created ? GENERATED_FOLDER : EDITS_FOLDER;
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
      ? nextVariant(created.name, takenIds, takenFiles, tile ? "background" : "created")
      : nextVariant(job.info.assetId, takenIds, takenFiles);
    // The entry is built from the image actually edited (which may itself be a kept edit), so its
    // tags and crop carry over; derived_from still names the original (rootAssetId).
    const original = created
      ? undefined
      : (listing.assets.find((a) => a.id === job.asset.id) ??
        listing.assets.find((a) => a.id === job.info.assetId));
    let sameSize = false;
    if (original?.crop && job.info.output) {
      const orig = await resolveInside(dataDir, original.file);
      const png = orig.ok ? readPngInfo(await readFile(orig.path)) : null;
      sameSize = !!png && png.width === job.info.output.width && png.height === job.info.output.height;
    }
    const base = original ? { ...original } : job.asset;
    const entry = tile
      ? backgroundAsset(variant, job.info.instructions, job.info.tools)
      : created
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
    this.sessions.clear();
    await Promise.all(
      [...this.jobs.values()].map(async (j) => {
        j.abort.abort();
        await rm(j.dir, { recursive: true, force: true });
      }),
    );
  }
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
  const sm = /^sessions(?:\/([a-z0-9-]+)\/(pick|truncate|save|close|apply))?$/.exec(sub);
  if (req.method === "GET" && m) {
    const [, id, action] = m;
    if (!action) return send(res, 200, manager.get(id!));
    if (action === "input" || action === "output") return sendImage(res, manager.file(id!, action));
    throw new HttpError(405, "method not allowed");
  }
  if (req.method !== "POST") throw new HttpError(405, "method not allowed");
  // Only the planner page itself may start edits or write into the data folder.
  if (isCrossSite(req.headers)) throw new HttpError(403, "cross-site request refused");
  const readJson = async (): Promise<unknown> => {
    if ((req.headers["content-type"] ?? "").split(";")[0] !== "application/json")
      throw new HttpError(415, "JSON only");
    try {
      return JSON.parse((await readRawBody(req, 20_000)).toString("utf8"));
    } catch (e) {
      throw e instanceof HttpError ? e : new HttpError(400, "invalid JSON");
    }
  };
  if (sub === "") return send(res, 200, await manager.start(await readJson()));
  if (sm) {
    const [, id, action] = sm;
    if (!id) return send(res, 200, await manager.startSession(await readJson()));
    if (action === "close") return send(res, 200, await manager.closeSession(id));
    if (action === "apply") {
      if ((req.headers["content-type"] ?? "").split(";")[0] !== "image/png")
        throw new HttpError(415, "PNG only");
      const query = new URLSearchParams((req.url ?? "").split("?")[1] ?? "");
      const png = await readRawBody(req, MAX_OUTPUT_BYTES);
      return send(
        res,
        200,
        await manager.apply(id, png, {
          step: query.get("step") ?? undefined,
          base: query.get("base") ?? undefined,
        }),
      );
    }
    const body = await readJson();
    if (action === "pick") return send(res, 200, manager.pick(id, body));
    if (action === "truncate") return send(res, 200, manager.truncate(id, body));
    return send(res, 200, await manager.save(id, body));
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
 * Options from the environment: TATTOO_OPENAI_API_KEY (or OPENAI_API_KEY), TATTOO_OPENAI_MODEL,
 * TATTOO_OPENAI_FIDELITY, TATTOO_OPENAI_QUALITY.
 */
export function editOptionsFromEnv(env: EditEnv): EditOptions {
  return { openai: openaiSettingsFromEnv(env) };
}

/**
 * The Image studio API for the open project. Sessions and jobs belong to one project folder: when
 * the project changes, the old manager stops its jobs and removes their working folders.
 */
export function editsHandler(dir: () => Promise<string | null>, opts: EditOptions) {
  let current: { dir: string | null; manager: EditManager } | null = null;
  const managerFor = (folder: string | null): EditManager => {
    if (current && current.dir === folder) return current.manager;
    if (current) void current.manager.close();
    current = { dir: folder, manager: new EditManager(folder, opts) };
    return current.manager;
  };
  const handle: Handler = async (req, res, url) => {
    try {
      const manager = managerFor(await dir());
      // handleEditRequest reads the sub-path from req.url, as Connect passed it before.
      req.url = url;
      await handleEditRequest(manager, req, res);
    } catch (e) {
      sendError(res, e, 500);
    }
  };
  return { handle, close: async () => current?.manager.close() };
}
