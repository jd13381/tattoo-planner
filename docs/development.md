# Development

For people who run the planner from a checkout or work on it. Start: [README](../README.md); features: [usage.md](usage.md); Jan's own sleeve: [jans-sleeve.md](jans-sleeve.md).

Technical decisions live in `docs/adr/`, the product plan in `docs/product/roadmap.md`; `PROJECT_BRIEF.md` is the original brief for Jan's own sleeve. Decisions Claude made without Jan are listed in `docs/claude-decisions.md` for review.

## Setup

```sh
npm ci            # install (install scripts are disabled by .npmrc)
npm run hooks     # enable the pre-commit guard (once per clone)
npm run dev       # http://127.0.0.1:4320
```

Without a project the planner opens a start screen: create a project (name, body, a folder picked in the in-browser folder dialog, which only shows folders inside your home folder) or open an existing one. The open project and the recent ones are remembered in `~/.config/tattoo-planner/config.json` (`$XDG_CONFIG_HOME/tattoo-planner/config.json` when that is set). The desktop app uses the native folder dialog instead.

**Data stays out of git.** Images, PDFs and exports are rejected by `.gitignore`, by the pre-commit guard (`scripts/check-binaries.mjs`) and by CI. The sample project in `samples/demo/` is YAML only; its placeholders are drawn at runtime (`src/sample/placeholders.ts`) and only become PNG files in a folder the user picks with **Save as new project**.

## Settings for git users

The planner opens the project you last chose. To pin it to one folder instead (Jan's Seafile folder, CI), set `TATTOO_DATA_DIR` in the shell or in a git-ignored `.env` (`cp .env.example .env`); it wins over the remembered project, and switching or closing projects is then disabled. Quote the path when it contains spaces; `~` is expanded:

```sh
TATTOO_DATA_DIR="~/Your Secure Cloud/<library>/tattoo-planner-data"
```

The only other settings are optional and for generative edits in the Image studio: `TATTOO_OPENAI_API_KEY` and, rarely needed, `TATTOO_OPENAI_MODEL`, `TATTOO_OPENAI_FIDELITY`, `TATTOO_OPENAI_QUALITY` (see `.env.example`). In the desktop app the key is entered in Settings → Image generation instead.

## Older data folders and `npm run migrate` (Jan's workflow)

An older data folder (with `manifest.yaml` but no `project.yaml`, such as Jan's) still opens: its images in `refs/`, `cards/`, `existing/`, `arm-photos/` and `ideas/` keep working, and its layouts, projections and measurements keep coming from this repo's `config/` until you press **Move into project** in Settings → Project or run `npm run migrate -- <folder>`. Both copy `config/layouts/*`, `config/projections/*` and `config/measurements.yaml` into the folder (never overwriting) and write `project.yaml`; afterwards the repo's `config/` is no longer read for it.

Jan's own move: [jans-sleeve.md](jans-sleeve.md).

## Desktop app from a checkout

The desktop app (Electron, `desktop/`, docs/adr/0015-desktop-app.md) runs the same server and page as `npm run serve` in its own window. The project choice is remembered in the app's settings folder (`~/Library/Application Support/Tattoo Planner/` on macOS) instead of `~/.config/tattoo-planner/`, and the OpenAI key is entered in Settings → Image generation: it is encrypted with the macOS Keychain (Electron `safeStorage`), stays in the app's main process and is sent only to OpenAI, with a generative edit you start. `TATTOO_DATA_DIR` and a checkout's `.env` still work when the app is started from git.

From a checkout:

```sh
npm run desktop     # builds the page and the shell, then opens the app
```

The first launch downloads the Electron binary for your platform (about 100 MB; Electron no longer uses an install script, so `.npmrc`'s `ignore-scripts` needs no `npm rebuild`). To fetch it ahead of time: `npx install-electron`.

Build the DMGs (macOS only; arm64 and x64 into `release/`, which git ignores):

```sh
npm run dist:mac
```

Without a Developer ID certificate the app is ad-hoc signed and not notarised. Signing switches on when `CSC_LINK` (or `CSC_NAME`) and `CSC_KEY_PASSWORD` are set, notarisation when `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID` are set too. CI (`.github/workflows/desktop.yml`) builds the DMGs on every `v*` tag and on manual runs, uploads them as a workflow artifact and attaches them to a draft GitHub Release for tags; it uses the same variables as repository secrets when they exist.

**First start of an unsigned app.** macOS says the app cannot be opened because Apple cannot check it. Either right-click (or Control-click) Tattoo Planner in Applications → **Open** → **Open**, or try to open it once, then go to System Settings → Privacy & Security and click **Open Anyway**. macOS remembers the choice. Each new version (ad-hoc signed again) may ask once for Keychain access to "Tattoo Planner Safe Storage"; allow it so the stored key can be read.

`npm run dist:dir` packs an unpacked app for the current platform into `release/` (a quick packaging check, also on Linux).

## Cataloguing images from the command line

```sh
npm run assets:scan  # catalogue new images in images/, photos/ and the older folders (Reload in the planner does the same)
```

It scans the open project (`TATTOO_DATA_DIR`, else the remembered one) and writes only its `manifest.yaml`: an entry for every image no entry references yet, with an id from its path (`cards/rhonas.jpg` → `cards-rhonas`) and the kind from its folder (`images/` → `reference`, `photos/` → `arm-photo`; older folders: `cards/` → `card-art`, `refs/` → `reference`, `existing/` → `existing`, `arm-photos/` → `arm-photo`). A text file with the same name next to an image (`refs/medusa.txt`) becomes its `source`. Running it again is safe: it only adds entries for new files. Your edits to `manifest.yaml` (ids, notes, tags, comments, order) are kept; a manifest with errors is never overwritten. Details: `docs/adr/0003-ideas-pdf-ingestion.md`.

The former `npm run ingest` (splitting `ideas.pdf` into images with mupdf) was removed: it was specific to one PDF and mupdf's AGPL licence does not fit an open-source product (`docs/product/roadmap.md` §3). Images it extracted into `ideas/` earlier keep working: they are ordinary manifest entries (`page` and `bbox` stay as they are).

## The server

The planner's server (`server/`, mounted by `npm run dev` and `npm run serve`) reads `<project>/manifest.yaml` (schema: `src/assets/manifest.ts`) and serves, on `127.0.0.1` only:

- `GET /api/assets`: the manifest entries, each with `exists`; invalid entries become warnings instead of hiding the rest; no manifest yet = an empty list.
- `GET /api/projections`, `PUT /api/projections/<name>`: the calibrations in the project's `projections/` (text YAML, validated, comments kept).
- `GET /api/assets/image/<id>`: the image of one manifest entry, nothing else. Only `png`, `jpg`/`jpeg`, `webp`, `gif` and `avif`; HEIC/HEIF answer 415 (export them as JPEG). Paths must be relative, without `..`, and stay inside the project folder after resolving symlinks.
- `/api/project`: status (`none | legacy | project`, path, name, body, height, recent), `PATCH` (name, body, `height_cm`; comments kept), `POST open | create | close | migrate | open-sample | save-sample`, `GET browse?path=` (sub-folders for the folder dialog: inside the home folder only, no symlink escapes, no dot folders) and `GET`/`PUT measurements` (the raw text of `measurements.yaml`). Details in `server/projectApi.ts`.
- While the sample project is open, every write answers `409` with a read-only message (`server/sampleApi.ts`), `GET /api/exports` and `GET /api/edits` report exports and edits as unavailable, and `GET /api/assets/image/<id>` serves the placeholder drawn for that entry.

## Commands and code layout

| Command                       | What it does                                                                                                                       |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`                 | Vite dev server with the planner's API (`server/`)                                                                                 |
| `npm test`                    | Vitest unit tests                                                                                                                  |
| `npm run lint`                | ESLint and Prettier check                                                                                                          |
| `npm run format`              | Prettier write                                                                                                                     |
| `npm run typecheck`           | TypeScript project build check                                                                                                     |
| `npm run build`               | Static production bundle in `dist/`                                                                                                |
| `npm run serve -- [port]`     | serves `dist/` plus the API on 127.0.0.1 without Vite (run `npm run build` first)                                                  |
| `npm run migrate -- <folder>` | moves the repo's `config/` into a project folder (see [Older data folders](#older-data-folders-and-npm-run-migrate-jans-workflow)) |
| `npm run check`               | lint, typecheck, tests and the binary guard over all files                                                                         |
| `npm run desktop`             | builds the page and the desktop shell, then starts the Electron app                                                                |
| `npm run desktop:build`       | compiles `desktop/` and the server into `dist-desktop/` and draws the app icon                                                     |
| `npm run dist:mac`            | the macOS DMGs in `release/` (see [Desktop app from a checkout](#desktop-app-from-a-checkout))                                     |
| `npm run dist:dir`            | an unpacked app for the current platform in `release/` (packaging check)                                                           |

`npm run serve` takes the port from its argument or `TATTOO_PORT` (default 4322; `0` picks a free one) and prints the URL; the desktop shell reuses `startServer()` from `server/standalone.ts`.

Layout: `src/body/` builds the body regions, sample bodies, placement, mesh and unwrap coordinates (plain TypeScript), `src/render/` paints textures (blockout, reference, patterns), `src/layout/` holds the layout schema, shapes and image-fit rules, `src/assets/` the manifest schema and the asset browser, `src/viewer/` holds the 3D view and panels, `server/` holds every request handler as plain Node modules (`createApi()` in `server/api.ts`, the project folder in `server/project/`, the Vite-free server in `server/standalone.ts`), `src/project/` the project schema, start screen, folder picker and project screen, `src/data/` the folder listing on the project screen, `src/export/` builds the handout and the PNGs, `src/projection/` projects photos onto the skin (model, patch, calibration schema, the guided wizard's logic in `wizard.ts` and `layoutLink.ts`, the list, wizard and Advanced pages), `src/edits/` edits reference images with built-in operations or GPT Image and creates new ones (prompts and rules, the Image studio tab; `server/editsApi.ts` runs the generative jobs and keeps the sessions; the pixel operations live in `src/render/builtinOps.ts`), `src/config/` holds the config schemas, `desktop/` the Electron shell (main process, preload, key store, URL rules, electron-builder config; the page's side of the bridge is `src/desktop/bridge.ts`), `scripts/check-binaries.mjs` is the pre-commit guard, `tests/` the unit tests.

### UI conventions

The UI is dark only, in the "Pro creative tool" style (`docs/claude-decisions.md`, 2026-11-04). All colours, radii and type sizes are tokens at the top of `src/styles.css`; the comment there lists the rules. In short: `--accent` (blue-violet) is the only interaction colour (selection, focus, primary button, pressed tools), `--red` is for red lines only, `--danger` for errors, `--warn` for notices. Opaque blocks on a page are `.panel` / `.card`; controls over a canvas float in `.float` (with `.float-head`, `.float-title`, `.float-bar`). Buttons: default (hairline), `.primary`, `.ghost`, `.danger`, `.link`, `.icon-button`; `.segmented` for a choice of a few, `input.switch` for on/off, `.chip` for status, `.notices` / `.notice` for messages, `.empty` for empty states, `.mono` for numbers, `<kbd class="kbd">` for key hints. Icons are inline SVG in `src/ui/icons.tsx`. A tab whose page is a full-bleed workspace is listed in `FULL_BLEED` in `src/App.tsx`; a page can put controls into the top bar through the slots App passes to the Layout and Projection tabs (`HeaderSlots`). Fonts (Inter, JetBrains Mono) are bundled from npm, so the planner works offline.

## Status

| Phase (PROJECT_BRIEF.md)            | State                                                                                                         |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 0 Bootstrap                         | done                                                                                                          |
| 1 Stack check and scaffold          | done                                                                                                          |
| 2 Parametric arm and viewer         | done                                                                                                          |
| 3 Unwrap editor and blockout mode   | done                                                                                                          |
| 4 Assets, ideas PDF, reference mode | done                                                                                                          |
| 5 Export for the artist             | done                                                                                                          |
| 6 Iteration and polish              | in progress: variant comparison, elbow-bent pose, red-line brush, Anubis from all photos and image edits done |

Phases A–D of the product plan: `docs/product/roadmap.md`.
