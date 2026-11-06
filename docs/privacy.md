# Privacy

The Tattoo Planner is a local tool. This page lists everything it stores, where, and the two cases in which it sends anything over the network, both only to OpenAI and only with your own key.

## Everything stays on your computer

- **Your project** (layouts, measurements, projections, images, photos, Image studio results and exports) lives in the project folder you chose, and nowhere else. The planner reads and writes only inside that folder. If the folder is in iCloud Drive, Seafile or another synced folder, that service syncs it under its own terms; the planner itself uploads nothing.
- **The planner's own settings** are the open project, the list of recent projects and whether the key check at start is on: `~/Library/Application Support/Tattoo Planner/config.json` in the desktop app, `~/.config/tattoo-planner/config.json` (or `$XDG_CONFIG_HOME/tattoo-planner/config.json`) when run from git.
- **The sample project** ships with the app and is never written to. Its images are drawn by the planner; they become files only when you save the sample as a new project, in the folder you pick.

## The local server

The planner consists of a page and a small server that reads and writes the project folder. The server listens on `127.0.0.1` only, so other computers on your network cannot reach it. It also refuses requests whose `Host` header is not that address (DNS rebinding) and writes from other web sites (cross-site requests). The desktop app runs the server inside the app on a random free port, loads nothing from the internet (every request of its window to another address is blocked) and opens web links in your normal browser.

Fonts and libraries are bundled with the planner, so the page loads no web fonts, scripts or images from elsewhere.

## No telemetry

There are no accounts, no analytics, no crash reports, no usage statistics and no update check. The planner does not contact any server of its authors.

## Image generation with OpenAI (optional, bring your own key)

The only data that ever leaves your computer is a **generative edit you start yourself** in the Image studio, plus the key check described below (Generative engine, or Create new). Nothing is sent when you open the Image studio, browse images or use the built-in operations (background removal, line art, levels, rotate …), which run in the planner itself.

When you click the button that runs a generative edit, the planner's server sends one request per variant to OpenAI's Images API (`api.openai.com/v1/images/edits`, or `/v1/images/generations` for a new image from text alone) with:

- the image you are editing (a copy of the version shown, under a generic file name such as `input.png`);
- the reference images you added with **+** (up to four, also under generic names such as `ref-1.png`);
- your instruction, plus the planner's fixed wording around it; when you add references, the prompt names each by its asset id and notes;
- the settings of the request: model, size, quality, background and input fidelity.

Your project folder's other files, your measurements, layouts and file paths are not sent. OpenAI's handling of the request is governed by your agreement with OpenAI and its [API data usage policies](https://openai.com/policies/api-data-usage-policies). Each variant shows a rough cost before you keep it; each request is billed to your OpenAI account.

## Key check (no images)

The planner checks an OpenAI key so that a broken one shows up before you try a generative edit:

- **When:** when you save a key in Settings → Image generation, when you press **Test key**, and **once per start** of the planner (the server checks the first time the page asks, then remembers the answer until it is restarted). Without a key nothing is checked.
- **What is sent:** one `GET https://api.openai.com/v1/models/<image model>` request (for example `/v1/models/gpt-image-2.5-sunburst`) with the key in the `Authorization` header. No image, no prompt, no file name, no project data. It does not create anything and costs nothing.
- **What comes back:** whether OpenAI accepted the key and lets it use the image model. If the key was rejected, has no access to the model or the account has no credit, the planner shows a notice saying that the generative features of the Image studio won't work until the key is fixed. If OpenAI cannot be reached (offline), it says so instead; that does not mean the key is broken.
- **Turning it off:** Settings → Image generation → **Startup check** → "Check the key when the planner starts". The choice is stored in the planner's settings file (`openaiStartupCheck: false` in `config.json`, above). With it off, nothing is sent until you save or test a key or run a generative edit.

## Where the API key is stored

- **Desktop app:** you enter the key in Settings → Image generation. The app encrypts it with Electron's `safeStorage`, whose encryption key is kept in the macOS Keychain ("Tattoo Planner Safe Storage"), and stores the encrypted key in `~/Library/Application Support/Tattoo Planner/openai-key.bin`. The key stays in the app's main process: the page never reads it back, and it is only sent to OpenAI, with the requests above. **Remove** in the same place deletes it.
- **Run from git:** you can enter the key in Settings → Image generation too. The planner's server then saves it as plain text in `~/.config/tattoo-planner/openai-key` (or under `$XDG_CONFIG_HOME`), readable only by your user account (file mode 0600), next to the settings file; **Remove** deletes that file. Otherwise the key is read from the environment or from the git-ignored `.env` file in the checkout (`TATTOO_OPENAI_API_KEY`). A key saved in Settings wins over the one in `.env`; the planner never writes, changes or empties `.env`, so removing the saved key falls back to it. Either way the key stays in the server process and is only sent to OpenAI.
- **The page never sees the key:** after you save it, Settings shows only where it comes from ("from .env", "saved in the macOS Keychain", …) and its last four characters.

Without a key, generative edits are off and everything else works the same.
