# ADR 0012: One project folder per person, server code outside Vite

- Status: accepted (2026-11-05, decided by Claude under Jan's autonomy rule; see docs/claude-decisions.md)
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
- **Migration of Jan's repo config:** `npm run migrate -- <folder>` copies `config/layouts/*`, `config/projections/*` and `config/measurements.yaml` into the folder (never overwriting), writes `project.yaml` (body `male`, region of old layouts `arm-left`) and prints what it did. Until a legacy folder is migrated, the server keeps reading and writing the repo's `config/` for it and the project screen shows a **Move into project** button that runs the same migration, so nothing breaks on Jan's Mac in between. After the migration the repo's `config/` is no longer read; it is removed before the public repo (roadmap Phase D).

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
