// How to get an OpenAI API key, for people who have never used a developer platform (Jan, 2026-11-15).
// The same steps and prompt appear in Settings → Image generation (KeyGuide.tsx) and in
// docs/openai-key.md; tests/keyGuide.test.ts keeps the document in step with this module.
// OpenAI changes its platform now and then, so the steps are dated and the prompt lets any AI
// assistant produce current instructions.

/** When the steps below were last checked against platform.openai.com. */
export const KEY_GUIDE_CHECKED = "November 2026";

/** Where the keys are created. */
export const KEY_GUIDE_URL = "https://platform.openai.com/api-keys";

/** The short version of the steps, one sentence each. */
export const KEY_GUIDE_STEPS: readonly string[] = [
  "Sign in at platform.openai.com with an OpenAI account (a ChatGPT login works). The API is billed separately: a ChatGPT Plus or Pro subscription does not include API credit.",
  "Under Settings → Billing, add a payment method and buy a little prepaid credit (5 USD is plenty to start; one image costs a few cents). Under Limits you can set a monthly budget.",
  "If OpenAI asks you to verify your organization before its image models work, follow the ID check under Settings → Organization → General.",
  "Open API keys, click “Create new secret key”, name it “Tattoo Planner” and copy it. OpenAI shows it only once.",
  "Paste it here under API key and click “Check & save”. The planner keeps it on this computer and sends it only to OpenAI.",
];

/** A prompt for any AI assistant (ChatGPT, Claude, Gemini, …) that returns current, step-by-step instructions. */
export const KEY_GUIDE_PROMPT = [
  "I want to use my own OpenAI API key in a desktop app that creates and edits images with OpenAI's GPT Image models. I'm not technical.",
  "Please give me current, step-by-step instructions for:",
  "1. Signing in to the OpenAI API platform (platform.openai.com), and how it differs from a ChatGPT subscription.",
  "2. Adding a payment method and a small amount of prepaid credit, and setting a monthly spending limit.",
  "3. Any verification OpenAI requires before its image models can be used through the API.",
  "4. Creating a secret API key and copying it.",
  "Name the exact buttons and menus to click, tell me which steps cost money, and remind me never to share the key or paste it into a chat, including this one. If you can browse the web, check OpenAI's current help pages first, because the platform changes from time to time.",
].join("\n");
