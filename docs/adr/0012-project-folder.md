# ADR 0012: One project folder per person, server code outside Vite

> Since 2026-11-06 a project can hold several persons (ADR 0017); "one folder per person" now means one folder per group of people who share an idea library.

- Status: accepted (2026-11-05, decided by Claude under Jan's autonomy rule; see docs/claude-decisions.md); implemented for roadmap Phase C steps 1, 2 and 8 (details below under "Implementation")
- Context: docs/product/roadmap.md §4.2 and §4.3. Today the planner reads layouts, projections and measurements from the repo's `config/` and images from `TATTOO_DATA_DIR`. A published app must keep all personal data in one folder the user picks, and the git checkout and the desktop app must run the same server code.

## Decision

### Project folder

```
<project>/
├── project.yaml        schema version, name, body (female | male), optional body height
├── measurements.yaml   optional; per region, only the values the user measured
├── layouts/            <name>.yaml, each with `region:`
├── projections/        <name>.yaml, calibrations of existing tattoos
├── manifest.yaml       image catalogue, maintained by the app (import adds entries)
├── images/             imported references
├── photos/             body photos for projections
├── edits/, generated/  Image studio results
└── exports/            PDF / PNG handouts
```

- `project.yaml` marks a folder as a project: `version: 1`, `name`, `body: female | male`, optional `height_cm`. Unknown keys are kept on save.
- Every file stays YAML or an image; all YAML is written with comments kept (as layouts are today).
- Old folders keep working: a folder with `manifest.yaml` but no `project.yaml` (Jan's data folder) opens as a legacy project; existing subfolders (`refs/`, `cards/`, `existing/`, `arm-photos/`, `ideas/`) stay valid image locations because the manifest names each file's path.
- **Migration of Jan's repo config:** `npm run migrate -- <folder>` copies `config/layouts/*`, `config/projections/*` and `config/measurements.yaml` into the folder (never overwriting), writes `project.yaml` (name = the folder's name, body `male`; old layouts without `region:` already mean `arm-left`, so they are copied unchanged) and prints what it did. Until a legacy folder is migrated, the server keeps reading and writing the repo's `config/` for it and the project screen shows a **Move into project** button that runs the same migration, so nothing breaks on Jan's Mac in between. After the migration the repo's `config/` is no longer read; it is removed before the public repo (roadmap Phase D).

### Choosing the project

- The server keeps the current project in a small user config: `~/.config/tattoo-planner/config.json` (`{ "project": "/abs/path", "recent": [...] }`), the same pattern as Job Radar. `TATTOO_DATA_DIR` (shell or `.env`) still wins, for git users and CI.
- A start screen when no project is open: **Open sample project** (read-only, shipped with the app, see below), **New project** (pick a folder, choose body), **Open project** (pick a folder), recent projects.
- Folder picking: in the desktop app a native dialog (Electron `dialog.showOpenDialog`, via the preload bridge). In the browser (`npm run dev`) the server offers a minimal folder browser endpoint restricted to the user's home folder, because a browser page cannot learn a real path.
- **Sample project** in `samples/demo/` in the repo: `project.yaml`, a layout per region and a few procedurally drawn placeholder images generated at runtime (no binaries in git). It opens read-only; "Save as new project" copies it into a folder of the user's choice.

### Server outside Vite

- All request handlers move from `src/*/server/*.ts` into `server/` as plain functions `(req, res, next)` grouped by area (`projectApi`, `layoutsApi`, `assetsApi`, `projectionsApi`, `editsApi`, `exportsApi`), with one `createApi(context)` that returns a Node middleware. `context` holds the project resolver and settings (keys, models).
- Vite mounts it with one plugin (`configureServer` and `configurePreviewServer`); the desktop app mounts the same middleware on a Node `http` server bound to `127.0.0.1` on a random port and serves the built `dist/` next to it.
- The browser code keeps calling `/api/...` with relative URLs, so nothing in the UI knows which shell runs it.

## Alternatives

- **Browser-only storage (File System Access API, OPFS).** No Safari support for writable directory handles; keys would sit in the page. Rejected.
- **Keep `config/` in the repo for layouts.** Fine for Jan, impossible for other users and leaks personal data into the public repo.

## Consequences

- `TATTOO_DATA_DIR` changes meaning slightly: it now names the project folder. Jan's Seafile folder becomes his project after `npm run migrate`.
- The "Data folder" tab becomes the project screen (name, body, folder, re-open, reveal in Finder in the desktop app).

## Implementation (2026-11-05)

- **Modules.** `server/api.ts` (`createApi({ projects, home, settings })` → Connect-style middleware with `close()`), `server/http.ts` (errors, JSON, cross-site check), one handler module per area, `server/project/` (`folder.ts` what a folder is, `userConfig.ts`, `store.ts` the current project, `browse.ts`, `migrate.ts`), `server/context.ts` (context from the environment: `.env` under the shell, `TATTOO_DATA_DIR`, `XDG_CONFIG_HOME`, OpenAI settings), `server/standalone.ts` (`startServer()` and `npm run serve`). Shared types and the `project.yaml` schema live in `src/project/schema.ts` and `src/project/yamlDoc.ts`; server code imports pure modules from `src/`, never the other way round.
- **Endpoints.** Unchanged paths for `/api/data-files`, `/api/assets`, `/api/exports`, `/api/edits`, `/api/layouts`, `/api/projections`, now resolved against the current project on every request. New `/api/project`: `GET` status, `PATCH` details, `POST open | create | close | migrate`, `GET browse?path=`, `GET`/`PUT measurements`.
- **Current project.** `TATTOO_DATA_DIR` set: that folder, locked (open, create and close answer 409); a folder without `project.yaml` is a legacy folder even without a manifest, as before projects existed; a missing folder gives status `none` with a problem. Otherwise `config.json`'s `project`, if it is still a project or legacy folder; recent list of 8.
- **Create.** A new or empty folder (dot files ignored) gets `project.yaml`, an empty `manifest.yaml`, `layouts/` (with an empty `first-sketch.yaml` on the left arm), `projections/`, `images/`, `photos/`. A legacy folder is migrated with the given name and body. A project, a file or a folder with other content is refused. The parent must exist.
- **Browse.** Real paths only inside the real home folder; a symlink is listed only when it leads to a folder inside home; dot entries hidden; at most 500 folders; each entry marked project / legacy / folder.
- **Measurements.** The page fetches status and the raw `measurements.yaml` text before the app modules load (`src/project/projectData.ts`) and parses it with the existing parser; no file = `units: cm` (all sample values). `project.yaml` body and height win over `measurements.yaml`. Switching project reloads the page.
- **Images.** The scan catalogues `images/` (reference) and `photos/` (arm-photo) besides the older folders.
- **Picker.** `useFolderPicker().pickFolder()` calls `window.tattooDesktop.pickFolder` when the desktop shell provides it, else opens the in-browser dialog.
- **Sample project (Phase C step 8).** `samples/demo/` (YAML only: `project.yaml` with the female body, `manifest.yaml`, one layout per region). `POST /api/project/open-sample` opens it read-only, held in memory and never written to `config.json`; `POST /api/project/save-sample` (`{ path, name, body }`) copies it into an empty or new folder and opens the copy. While it is open, `server/sampleApi.ts` answers every write with 409, reports exports and edits as unavailable and serves the manifest's images as placeholders drawn on request (`src/sample/placeholders.ts`, PNG via `server/png.ts`); "Save as" writes them as real PNG files into the user's folder. The sample's path is `<app folder>/samples/demo` (in the desktop app inside `app.asar`). Since 2026-11-06 (ADR 0018) the sample opens also when `TATTOO_DATA_DIR` fixes the project, and closing it returns to the project open before it; "Save as new project" stays refused there.
