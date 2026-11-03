# Tattoo Planner

A local tool for planning a tattoo sleeve: a parametric 3D model of the arm, a 2D unwrap editor mapped live onto it, blockout and reference modes, coverage metrics, and a PDF handout for the tattoo artist. The output is a **sketch, not a finished design**: the artist designs the tattoo.

`PROJECT_BRIEF.md` is the source of truth for the concept, the requirements and the phases. Technical decisions live in `docs/adr/`.

## Status

| Phase                               | State   |
| ----------------------------------- | ------- |
| 0 Bootstrap                         | done    |
| 1 Stack check and scaffold          | done    |
| 2 Parametric arm and viewer         | done    |
| 3 Unwrap editor and blockout mode   | next    |
| 4 Assets, ideas PDF, reference mode | planned |
| 5 Export for the artist             | planned |
| 6 Iteration and polish              | planned |

## Data stays out of git

Code, docs and YAML configs live in this (private) repo. Every image, the ideas PDF and every export live in a Seafile folder that the planner finds through `TATTOO_DATA_DIR`. Images, PDFs and exports are rejected by `.gitignore`, by a pre-commit hook and by CI.

Suggested layout of the data folder (PROJECT_BRIEF.md §12.3):

```
<TATTOO_DATA_DIR>/
├── ideas.pdf        collected ideas
├── manifest.yaml    asset catalogue (Phase 4)
├── ideas/           images extracted from ideas.pdf (Phase 4)
├── refs/            Instagram / Pinterest references
├── cards/           MTG card art
├── existing/        photos of existing tattoos
├── arm-photos/      left arm from four sides, with tape measure
└── exports/         generated PNG / PDF handouts (Phase 5)
```

## Setup

Requires Node ≥ 22.18 and npm.

```sh
npm ci            # install (install scripts are disabled by .npmrc)
npm run hooks     # enable the pre-commit guard (once per clone)
cp .env.example .env
```

Then set the data folder in `.env`. Quote the path when it contains spaces; `~` is expanded:

```sh
TATTOO_DATA_DIR="~/Your Secure Cloud/<library>/tattoo-planner-data"
```

A variable set in the shell wins over `.env`.

## Usage

```sh
npm run dev       # http://127.0.0.1:4320 (local only)
```

- **Arm**: the parametric left arm built from `config/measurements.yaml`, with a 1 cm grid on the skin (bold every 5 cm, red centre lines for outer, lateral, inner and medial). Buttons switch between the four fixed views (front = inner side, back = outer side, medial, lateral); drag to rotate, scroll to zoom. **Screenshot** saves a PNG to the browser's download folder. The panel shows every measurement; values not measured yet use flagged placeholders, and typing a value previews it immediately (edits are not saved: write final numbers into the YAML, which reloads the page).
- **Data folder**: lists the files found in `TATTOO_DATA_DIR` and checks the expected entries (`ideas.pdf`, `refs/`, …). If the variable is missing or wrong, it says so.

Geometry and unwrap conventions: `docs/adr/0002-arm-geometry-and-unwrap.md`.

## Configuration

- `config/measurements.yaml`: left-arm measurements in cm (PROJECT_BRIEF.md §13.1). `null` means not measured yet. How to measure and photograph the arm: `docs/measuring.md`.
- `config/layouts/*.yaml`: layout variants (§13.2), starting with `v1-baseline.yaml`. Hand-editable; Git history is the design history.

## Development

| Command             | What it does                                               |
| ------------------- | ---------------------------------------------------------- |
| `npm run dev`       | Vite dev server with the data-folder middleware            |
| `npm test`          | Vitest unit tests                                          |
| `npm run lint`      | ESLint and Prettier check                                  |
| `npm run format`    | Prettier write                                             |
| `npm run typecheck` | TypeScript project build check                             |
| `npm run build`     | Static production bundle (without data-folder access)      |
| `npm run check`     | lint, typecheck, tests and the binary guard over all files |

Layout: `src/arm/` builds the profile, mesh and unwrap coordinates (plain TypeScript), `src/render/` paints textures, `src/viewer/` holds the 3D view and panels, `src/data/` resolves and lists the data folder (`server/` runs in the dev server only), `src/config/` holds the config schemas, `scripts/check-binaries.mjs` is the pre-commit guard, `tests/` the unit tests.
