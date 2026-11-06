// Builds the API context from the environment: shared by vite.config.ts, server/standalone.ts and
// the scripts, so every way of starting the planner resolves the project the same way.
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseEnv } from "node:util";
import type { ApiContext } from "./api.ts";
import { resolveDataDir } from "./dataDir.ts";
import { SAMPLE_FOLDER } from "./project/sample.ts";
import { ProjectStore } from "./project/store.ts";
import { userConfigFile } from "./project/userConfig.ts";
import { settingsFromEnv, type Env, type KeyProvider } from "./settings.ts";
import { defaultTrasher, systemTrasher } from "./trash.ts";

/** The checkout's git-ignored .env merged under the shell environment (the shell wins), as Vite does. */
export function readEnv(root: string, shell: Env = process.env): Env {
  const file = path.join(root, ".env");
  const fromFile = existsSync(file) ? parseEnv(readFileSync(file, "utf8")) : {};
  return { ...fromFile, ...shell };
}

export type ContextOptions = {
  env: Env;
  /** The app folder (the git checkout): relative TATTOO_DATA_DIR values and the legacy config/. */
  root: string;
  /** Defaults: os.homedir() and userConfigFile(env, home); tests pass temp paths. */
  home?: string;
  configFile?: string;
  /** The read-only sample project; default <root>/samples/demo when it exists. */
  sampleDir?: string | null;
  /** The desktop shell's Keychain key; wins over TATTOO_OPENAI_API_KEY when it returns one. */
  openaiKey?: KeyProvider;
  /** The desktop shell's system Trash (Electron shell.trashItem); default: defaultTrasher in server/trash.ts. */
  trashItem?: (file: string) => Promise<void>;
};

export function createContext({
  env,
  root,
  home = os.homedir(),
  configFile,
  sampleDir,
  openaiKey,
  trashItem,
}: ContextOptions): ApiContext {
  const legacyConfigDir = path.join(root, "config");
  // Resolved against the app folder, never the working directory: in the desktop app that is app.asar.
  const bundledSample = path.join(root, SAMPLE_FOLDER);
  const projects = new ProjectStore({
    envDir: resolveDataDir(env, root, home),
    configFile: configFile ?? userConfigFile(env, home),
    home,
    legacyConfigDir: existsSync(legacyConfigDir) ? legacyConfigDir : null,
    sampleDir: sampleDir !== undefined ? sampleDir : existsSync(bundledSample) ? bundledSample : null,
  });
  return {
    projects,
    home,
    settings: settingsFromEnv(env, openaiKey),
    trash: trashItem ? systemTrasher(trashItem) : defaultTrasher(process.platform, home),
  };
}
