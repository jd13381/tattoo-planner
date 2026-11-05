// Server settings that come from the environment (shell or the git-ignored .env of a checkout), plus
// an optional key provider: the desktop shell keeps the OpenAI key in the Keychain and hands it over
// at runtime (docs/adr/0014-desktop-app.md), so a key saved in the app works without a restart.
import { openaiSettingsFromEnv, type OpenAISettings } from "../src/edits/openai.ts";

export type Env = Record<string, string | undefined>;

export type ServerSettings = {
  /** Generative edits; null when no OpenAI key is set. Read on every use, so it may change at runtime. */
  readonly openai: OpenAISettings | null;
};

/** The OpenAI key from another store (the desktop app's Keychain file); null when none is stored. */
export type KeyProvider = () => string | null;

/**
 * TATTOO_OPENAI_API_KEY (or OPENAI_API_KEY), TATTOO_OPENAI_MODEL, TATTOO_OPENAI_FIDELITY,
 * TATTOO_OPENAI_QUALITY. With `openaiKey`, a key it returns wins over the environment's; model and
 * options still come from the environment.
 */
export function settingsFromEnv(env: Env, openaiKey?: KeyProvider): ServerSettings {
  if (!openaiKey) {
    const openai = openaiSettingsFromEnv(env);
    return { openai };
  }
  return {
    get openai() {
      const key = openaiKey()?.trim();
      return key
        ? openaiSettingsFromEnv({ ...env, TATTOO_OPENAI_API_KEY: key, OPENAI_API_KEY: undefined })
        : openaiSettingsFromEnv(env);
    },
  };
}
