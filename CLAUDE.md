# Tattoo Planner: session instructions

Local web tool that previews Jan's left-arm tattoo sleeve on a parametric 3D arm: a 2D unwrap editor mapped live onto the arm, blockout and reference modes, coverage metrics and a PDF handout for the tattoo artist. It is a **sketch tool, not a design tool**: it visualises Jan's ideas and leaves the actual design to the artist.

## Session start

1. `PROJECT_BRIEF.md` is the single source of truth (concept, decisions, requirements, data model, phases). Read its table of contents, then the sections your task touches. §14 lists the phases and their acceptance criteria.
2. `docs/product/roadmap.md` is the plan for turning the planner into an open-source product (feature review, phases A–D). For product work it wins over the brief; the brief stays the source for Jan's own sleeve.
3. `README.md` has setup and commands; `docs/adr/` records technical decisions; `git log` shows where work stands.

## Conventions (from PROJECT_BRIEF.md §15)

- **Documentation, code comments, commit messages: English.** Conversation with Jan is in German.
  Exception: `docs/measuring.md` (measuring guide and entry sheet) is in German at Jan's request.
  When Jan fills in its "Eintragen" tables, transfer the final values into `config/measurements.yaml`.
- **Never commit images, PDFs or exports.** All binary/visual data lives in `TATTOO_DATA_DIR` (Seafile). Respect the pre-commit guard; never bypass it (no `--no-verify`, no editing the allow-list to sneak a file in).
  The one exception: the generated standard background tiles in `assets/backgrounds/` (PNG/WebP, at most 2 MB each, written by `npm run backgrounds:generate`; Jan, 2026-11-06, docs/adr/0019). Never a reference image, photo or export there.
- Read paths only via `TATTOO_DATA_DIR`; never hard-code Jan's absolute paths in committed files. Jan's real path lives only in the git-ignored `.env`.
- No public deployment; the planner stays local. Sending an image to an image-edit service (OpenAI, for generative edits; Jan, 2026-11-04) is fine; never put data-folder files into a git repo or anywhere public. The dev server binds to `127.0.0.1` only.
- Prefer small, reviewable commits per phase step; keep `README.md` current.
- Record significant technical choices as ADRs in `docs/adr/` (`NNNN-short-name.md`).
- When in doubt about design intent (motifs, placement, style), consult `PROJECT_BRIEF.md` §3–§9 and **ask Jan rather than inventing design decisions**. Placeholder values in configs stay `null` until Jan provides them.
- Keep the layout YAML human-editable and stable (Jan may edit it by hand): stable key order, comments preserved where possible, no reformatting churn.

## Working style

- Work on a task branch, push it and open a PR against `main`. Claude may merge its own PRs once CI is green (Jan, 2026-11-03).
- Before every commit: `git diff --cached --stat` must show no file from the data folder, no image, PDF or export.
- Judge test and lint runs by their real exit code, never through a pipe without `set -o pipefail`.
- Keep geometry, UV maths and schema logic in framework-free TypeScript modules with unit tests; UI code stays thin.
- Dependencies: current, well-maintained, justified. `.npmrc` disables install scripts and refuses releases younger than 7 days (same as Job Radar); if a package needs an install script, run `npm rebuild <pkg> --ignore-scripts=false` and say so in the PR.

## Cloud sessions (Claude Code on the web)

- A cloud session has this repo only, not the Seafile folder. Work against the tests and the empty-folder states of the UI; never ask for or reconstruct Jan's images or data. Anything that needs real assets is checked on Jan's Mac.
