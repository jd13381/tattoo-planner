// Dev-server endpoint that edits reference images with `claude -p` on Jan's Mac (ADR 0007).
//   GET  /api/edits                     → EditOverview: can edits run, and every job of this server run
//   POST /api/edits                     body EditRequest → EditJob (starts it)
//   GET  /api/edits/jobs/<id>           → EditJob
//   GET  /api/edits/jobs/<id>/input     the image the job edits
//   GET  /api/edits/jobs/<id>/output    the result (when done)
//   POST /api/edits/jobs/<id>/keep      writes edits/<root>-edit-N.png and a manifest entry → EditJob
//   POST /api/edits/jobs/<id>/discard   stops the job if needed and deletes its working folder
//   POST /api/edits/jobs/<id>/cancel    stops a running job
// Each job works on a copy of the image in its own temp folder; originals are never touched. The data
// folder only changes on "keep", and then only by a new file in edits/ plus one appended manifest entry.
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
  claudeArgs,
  EDIT_TIMEOUT_MS,
  INPUT_BASENAME,
  keptAsset,
  MAX_OUTPUT_BYTES,
  MAX_RUNNING,
  nextVariant,
  OUTPUT_FILE,
  parseStreamLine,
  readPngInfo,
} from "../edit.ts";
import {
  EDITS_ENDPOINT,
  EDITS_FOLDER,
  type EditAvailability,
  type EditJob,
  type EditOverview,
  type EditRequest,
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

type Job = {
  info: EditJob;
  asset: Asset;
  dir: string;
  inputPath: string;
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

  async availability(): Promise<EditAvailability> {
    if (!this.dataDir)
      return { enabled: false, reason: "TATTOO_DATA_DIR is not set, so there are no images to edit." };
    try {
      if (!(await stat(this.dataDir)).isDirectory()) throw new Error();
    } catch {
      return { enabled: false, reason: `data folder not found: ${this.dataDir}` };
    }
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
    return { availability: await this.availability(), jobs: this.list() };
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
    const availability = await this.availability();
    if (!availability.enabled) throw new HttpError(409, availability.reason);
    const instruction = checkInstruction(req.instruction);
    if (!instruction.ok) throw new HttpError(400, instruction.message);
    if ([...this.jobs.values()].filter((j) => j.info.state === "running").length >= MAX_RUNNING)
      throw new HttpError(429, `${MAX_RUNNING} edits are running already; wait for one to finish`);

    let asset: Asset;
    let source: string;
    let earlier: string[] = [];
    if (req.fromJob !== undefined) {
      const prev = this.job(String(req.fromJob));
      if (!prev.outputPath || (prev.info.state !== "done" && prev.info.state !== "kept"))
        throw new HttpError(409, "that edit has no result to work on");
      asset = prev.asset;
      source = prev.outputPath;
      earlier = prev.info.instructions;
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

    const ext = path.extname(source).toLowerCase() || ".png";
    const dir = await mkdtemp(path.join(os.tmpdir(), "tattoo-edit-"));
    const inputFile = `${INPUT_BASENAME}${ext}`;
    const inputPath = path.join(dir, inputFile);
    await copyFile(source, inputPath);
    await mkdir(this.opts.cacheDir, { recursive: true });

    const id = `e${++this.counter}-${Date.now().toString(36)}`;
    const info: EditJob = {
      id,
      assetId: asset.derived_from ?? asset.id,
      ...(req.fromJob !== undefined ? { fromJob: String(req.fromJob) } : {}),
      instructions: [...earlier, instruction.text],
      state: "running",
      startedAt: new Date().toISOString(),
      log: [],
    };
    const job: Job = { info, asset, dir, inputPath, abort: new AbortController() };
    this.jobs.set(id, job);
    const prompt = buildEditPrompt({
      inputFile,
      instructions: info.instructions,
      asset,
      cacheDir: this.opts.cacheDir,
    });
    void this.run(job, prompt);
    return info;
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

  /** Writes the result into edits/ and appends its manifest entry; never overwrites anything. */
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
    const folder = path.join(root, EDITS_FOLDER);
    await mkdir(folder, { recursive: true });
    const realFolder = await realpath(folder);
    if (!isInside(root, realFolder) || !(await stat(realFolder)).isDirectory())
      throw new HttpError(403, `${EDITS_FOLDER}/ leads out of the data folder`);

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
      ...(await readdir(realFolder)).map((f) => `${EDITS_FOLDER}/${f}`.toLowerCase()),
    ]);
    const variant = nextVariant(job.info.assetId, takenIds, takenFiles);
    const original = listing.assets.find((a) => a.id === job.info.assetId);
    let sameSize = false;
    if (original?.crop && job.info.output) {
      const orig = await resolveInside(dataDir, original.file);
      const png = orig.ok ? readPngInfo(await readFile(orig.path)) : null;
      sameSize = !!png && png.width === job.info.output.width && png.height === job.info.output.height;
    }
    const base = original ? { ...original } : job.asset;
    const entry = keptAsset(base, variant, job.info.instructions, sameSize);
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

/** Options from the environment: TATTOO_CLAUDE_BIN, TATTOO_EDIT_MODEL, TATTOO_EDIT_CACHE. */
export function editOptionsFromEnv(env: EditEnv): EditOptions {
  const cache = env.TATTOO_EDIT_CACHE?.trim();
  return {
    bin: env.TATTOO_CLAUDE_BIN?.trim() || "claude",
    cacheDir: cache
      ? path.resolve(cache.replace(/^~(?=\/|$)/, os.homedir()))
      : path.join(os.homedir(), ".cache", "tattoo-planner"),
    ...(env.TATTOO_EDIT_MODEL?.trim() ? { model: env.TATTOO_EDIT_MODEL.trim() } : {}),
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
