# ADR 0001: Stack

- Status: accepted (Jan, 2026-11-03)
- Context: PROJECT_BRIEF.md §11.1, §12.1

## Context

The Tattoo Planner is a local-only web tool: a 2D unwrap editor whose canvas is mapped live as a texture onto a parametric 3D arm, plus panels for element properties, layout variants, YAML validation errors and coverage metrics. The brief prefers Vite + TypeScript + Three.js and asks to reuse the conventions of Jan's existing projects:

- **Job Radar** (npm workspaces, Vite 8 + React 19, Vitest, native TypeScript in Node): data lives outside the repo, found through an environment variable (`JOB_RADAR_DATA_DIR`, with `~` expansion, falling back to a config file); `.npmrc` disables install scripts and refuses releases younger than 7 days; servers bind to `127.0.0.1`; no linter.
- **Is it cool** and **Porcellano** (pnpm, Vite 8 + React 19): ESLint with `typescript-eslint` strict and `eslint-plugin-react-hooks`, Vitest, `.env` files git-ignored with a committed `.env.example`.

## Decision

- **Vite + TypeScript + React 19 + React Three Fiber + drei** for the UI and 3D scene.
- **Framework-free core:** arm geometry, UV maths, texture rendering, coverage metrics and schemas are plain TypeScript modules with unit tests. React components only wire them up. This keeps the maths testable without a browser and lets the mesh be swapped later (§11.2, photogrammetry).
- **Data folder:** `TATTOO_DATA_DIR` (shell environment wins over the git-ignored `.env`, `~` expands, relative paths resolve against the repo root), following Job Radar. There is no separate backend: a small Vite dev-server middleware serves what the UI needs from the data folder. The dev server listens on `127.0.0.1` only.
- **Tooling:** npm with Job Radar's hardened `.npmrc`; ESLint (`typescript-eslint` strict, react-hooks) as in Is it cool; Prettier for formatting (none of the reference repos formats TypeScript, and a formatter keeps diffs small); Vitest for tests; `yaml` + `zod` for configs.
- **TypeScript 6** instead of 7: `typescript-eslint` does not support the native TypeScript 7 compiler yet. Revisit when it does.
- **Node ≥ 22.18** (Jan runs 25; CI tests 22 and 25).
- **Pre-commit guard** in `.githooks/` (enabled with `npm run hooks`, since `.npmrc` blocks a `prepare` script) plus the same check over all tracked files in CI.

## Alternatives

- **Plain TypeScript + Three.js:** fewer dependencies and no abstraction over Three.js, but every editor panel (element list, property forms, variant switcher, error display, metrics) would be built by hand. The editor is UI-heavy, so React pays for itself.
- **Separate Node server** (as in Job Radar): not needed while the only server-side job is reading the data folder during development. Revisit if exports or PDF ingestion need a long-running process (Phase 4/5).

## Consequences

- Three.js objects that R3F does not cover well (the dynamic texture, custom geometry) are created in plain TS and passed to R3F as primitives.
- `npm run dev` is the only way to see data-folder content; `vite build` produces a static bundle without that middleware.
