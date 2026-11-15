# Get an OpenAI API key

The Image studio's generative engine (GPT Image) runs on **your own OpenAI API key**: you pay OpenAI directly, a few cents per image, and nobody else sees your images. Everything else in the planner works without a key.

## The steps (checked in November 2026)

1. Sign in at platform.openai.com with an OpenAI account (a ChatGPT login works). The API is billed separately: a ChatGPT Plus or Pro subscription does not include API credit.
2. Under Settings → Billing, add a payment method and buy a little prepaid credit (5 USD is plenty to start; one image costs a few cents). Under Limits you can set a monthly budget.
3. If OpenAI asks you to verify your organization before its image models work, follow the ID check under Settings → Organization → General.
4. Open API keys, click “Create new secret key”, name it “Tattoo Planner” and copy it. OpenAI shows it only once.
5. Paste it here under API key and click “Check & save”. The planner keeps it on this computer and sends it only to OpenAI.

Where to paste it: in the desktop app and in a planner run from git, **Settings → Image generation → API key**. From a checkout you can also put `TATTOO_OPENAI_API_KEY=sk-…` into a `.env` file next to `package.json`.

## If the steps no longer match

OpenAI changes its platform now and then. Copy this prompt into any AI assistant (ChatGPT, Claude, Gemini, …) and it will walk you through the current steps. The same prompt is in the app under **Settings → Image generation → How do I get a key?**, with a copy button.

```text
I want to use my own OpenAI API key in a desktop app that creates and edits images with OpenAI's GPT Image models. I'm not technical.
Please give me current, step-by-step instructions for:
1. Signing in to the OpenAI API platform (platform.openai.com), and how it differs from a ChatGPT subscription.
2. Adding a payment method and a small amount of prepaid credit, and setting a monthly spending limit.
3. Any verification OpenAI requires before its image models can be used through the API.
4. Creating a secret API key and copying it.
Name the exact buttons and menus to click, tell me which steps cost money, and remind me never to share the key or paste it into a chat, including this one. If you can browse the web, check OpenAI's current help pages first, because the platform changes from time to time.
```

## Keep the key safe

- Treat it like a password: never post it, send it or paste it into a chat (including an AI assistant).
- If it leaks, delete it under API keys on platform.openai.com and create a new one.
- A monthly budget under Settings → Billing → Limits caps what a leaked key could cost.

What the planner sends to OpenAI, and when: [privacy.md](privacy.md).
