// Server settings that come from the environment (shell or the git-ignored .env of a checkout), plus
// the OpenAI key from up to three places (docs/adr/0016-openai-key-check.md), first match wins:
//   1. the desktop app's Keychain key, handed over by a key provider (docs/adr/0015-desktop-app.md);
//   2. a key saved in Settings when the planner runs from git: a 0600 file next to the user config
//      (~/.config/tattoo-planner/openai-key); the planner writes only this file, never .env;
//   3. TATTOO_OPENAI_API_KEY (or OPENAI_API_KEY) from the shell or .env.
// Every source is read on use, so a key saved at runtime works without a restart.
import { readFileSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { keyProblem, type KeySource } from "../src/edits/keyCheck.ts";
import { openaiSettingsFromEnv, type OpenAISettings } from "../src/edits/openai.ts";
import { readUserConfig, writeUserConfig } from "./project/userConfig.ts";

export type Env = Record<string, string | undefined>;

/** The OpenAI key from another store (the desktop app's Keychain file); null when none is stored. */
export type KeyProvider = () => string | null;

export type { KeySource };

/** File name of the key saved in Settings (run from git), next to the user config. */
export const SAVED_KEY_FILE = "openai-key";
/** Key in the user config (config.json) that turns the startup check off. */
export const STARTUP_CHECK_CONFIG_KEY = "openaiStartupCheck";

export type OpenAIKeysOptions = {
  env: Env;
  /** The shell environment, to tell a key from .env from one exported in the shell. */
  shell?: Env;
  /** The desktop app's key; when set, the planner never writes a key file of its own. */
  desktop?: KeyProvider;
  /** The key file for keys saved in Settings; null: saving is off (desktop app, scripts). */
  file?: string | null;
  /** The user config (config.json) that keeps the startup-check switch; null: always on. */
  configFile?: string | null;
};

function readKeyFile(file: string | null): string | null {
  if (!file) return null;
  try {
    return readFileSync(file, "utf8").trim() || null;
  } catch {
    return null;
  }
}

export class OpenAIKeys {
  private readonly env: Env;
  private readonly shell: Env;
  private readonly desktop: KeyProvider | null;
  readonly file: string | null;
  private readonly configFile: string | null;
  /** The saved key in memory, read once at start and on every change through this object. */
  private saved: string | null;

  constructor(opts: OpenAIKeysOptions) {
    this.env = opts.env;
    this.shell = opts.shell ?? process.env;
    this.desktop = opts.desktop ?? null;
    this.file = this.desktop ? null : (opts.file ?? null);
    this.configFile = opts.configFile ?? null;
    this.saved = readKeyFile(this.file);
  }

  /** The key from the environment (.env or shell), or null. */
  envKey(): { key: string; source: KeySource } | null {
    const name = this.env.TATTOO_OPENAI_API_KEY?.trim() ? "TATTOO_OPENAI_API_KEY" : "OPENAI_API_KEY";
    const key = this.env[name]?.trim();
    if (!key) return null;
    // Vite and readEnv() merge .env under the shell, so a key the shell has too came from the shell.
    return { key, source: this.shell[name]?.trim() === key ? "environment" : "env-file" };
  }

  /** The key in use and where it comes from, or null when none is set anywhere. */
  current(): { key: string; source: KeySource } | null {
    const desktop = this.desktop?.()?.trim();
    if (desktop) return { key: desktop, source: "desktop" };
    if (this.saved) return { key: this.saved, source: "saved" };
    return this.envKey();
  }

  /** Model and options always come from the environment; the key from current(). */
  settings(): OpenAISettings | null {
    const c = this.current();
    if (!c) return null;
    return openaiSettingsFromEnv({ ...this.env, TATTOO_OPENAI_API_KEY: c.key, OPENAI_API_KEY: undefined });
  }

  /** The image model a key is checked against (the one generative edits use). */
  model(): string {
    return openaiSettingsFromEnv({ ...this.env, TATTOO_OPENAI_API_KEY: "sk-model" })!.model;
  }

  /** Keys can be saved in Settings through the server (run from git); the desktop app uses its Keychain. */
  get canSave(): boolean {
    return this.file !== null;
  }

  /** Writes the key to the key file: owner-only (0600), replaced atomically. Never touches .env. */
  async save(key: unknown): Promise<void> {
    if (!this.file) throw new Error("This planner keeps its key elsewhere.");
    const problem = keyProblem(key);
    if (problem) throw new Error(problem);
    const k = (key as string).trim();
    await mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const tmp = `${this.file}.tmp-${process.pid}`;
    await writeFile(tmp, `${k}\n`, { mode: 0o600 });
    await rename(tmp, this.file);
    this.saved = k;
  }

  /** Deletes the saved key; a key from .env or the shell is used again (and is never removed). */
  async remove(): Promise<void> {
    if (!this.file) throw new Error("This planner keeps its key elsewhere.");
    await rm(this.file, { force: true });
    this.saved = null;
  }

  /** Whether the startup check runs (default on). */
  async startupCheckEnabled(): Promise<boolean> {
    if (!this.configFile) return true;
    return (await readUserConfig(this.configFile))[STARTUP_CHECK_CONFIG_KEY] !== false;
  }

  async setStartupCheck(enabled: boolean): Promise<void> {
    if (!this.configFile) throw new Error("This planner has no settings file.");
    const config = await readUserConfig(this.configFile);
    await writeUserConfig(this.configFile, { ...config, [STARTUP_CHECK_CONFIG_KEY]: enabled });
  }

  /** Re-reads the key file (tests; a file changed by hand). */
  async reload(): Promise<void> {
    if (!this.file) return;
    try {
      this.saved = (await readFile(this.file, "utf8")).trim() || null;
    } catch {
      this.saved = null;
    }
  }
}

export type ServerSettings = {
  /** Generative edits; null when no OpenAI key is set. Read on every use, so it may change at runtime. */
  readonly openai: OpenAISettings | null;
  /** Where the key comes from, saving one from Settings, and the startup-check switch. */
  readonly keys: OpenAIKeys;
};

/**
 * TATTOO_OPENAI_API_KEY (or OPENAI_API_KEY), TATTOO_OPENAI_MODEL, TATTOO_OPENAI_FIDELITY,
 * TATTOO_OPENAI_QUALITY. With `openaiKey`, a key it returns wins over the environment's; model and
 * options still come from the environment. `opts` adds the saved-key file and the user config.
 */
export function settingsFromEnv(
  env: Env,
  openaiKey?: KeyProvider,
  opts: Pick<OpenAIKeysOptions, "file" | "configFile" | "shell"> = {},
): ServerSettings {
  const keys = new OpenAIKeys({ env, desktop: openaiKey, ...opts });
  return {
    get openai() {
      return keys.settings();
    },
    keys,
  };
}
