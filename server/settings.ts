// Server settings that come from the environment (shell or the git-ignored .env of a checkout).
// The desktop shell will fill the same shape from its own settings store.
import { openaiSettingsFromEnv, type OpenAISettings } from "../src/edits/openai.ts";

export type Env = Record<string, string | undefined>;

export type ServerSettings = {
  /** Generative edits; null when no OpenAI key is set. */
  openai: OpenAISettings | null;
};

/**
 * TATTOO_OPENAI_API_KEY (or OPENAI_API_KEY), TATTOO_OPENAI_MODEL, TATTOO_OPENAI_FIDELITY,
 * TATTOO_OPENAI_QUALITY.
 */
export function settingsFromEnv(env: Env): ServerSettings {
  return { openai: openaiSettingsFromEnv(env) };
}
