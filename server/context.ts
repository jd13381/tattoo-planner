// Builds the API context from the environment: shared by vite.config.ts, server/standalone.ts and
// the scripts, so every way of starting the planner resolves the project the same way.
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseEnv } from "node:util";
import type { ApiContext } from "./api.ts";
import { resolveDataDir } from "./dataDir.ts";
import { ProjectStore } from "./project/store.ts";
import { userConfigFile } from "./project/userConfig.ts";
import { settingsFromEnv, type Env } from "./settings.ts";

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
};

export function createContext({ env, root, home = os.homedir(), configFile }: ContextOptions): ApiContext {
  const legacyConfigDir = path.join(root, "config");
  const projects = new ProjectStore({
    envDir: resolveDataDir(env, root, home),
    configFile: configFile ?? userConfigFile(env, home),
    home,
    legacyConfigDir: existsSync(legacyConfigDir) ? legacyConfigDir : null,
  });
  return { projects, home, settings: settingsFromEnv(env) };
}
