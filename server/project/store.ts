// The current project (docs/adr/0012-project-folder.md): TATTOO_DATA_DIR wins; otherwise the folder
// remembered in the user config. Asked on every request, so opening a project takes effect at once.
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
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
  newPersonSchema,
  personPatchSchema,
  type RecentProject,
  type RemovePersonResult,
  type SaveSampleResult,
} from "../../src/project/schema.ts";
import {
  MAX_PERSONS,
  newPersonId,
  PERSON_FOLDERS,
  PERSONS_FOLDER,
  pickPerson,
  resolvePersons,
  ROOT_PERSON_ID,
  type PersonInfo,
} from "../../src/project/persons.ts";
import { newLayoutText } from "../../src/layout/yamlDoc.ts";
import {
  addPersonText,
  newProjectText,
  removePersonText,
  updatePersonText,
  updateProjectText,
} from "../../src/project/yamlDoc.ts";
import { expandUser } from "../dataDir.ts";
import { isInside } from "../assetsApi.ts";
import { HttpError } from "../http.ts";
import { inspectFolder, readProjectFile } from "./folder.ts";
import { hasLegacyConfig, MEASUREMENTS_FILE, migrateFolder } from "./migrate.ts";
import { copySample, SAMPLE_READ_ONLY } from "./sample.ts";
import { moveToTrash } from "./trash.ts";
import {
  addRecent,
  readUserConfig,
  rememberedPerson,
  withRememberedPerson,
  writeUserConfig,
  type UserConfig,
} from "./userConfig.ts";

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
  /** Where a deleted person's folder goes (server/project/trash.ts); injectable for tests. */
  platform?: NodeJS.Platform;
};

/**
 * Where the open project keeps each kind of data; all null when none is open. Layouts, projections
 * and measurements are the current person's (docs/adr/0017-persons.md); `dir` is the project.
 */
export type ProjectPaths = {
  dir: string | null;
  /** The current person's folder: the project itself for the root person, else persons/<id>. */
  personDir: string | null;
  /** The current person's id; null without a readable project.yaml. */
  person: string | null;
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
      /** Everyone in the project and the one shown; empty and null when project.yaml is broken. */
      persons: PersonInfo[];
      person: PersonInfo | null;
    };

export const STARTER_LAYOUT = "first-sketch";

function starterLayoutText(): string {
  return newLayoutText({ name: STARTER_LAYOUT, region: "arm-left", elements: [] });
}

const NO_PATHS: ProjectPaths = {
  dir: null,
  personDir: null,
  person: null,
  layoutsDir: null,
  projectionsDir: null,
  measurementsFile: null,
  readOnly: false,
};

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

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
  /** The person shown in the sample (memory only, like the sample itself). */
  private samplePerson: string | null = null;

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

  /**
   * Whether the sample project is open (and so every write is refused). It can be opened even when
   * TATTOO_DATA_DIR fixes the project: it is never remembered, and closing it returns to that folder.
   */
  get readOnly(): boolean {
    return this.sampleOpen && this.sampleDir !== null;
  }

  private async current(): Promise<Current> {
    const { envDir } = this.opts;
    if (this.readOnly) {
      const sample = await this.projectAt(this.sampleDir!, this.samplePerson);
      return sample.status === "project" ? { ...sample, sample: true } : sample;
    }
    if (envDir) {
      const state = await inspectFolder(envDir);
      if (state === "missing" || state === "file")
        return { status: "none", problem: `The project folder was not found: ${envDir}` };
      // Any other folder named by TATTOO_DATA_DIR is an old data folder, as before projects existed.
      if (state !== "project") return { status: "legacy", dir: envDir, problem: null };
      return this.projectAt(envDir, rememberedPerson(await readUserConfig(this.opts.configFile), envDir));
    }
    const config = await readUserConfig(this.opts.configFile);
    if (!config.project) return { status: "none", problem: null };
    const state = await inspectFolder(config.project);
    if (state === "project") return this.projectAt(config.project, rememberedPerson(config, config.project));
    if (state === "legacy") return { status: "legacy", dir: config.project, problem: null };
    return {
      status: "none",
      problem:
        state === "missing"
          ? `The last project folder is not available: ${config.project}`
          : `The last project folder is no longer a project: ${config.project}`,
    };
  }

  private async projectAt(dir: string, remembered: string | null): Promise<Current> {
    const r = await readProjectFile(dir);
    if (!r.ok) return { status: "project", dir, meta: null, problem: r.error, persons: [], person: null };
    const persons = resolvePersons(r.project);
    const person = pickPerson(persons, remembered);
    return { status: "project", dir, meta: r.project, problem: null, persons, person };
  }

  async paths(): Promise<ProjectPaths> {
    const c = await this.current();
    if (c.status === "none") return NO_PATHS;
    const legacy = c.status === "legacy" ? this.opts.legacyConfigDir : null;
    const person = c.status === "project" ? c.person : null;
    // A legacy folder keeps using the app's config/ until it is moved into the project; a person
    // other than the root keeps their data in persons/<id>/.
    const base = legacy ?? (person && !person.root ? path.join(c.dir, ...person.folder.split("/")) : c.dir);
    return {
      dir: c.dir,
      personDir: base,
      person: person?.id ?? null,
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

  /** Everyone in the open project (empty for a legacy folder or a broken project.yaml). */
  async persons(): Promise<PersonInfo[]> {
    const c = await this.current();
    return c.status === "project" ? c.persons : [];
  }

  async status(): Promise<ProjectStatus> {
    const [c, config] = await Promise.all([this.current(), readUserConfig(this.opts.configFile)]);
    const base = {
      recent: this.locked ? [] : await this.recent(config),
      locked: this.locked,
      problem: c.problem,
      sample: c.status === "project" && c.sample === true,
      sampleAvailable: this.sampleDir !== null,
    };
    if (c.status === "none")
      return {
        ...base,
        status: "none",
        path: null,
        name: null,
        body: null,
        height_cm: null,
        persons: [],
        person: null,
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
        persons: [],
        person: null,
        canMigrate: await hasLegacyConfig(this.opts.legacyConfigDir),
      };
    return {
      ...base,
      status: "project",
      path: c.dir,
      name: c.meta?.name ?? path.basename(c.dir),
      // The current person's body and height: the rest of the page reads them from here.
      body: c.person ? c.person.body : (c.meta?.body ?? null),
      height_cm: c.person ? c.person.height_cm : (c.meta?.height_cm ?? null),
      persons: c.persons,
      person: c.person?.id ?? null,
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
    this.samplePerson = null;
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
      // Leaving the sample returns to the project open before it (the remembered or the fixed
      // folder; the start screen when there was none), so that works even when locked.
      if (this.readOnly) {
        this.sampleOpen = false;
        this.samplePerson = null;
        return this.status();
      }
      this.refuseWhenLocked();
      await this.remember(null);
      return this.status();
    });
  }

  /** Opens the sample shipped with the app, read-only. The remembered project stays in config.json. */
  openSample(): Promise<ProjectStatus> {
    return this.serial(async () => {
      if (!this.sampleDir || (await inspectFolder(this.sampleDir)) !== "project")
        throw new HttpError(404, "The sample project is not part of this installation.");
      this.sampleOpen = true;
      this.samplePerson = null;
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
      const c = await this.openProject();
      await this.editProjectFile(c.dir, (t) => updateProjectText(t, patch.data, c.person.id));
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

  /** The open project with a readable project.yaml, or a 409 that says why there is none. */
  private async openProject(): Promise<{
    dir: string;
    meta: ProjectMeta;
    persons: PersonInfo[];
    person: PersonInfo;
  }> {
    const c = await this.current();
    if (c.status === "none") throw new HttpError(409, "no project is open");
    if (c.status === "legacy") throw new HttpError(409, "Move this folder into a project first.");
    if (!c.meta || !c.person) throw new HttpError(409, c.problem ?? `${PROJECT_FILE} cannot be read`);
    return { dir: c.dir, meta: c.meta, persons: c.persons, person: c.person };
  }

  /** Rewrites project.yaml through `edit` (comments kept); a refused edit is a 409 with its reason. */
  private async editProjectFile(dir: string, edit: (text: string) => string): Promise<void> {
    const file = path.join(dir, PROJECT_FILE);
    const original = await readFile(file, "utf8");
    let text: string;
    try {
      text = edit(original);
    } catch (e) {
      throw new HttpError(409, e instanceof Error ? e.message : String(e));
    }
    if (text !== original) await atomicWrite(file, text);
  }

  private async rememberPerson(dir: string, id: string | null): Promise<void> {
    if (this.readOnly) {
      this.samplePerson = id;
      return;
    }
    const config = await readUserConfig(this.opts.configFile);
    await writeUserConfig(this.opts.configFile, withRememberedPerson(config, dir, id));
  }

  /** Shows another person of the open project (allowed in the sample: it changes no file). */
  selectPerson(id: string): Promise<ProjectStatus> {
    return this.serial(async () => {
      const c = await this.openProject();
      if (!c.persons.some((p) => p.id === id)) throw new HttpError(404, `no person ${id} in this project`);
      await this.rememberPerson(c.dir, id === ROOT_PERSON_ID ? null : id);
      return this.status();
    });
  }

  /**
   * Adds a person with an own folder (persons/<id>/ with layouts/, projections/, photos/) and shows
   * them. The id comes from the name and never reuses a folder that is already there.
   */
  addPerson(body: unknown): Promise<ProjectStatus> {
    return this.serial(async () => {
      this.refuseWhenSample();
      const fields = newPersonSchema.safeParse(body);
      if (!fields.success) throw new HttpError(400, fields.error.issues.map((i) => i.message).join("; "));
      const { name, body: kind, height_cm } = fields.data;
      if (!name.trim()) throw new HttpError(400, "name is empty");
      const c = await this.openProject();
      if (c.persons.length >= MAX_PERSONS)
        throw new HttpError(409, `A project holds at most ${MAX_PERSONS} persons.`);
      const taken = c.persons.map((p) => p.id);
      let id = newPersonId(name, taken);
      // A folder left behind (e.g. restored from the trash by hand) is never taken over.
      while (await exists(path.join(c.dir, PERSONS_FOLDER, id))) {
        taken.push(id);
        id = newPersonId(name, taken);
      }
      await this.editProjectFile(c.dir, (t) => addPersonText(t, { id, name, body: kind, height_cm }));
      for (const f of PERSON_FOLDERS)
        await mkdir(path.join(c.dir, PERSONS_FOLDER, id, f), { recursive: true });
      await this.rememberPerson(c.dir, id);
      return this.status();
    });
  }

  /** Renames a person or changes their body or height (the root person's are project.yaml's top level). */
  updatePerson(id: string, body: unknown): Promise<ProjectStatus> {
    return this.serial(async () => {
      this.refuseWhenSample();
      const patch = personPatchSchema.safeParse(body);
      if (!patch.success) throw new HttpError(400, patch.error.issues.map((i) => i.message).join("; "));
      const c = await this.openProject();
      if (!c.persons.some((p) => p.id === id)) throw new HttpError(404, `no person ${id} in this project`);
      await this.editProjectFile(c.dir, (t) => updatePersonText(t, id, patch.data));
      return this.status();
    });
  }

  /**
   * Removes a person: their entry leaves project.yaml and their folder goes to the system trash
   * (server/project/trash.ts), never deleted outright. The root person's data is the project itself
   * and cannot be removed.
   */
  removePerson(id: string): Promise<RemovePersonResult> {
    return this.serial(async () => {
      this.refuseWhenSample();
      const c = await this.openProject();
      const person = c.persons.find((p) => p.id === id);
      if (!person) throw new HttpError(404, `no person ${id} in this project`);
      if (person.root)
        throw new HttpError(
          409,
          "The first person's data is the project folder itself; rename them instead.",
        );
      const folder = path.join(c.dir, ...person.folder.split("/"));
      let movedTo: string | null = null;
      if (await exists(folder))
        movedTo = await moveToTrash(folder, `${id} (${c.meta.name})`, {
          home: this.opts.home,
          projectDir: c.dir,
          platform: this.opts.platform,
        });
      await this.editProjectFile(c.dir, (t) => removePersonText(t, id));
      if (c.person.id === id) await this.rememberPerson(c.dir, null);
      return { project: await this.status(), movedTo };
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
