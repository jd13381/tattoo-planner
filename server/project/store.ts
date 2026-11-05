// The current project (docs/adr/0012-project-folder.md): TATTOO_DATA_DIR wins; otherwise the folder
// remembered in the user config. Asked on every request, so opening a project takes effect at once.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { MANIFEST_FILE } from "../../src/assets/manifest.ts";
import { mergeManifest } from "../../src/assets/manifestDoc.ts";
import {
  PROJECT_FILE,
  PROJECT_FOLDERS,
  newProjectSchema,
  projectPatchSchema,
  type CreateResult,
  type MigrationReport,
  type ProjectMeta,
  type ProjectStatus,
  type RecentProject,
  type SaveSampleResult,
} from "../../src/project/schema.ts";
import { newLayoutText } from "../../src/layout/yamlDoc.ts";
import { newProjectText, updateProjectText } from "../../src/project/yamlDoc.ts";
import { expandUser } from "../dataDir.ts";
import { isInside } from "../assetsApi.ts";
import { HttpError } from "../http.ts";
import { inspectFolder, readProjectFile } from "./folder.ts";
import { hasLegacyConfig, MEASUREMENTS_FILE, migrateFolder } from "./migrate.ts";
import { copySample, SAMPLE_READ_ONLY } from "./sample.ts";
import { addRecent, readUserConfig, writeUserConfig, type UserConfig } from "./userConfig.ts";

export type StoreOptions = {
  /** TATTOO_DATA_DIR, resolved; when set it is the project and cannot be switched. */
  envDir: string | null;
  /** The user config file (userConfigFile()); injectable for tests. */
  configFile: string;
  home: string;
  /** The checkout's config/ with Jan's layouts, projections and measurements; null when absent. */
  legacyConfigDir: string | null;
  /** The read-only sample project shipped with the app (samples/demo); null or absent: none. */
  sampleDir?: string | null;
};

/** Where the open project keeps each kind of data; all null when none is open. */
export type ProjectPaths = {
  dir: string | null;
  layoutsDir: string | null;
  projectionsDir: string | null;
  measurementsFile: string | null;
  /** The sample project is open: every write is refused (server/sampleApi.ts). */
  readOnly: boolean;
};

type Current =
  | { status: "none"; problem: string | null }
  | { status: "legacy"; dir: string; problem: string | null }
  | {
      status: "project";
      dir: string;
      meta: ProjectMeta | null;
      problem: string | null;
      sample?: boolean;
    };

export const STARTER_LAYOUT = "first-sketch";

function starterLayoutText(): string {
  return newLayoutText({ name: STARTER_LAYOUT, region: "arm-left", elements: [] });
}

const NO_PATHS: ProjectPaths = {
  dir: null,
  layoutsDir: null,
  projectionsDir: null,
  measurementsFile: null,
  readOnly: false,
};

function atomicWrite(file: string, text: string): Promise<void> {
  const tmp = `${file}.tmp-${process.pid}`;
  return writeFile(tmp, text, "utf8").then(() => rename(tmp, file));
}

export class ProjectStore {
  private readonly opts: StoreOptions;
  /** Serialises changes, so two quick clicks do not race on config.json or project.yaml. */
  private lock: Promise<unknown> = Promise.resolve();
  /**
   * The sample is open. Kept in memory only, never in config.json: a restart goes back to the
   * remembered project (or the start screen), and the sample's app-internal path is never remembered.
   */
  private sampleOpen = false;

  constructor(opts: StoreOptions) {
    this.opts = opts;
  }

  get locked(): boolean {
    return this.opts.envDir !== null;
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.lock.then(fn);
    this.lock = run.catch(() => undefined);
    return run;
  }

  get sampleDir(): string | null {
    return this.opts.sampleDir ?? null;
  }

  /** Whether the sample project is open (and so every write is refused). */
  get readOnly(): boolean {
    return this.sampleOpen && !this.locked && this.sampleDir !== null;
  }

  private async current(): Promise<Current> {
    const { envDir } = this.opts;
    if (this.readOnly) {
      const sample = await this.projectAt(this.sampleDir!);
      return sample.status === "project" ? { ...sample, sample: true } : sample;
    }
    if (envDir) {
      const state = await inspectFolder(envDir);
      if (state === "missing" || state === "file")
        return { status: "none", problem: `The project folder was not found: ${envDir}` };
      // Any other folder named by TATTOO_DATA_DIR is an old data folder, as before projects existed.
      if (state !== "project") return { status: "legacy", dir: envDir, problem: null };
      return this.projectAt(envDir);
    }
    const config = await readUserConfig(this.opts.configFile);
    if (!config.project) return { status: "none", problem: null };
    const state = await inspectFolder(config.project);
    if (state === "project") return this.projectAt(config.project);
    if (state === "legacy") return { status: "legacy", dir: config.project, problem: null };
    return {
      status: "none",
      problem:
        state === "missing"
          ? `The last project folder is not available: ${config.project}`
          : `The last project folder is no longer a project: ${config.project}`,
    };
  }

  private async projectAt(dir: string): Promise<Current> {
    const r = await readProjectFile(dir);
    return r.ok
      ? { status: "project", dir, meta: r.project, problem: null }
      : { status: "project", dir, meta: null, problem: r.error };
  }

  async paths(): Promise<ProjectPaths> {
    const c = await this.current();
    if (c.status === "none") return NO_PATHS;
    const legacy = c.status === "legacy" ? this.opts.legacyConfigDir : null;
    // A legacy folder keeps using the app's config/ until it is moved into the project.
    const base = legacy ?? c.dir;
    return {
      dir: c.dir,
      layoutsDir: path.join(base, "layouts"),
      projectionsDir: path.join(base, "projections"),
      measurementsFile: path.join(base, MEASUREMENTS_FILE),
      readOnly: c.status === "project" && c.sample === true,
    };
  }

  private async recent(config: UserConfig): Promise<RecentProject[]> {
    return Promise.all(
      config.recent.map(async (p): Promise<RecentProject> => {
        const state = await inspectFolder(p);
        if (state === "legacy") return { path: p, name: path.basename(p), available: true };
        if (state !== "project") return { path: p, name: null, available: false };
        const r = await readProjectFile(p);
        return { path: p, name: r.ok ? r.project.name : path.basename(p), available: true };
      }),
    );
  }

  async status(): Promise<ProjectStatus> {
    const [c, config] = await Promise.all([this.current(), readUserConfig(this.opts.configFile)]);
    const base = {
      recent: this.locked ? [] : await this.recent(config),
      locked: this.locked,
      problem: c.problem,
      sample: c.status === "project" && c.sample === true,
      sampleAvailable: !this.locked && this.sampleDir !== null,
    };
    if (c.status === "none")
      return {
        ...base,
        status: "none",
        path: null,
        name: null,
        body: null,
        height_cm: null,
        canMigrate: false,
      };
    if (c.status === "legacy")
      return {
        ...base,
        status: "legacy",
        path: c.dir,
        name: path.basename(c.dir),
        body: null,
        height_cm: null,
        canMigrate: await hasLegacyConfig(this.opts.legacyConfigDir),
      };
    return {
      ...base,
      status: "project",
      path: c.dir,
      name: c.meta?.name ?? path.basename(c.dir),
      body: c.meta?.body ?? null,
      height_cm: c.meta?.height_cm ?? null,
      canMigrate: false,
    };
  }

  /** An absolute path from the page or the command line; `~` is expanded. */
  private folderArg(raw: unknown): string {
    if (typeof raw !== "string" || !raw.trim() || raw.includes("\0"))
      throw new HttpError(400, "path missing");
    const p = expandUser(raw.trim(), this.opts.home);
    if (!path.isAbsolute(p)) throw new HttpError(400, "the path must be absolute");
    return path.resolve(p);
  }

  private refuseWhenLocked() {
    if (this.locked)
      throw new HttpError(409, "This planner always opens the same folder (set in its start-up settings).");
  }

  private refuseWhenSample() {
    if (this.readOnly) throw new HttpError(409, SAMPLE_READ_ONLY);
  }

  private async remember(dir: string | null): Promise<void> {
    this.sampleOpen = false;
    const config = await readUserConfig(this.opts.configFile);
    await writeUserConfig(this.opts.configFile, {
      ...config,
      project: dir,
      recent: dir ? addRecent(config.recent, dir) : config.recent,
    });
  }

  open(raw: unknown): Promise<ProjectStatus> {
    return this.serial(async () => {
      this.refuseWhenLocked();
      const dir = this.folderArg(raw);
      const state = await inspectFolder(dir);
      if (state === "missing") throw new HttpError(404, `folder not found: ${dir}`);
      if (state !== "project" && state !== "legacy")
        throw new HttpError(
          400,
          "This folder is not a project. Choose a folder with a project.yaml, or create a new project.",
        );
      await this.remember(dir);
      return this.status();
    });
  }

  close(): Promise<ProjectStatus> {
    return this.serial(async () => {
      this.refuseWhenLocked();
      await this.remember(null);
      return this.status();
    });
  }

  /** Opens the sample shipped with the app, read-only. The remembered project stays in config.json. */
  openSample(): Promise<ProjectStatus> {
    return this.serial(async () => {
      this.refuseWhenLocked();
      if (!this.sampleDir || (await inspectFolder(this.sampleDir)) !== "project")
        throw new HttpError(404, "The sample project is not part of this installation.");
      this.sampleOpen = true;
      return this.status();
    });
  }

  /**
   * An empty or new folder for a new project: creates a missing one (its parent must exist) and
   * refuses a project, a file or a folder with other content. Returns the folder's state before.
   */
  private async newFolder(dir: string, allowLegacy: boolean): Promise<"empty" | "missing" | "legacy"> {
    const state = await inspectFolder(dir);
    if (state === "project") throw new HttpError(409, "This folder is a project already. Open it instead.");
    if (state === "file") throw new HttpError(400, "This is a file, not a folder.");
    if (state === "other" || (state === "legacy" && !allowLegacy))
      throw new HttpError(
        409,
        "This folder is not empty. Choose an empty folder or enter a new folder name.",
      );
    if (state === "missing") {
      try {
        await mkdir(dir);
      } catch (e) {
        const code = (e as NodeJS.ErrnoException).code;
        throw new HttpError(
          400,
          code === "ENOENT" ? "The parent folder does not exist." : `cannot create the folder: ${code}`,
        );
      }
    }
    return state;
  }

  /**
   * "Save as new project": copies the sample into an empty or new folder (placeholders become PNG
   * files there), with the chosen name and body, and opens the copy.
   */
  saveSampleAs(body: unknown): Promise<SaveSampleResult> {
    return this.serial(async () => {
      this.refuseWhenLocked();
      if (!this.sampleDir) throw new HttpError(404, "The sample project is not part of this installation.");
      const req = (body ?? {}) as { path?: unknown; name?: unknown; body?: unknown };
      const dir = this.folderArg(req.path);
      const fields = newProjectSchema.safeParse({ name: req.name, body: req.body });
      if (!fields.success) throw new HttpError(400, fields.error.issues.map((i) => i.message).join("; "));
      if (isInside(path.resolve(this.sampleDir), dir) || path.resolve(this.sampleDir) === dir)
        throw new HttpError(400, "Choose a folder outside the app.");
      await this.newFolder(dir, false);
      const copy = await copySample(this.sampleDir, dir, fields.data);
      await this.remember(dir);
      return { project: await this.status(), ...copy };
    });
  }

  /**
   * Makes a folder a project: an empty or new folder gets project.yaml, an empty manifest and the
   * standard sub-folders; an old data folder is moved into the project (migration). Any other folder
   * with content is refused, so a project never mixes with unrelated files.
   */
  create(body: unknown): Promise<CreateResult> {
    return this.serial(async () => {
      this.refuseWhenLocked();
      const req = (body ?? {}) as { path?: unknown; name?: unknown; body?: unknown };
      const dir = this.folderArg(req.path);
      const fields = newProjectSchema.safeParse({ name: req.name, body: req.body });
      if (!fields.success) throw new HttpError(400, fields.error.issues.map((i) => i.message).join("; "));
      const { name, body: kind } = fields.data;
      const state = await this.newFolder(dir, true);
      let migration: MigrationReport | null = null;
      if (state === "legacy") {
        migration = await migrateFolder(dir, { configDir: this.opts.legacyConfigDir, name, body: kind });
      } else {
        for (const f of PROJECT_FOLDERS) await mkdir(path.join(dir, f), { recursive: true });
        await writeFile(path.join(dir, MANIFEST_FILE), mergeManifest(null, []).text, { flag: "wx" });
        // A first, empty layout on the left arm, so the Layout tab has something to draw on.
        await writeFile(path.join(dir, "layouts", `${STARTER_LAYOUT}.yaml`), starterLayoutText(), {
          flag: "wx",
        });
        await writeFile(path.join(dir, PROJECT_FILE), newProjectText({ name, body: kind }), { flag: "wx" });
      }
      await this.remember(dir);
      return { project: await this.status(), migration };
    });
  }

  /** Changes name, body or height in project.yaml, keeping its comments and unknown keys. */
  update(body: unknown): Promise<ProjectStatus> {
    return this.serial(async () => {
      this.refuseWhenSample();
      const patch = projectPatchSchema.safeParse(body);
      if (!patch.success)
        throw new HttpError(
          400,
          patch.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
        );
      const c = await this.current();
      if (c.status === "none") throw new HttpError(409, "no project is open");
      if (c.status === "legacy") throw new HttpError(409, "Move this folder into a project first.");
      const file = path.join(c.dir, PROJECT_FILE);
      const original = await readFile(file, "utf8");
      let text: string;
      try {
        text = updateProjectText(original, patch.data);
      } catch (e) {
        throw new HttpError(409, e instanceof Error ? e.message : String(e));
      }
      if (text !== original) await atomicWrite(file, text);
      return this.status();
    });
  }

  /** "Move into project": copies the app's old config into the open legacy folder. */
  migrate(): Promise<{ project: ProjectStatus; migration: MigrationReport }> {
    return this.serial(async () => {
      this.refuseWhenSample();
      const c = await this.current();
      if (c.status !== "legacy")
        throw new HttpError(409, "Only an old data folder can be moved into a project.");
      const migration = await migrateFolder(c.dir, { configDir: this.opts.legacyConfigDir });
      return { project: await this.status(), migration };
    });
  }

  async readMeasurements(): Promise<string | null> {
    const { measurementsFile } = await this.paths();
    if (!measurementsFile) return null;
    try {
      return await readFile(measurementsFile, "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  }

  async writeMeasurements(text: string): Promise<void> {
    this.refuseWhenSample();
    const { measurementsFile } = await this.paths();
    if (!measurementsFile) throw new HttpError(409, "no project is open");
    await atomicWrite(measurementsFile, text);
  }
}
