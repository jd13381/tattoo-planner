import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  KEY_GUIDE_CHECKED,
  KEY_GUIDE_PROMPT,
  KEY_GUIDE_STEPS,
  KEY_GUIDE_URL,
} from "../src/settings/keyGuide.ts";

const doc = readFileSync(new URL("../docs/openai-key.md", import.meta.url), "utf8");

describe("OpenAI key guide", () => {
  it("keeps docs/openai-key.md in step with the app", () => {
    expect(doc).toContain(KEY_GUIDE_PROMPT);
    expect(doc).toContain(`checked in ${KEY_GUIDE_CHECKED}`);
    for (const [i, step] of KEY_GUIDE_STEPS.entries()) expect(doc).toContain(`${i + 1}. ${step}`);
  });

  it("asks for current steps and warns about sharing the key", () => {
    expect(KEY_GUIDE_PROMPT).toMatch(/platform\.openai\.com/);
    expect(KEY_GUIDE_PROMPT).toMatch(/never to share the key/);
    expect(KEY_GUIDE_PROMPT).not.toMatch(/sk-/);
    expect(KEY_GUIDE_URL).toBe("https://platform.openai.com/api-keys");
  });
});
