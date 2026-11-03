# Tattoo Planner

A local tool for planning a tattoo sleeve: a parametric 3D model of the arm, a 2D unwrap editor mapped live onto it, blockout and reference modes, coverage metrics, and a PDF handout for the tattoo artist. The output is a **sketch, not a finished design**: the artist designs the tattoo.

`PROJECT_BRIEF.md` is the source of truth for the concept, the requirements and the phases. Technical decisions live in `docs/adr/`.

## Status

| Phase                               | State                                                                    |
| ----------------------------------- | ------------------------------------------------------------------------ |
| 0 Bootstrap                         | done                                                                     |
| 1 Stack check and scaffold          | done                                                                     |
| 2 Parametric arm and viewer         | done                                                                     |
| 3 Unwrap editor and blockout mode   | done                                                                     |
| 4 Assets, ideas PDF, reference mode | done                                                                     |
| 5 Export for the artist             | done                                                                     |
| 6 Iteration and polish              | in progress: variant comparison, elbow-bent pose and red-line brush done |

Decisions Claude made without Jan are listed in `docs/claude-decisions.md` for review.

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

- **Layout** (start page): pick a variant from `config/layouts/`, edit it on the 2D unwrap and see it live on the 3D arm in blockout mode (figures dark grey, fillers light grey, bands striped, red lines red, existing tattoo outlined). Click to select, drag to move, corner handle to scale, round handle to rotate; the side panel edits every field, the layer order, lock, duplicate and delete. "Inner side centred" puts the palm-side line in the middle of the editor for pieces on the seam (Anubis, Pegasus). **Save** writes the YAML back, keeping comments; **Save as…** duplicates what you see into a new variant (a free name like `v1-baseline-2` is suggested; the new file keeps the comments of the one it came from, under a line saying so; the open variant stays as saved). Unsaved edits survive a visit to another tab; the variant list marks them with `*`. The coverage table shows the share of figures, fillers, bands, lines and open skin per zone. Figures without a height are drawn 10 cm tall and listed in a warning; the Anubis takes its size from `measurements.yaml` when the layout leaves it empty.
- **Draw red line** (Layout tab, above the 3D arm): while it is on, dragging on the 3D arm draws a red stroke on the skin (rotation is off; right-drag pans, scroll zooms; works on the bent arm too). Each stroke becomes a new `line` element (`red-stroke-2`, `red-stroke-3`, …, red, as wide as the layout's first red line, else 1.5 cm), selected and editable like any line in the 2D editor, and saved to the YAML with **Save**. The stroke is simplified to the fewest points that stay within 0.3 cm of what was drawn (also across the inner seam); clicks without a stroke are ignored. With a line selected, **continue <id>** extends that line instead, at its nearer end; its existing points are kept as they are.
- **Modes** (toolbar, the number next to them is the texture render time): **Blockout** as above; **Reference** draws the same layout with the reference images (PROJECT_BRIEF.md §10.1 F6): figures and existing tattoos show their asset's cut-out inside their box, multiplied onto the skin so white paper and pale skin vanish; fillers and bands are the procedural patterns below, clipped exactly to their shape (also across the inner seam); red lines lie on top of everything (§4.3). A figure whose image is missing shows a labelled placeholder box with the reason (no asset, not in the manifest, file missing, no data folder, cannot be shown). **cm grid** shows the bare unwrap grid. Images are decoded once per page load and cached, so switching modes is instant.
- **Assets** panel (Layout tab, right column): thumbnails of every `manifest.yaml` entry, filterable by kind and tag, with a search over id, notes, source and file. Select a figure or existing tattoo in the editor, then click an image to assign it (`asset:`). Missing files are greyed out, manifest problems are listed as warnings. **Reload** re-reads the manifest and the images. The element panel shows the assigned image with its cut-out marked and edits the reference fields below.
- **Export** (Layout toolbar): one click writes the handout for the tattoo artist and PNGs of every picture into the data folder (details below). Disabled, with the reason as tooltip, while there are unsaved changes, layout errors or images still loading, and when `TATTOO_DATA_DIR` is not set.
- **Compare**: two variants side by side on the 3D arm, read-only (edit in the Layout tab). Pick A and B (⇄ swaps them), Blockout or Reference, and one of the four views; both arms share the camera, so rotating or zooming either one moves both. Under each arm its coverage table, with every cell tinted that differs from the other variant by at least 2 points (red = more, blue = less; the tooltip gives the difference). Below, the elements that exist in only one variant or whose values differ (by id, with the changed fields). While the Layout tab has unsaved edits, they can be compared too ("(unsaved edits)", preselected against the saved file). Variants are the files in `config/layouts/`; make one with **Save as…**.
- **Arm & measurements**: the parametric left arm built from `config/measurements.yaml`, with a 1 cm grid on the skin (bold every 5 cm, red centre lines for outer, lateral, inner and medial). Buttons switch between the four fixed views (front = inner side, back = outer side, medial, lateral); drag to rotate, scroll to zoom.
- **Elbow pose** (every 3D view: Arm, Layout, Compare): **Straight**, **Bent 90°** or the slider (0–120°) flexes the elbow; the forearm swings towards the palm side, the skin bends over about ±6 cm around the elbow tip, stretching a little on the outer side and creasing on the inner side. The texture and the unwrap stay the same, so it shows how the elbow and skull area deform. The pose is shared by all tabs; the medial and lateral views show the bend best. Exports still show the straight arm. Model and limits: `docs/adr/0005-elbow-bend.md`. **Screenshot** saves a PNG to the browser's download folder. The panel shows every measurement; values not measured yet use flagged placeholders, and typing a value previews it immediately (edits are not saved: write final numbers into the YAML, which reloads the page).
- **Data folder**: lists the files found in `TATTOO_DATA_DIR` and checks the expected entries (`ideas.pdf`, `refs/`, …). If the variable is missing or wrong, it says so.

Geometry and unwrap conventions: `docs/adr/0002-arm-geometry-and-unwrap.md`.

**Patterns** for `pattern:` in a layout (drawn in reference mode, `src/render/patterns/`; sizes are real cm on the skin):

| Name                     | Kind   | Look                                                                                       |
| ------------------------ | ------ | ------------------------------------------------------------------------------------------ |
| `snake-scales`           | filler | overlapping scale rows (≈ 1.2 cm); `density` scatters them out into open skin              |
| `hatching`               | filler | diagonal engraving lines; `density` tightens the spacing and adds cross-hatching above 0.5 |
| `starfield`              | filler | sparse dots and small four-point stars                                                     |
| `meander`                | band   | Greek key spirals between two border lines, module ≈ band height                           |
| `lotus` (`lotus-frieze`) | band   | lotus flowers alternating with papyrus umbels, linked by garland arcs                      |

Bands fit a whole number of repeats around the arm, so they meet at the inner seam. Fillers are seeded from the element `id`: the same layout always looks the same. Any other name draws a faint diagonal placeholder hatch.

### Export for the artist

**Export** in the Layout toolbar renders the saved layout and writes, only into the data folder:

```
<TATTOO_DATA_DIR>/exports/
├── v1-baseline-2026-11-03.pdf      the handout
└── v1-baseline-2026-11-03/         PNGs: {front,back,medial,lateral,unwrap}-{blockout,reference}.png
```

A second export of the same layout on the same day gets `-2`, then `-3`; nothing is ever overwritten. The toolbar shows the progress and, when done, the paths written (about 15–20 s).

The PDF (A4, English): a cover with the note that this is a sketch and the artist has creative freedom, the layout's name, description and date, and a legend; all four views (front = inner, back = outer, medial, lateral) at a glance with blockout and reference side by side; one page per view with the elements facing that side; the unwrap with cm grid in both modes; a table of every element (type, reference image, size in cm, position, style or pattern, `notes:` from the YAML); coverage per zone; open questions (unset heights, missing images, placeholder measurements, and the design questions of PROJECT_BRIEF.md §9, listed in `src/export/strings.ts`). All handout wording lives in `src/export/strings.ts`, ready for a German version. Give an element a `notes: "…"` line in the YAML to pass a remark to the artist.

The dev server endpoint behind it (`src/export/server/exportsApi.ts`): `GET /api/exports` (enabled or why not), `POST /api/exports` (reserve a name), `PUT /api/exports/<base>.pdf` or `/<base>/<name>.png` (write one file; type, signature, size and path are checked; nothing outside `exports/`). Decisions: `docs/adr/0004-export.md`.

### Ideas PDF and assets

```sh
npm run ingest       # split ideas.pdf into images and page text, catalogue them
npm run assets:scan  # catalogue new images in cards/, refs/, existing/, arm-photos/
```

Both read `TATTOO_DATA_DIR` (shell or `.env`) and write only into the data folder:

- `ingest` writes `ideas/page-NN-img-MM.png|jpg` (JPEGs stay JPEG, everything else becomes PNG) and `ideas/page-NN.txt`, and adds an entry per image to `manifest.yaml`: id `ideas-pNN-MM`, kind `idea`, the page heading in `source` (and as tags), the caption next to the image in `notes`, `page` and `bbox` (PDF points, origin top-left) to trace it back.
- `assets:scan` adds an entry for every image no entry references yet, with an id from its path (`cards/rhonas.jpg` → `cards-rhonas`) and the kind from its folder (`card-art`, `reference`, `existing`, `arm-photo`). A text file with the same name next to an image (`refs/medusa.txt`) becomes its `source`.

Running them again is safe: they only add entries for new files and refresh `page`/`bbox` of extracted images. Your edits to `manifest.yaml` (ids, notes, tags, comments, order) are kept; a manifest with errors is never overwritten. If you change `ideas.pdf` so that pages or images move, check the manifest afterwards: ids follow page and position. Details: `docs/adr/0003-ideas-pdf-ingestion.md`.

### Asset manifest and the dev server

The dev server reads `<TATTOO_DATA_DIR>/manifest.yaml` (schema: `src/assets/manifest.ts`) and serves, on `127.0.0.1` only:

- `GET /api/assets`: the manifest entries, each with `exists`; invalid entries become warnings instead of hiding the rest; no manifest yet = an empty list.
- `GET /api/assets/image/<id>`: the image of one manifest entry, nothing else. Only `png`, `jpg`/`jpeg`, `webp`, `gif` and `avif`; HEIC/HEIF answer 415 (export them as JPEG). Paths must be relative, without `..`, and stay inside the data folder after resolving symlinks.

`v1-baseline.yaml` uses these asset ids: `anubis-photo` (must point at `arm-photos/anubis1_nr.JPG`, because the layout's crop is fitted to that photo), `rhonas-card` (the Rhonas card image from ideas.pdf; the layout's crop is fitted to the full card), `medusa-ref-01`, `skull-ref-01` and `pegasus-ref-01`. An id that is not in the manifest renders as a placeholder. The entry for the Anubis photo:

```yaml
- id: anubis-photo
  file: arm-photos/anubis1_nr.JPG
  kind: existing
  tags: [anubis, existing]
```

### Reference fields in a layout

Figures and existing tattoos take these optional fields (rules in `src/layout/imageFit.ts`):

| Field                | Meaning                                                                                                                                                                                                          |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `crop`               | `{ x, y, w, h }`, 0–1 from the left/top edge of the image as stored (before turning). Overrides the asset's `crop` in the manifest; without either, the whole image.                                             |
| `image_rotation_deg` | `90`, `180` or `270`: turns the cut-out clockwise, e.g. for a photo of the arm lying sideways.                                                                                                                   |
| `flip`               | `true` mirrors the image left-right (after turning).                                                                                                                                                             |
| `feather_cm`         | soft edge of the cut-out in cm, default `1`; `0` for a hard edge.                                                                                                                                                |
| `filter`             | `none`, `grayscale` or `hatching` (grayscale with an engraving line screen). Default: `grayscale` when the element's centre is on the forearm, `none` above the elbow. Photos are stretched so skin turns white. |

Size: when `size_cm.w` is not set, the box takes the proportions of the upright cut-out (in every mode, so blockout, metrics and picture agree; until the image has loaded, or without a data folder, the old 0.55 × height is used). When both `h` and `w` are set, the image is fitted inside the box without distortion and centred.

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

Layout: `src/arm/` builds the profile, mesh and unwrap coordinates (plain TypeScript), `src/render/` paints textures (blockout, reference, patterns), `src/layout/` holds the layout schema, shapes and image-fit rules, `src/assets/` the manifest schema and the asset browser, `src/viewer/` holds the 3D view and panels, `src/data/` resolves and lists the data folder and serves assets (`server/` runs in the dev server only), `src/export/` builds the handout and the PNGs (`server/` writes them into the data folder), `src/config/` holds the config schemas, `scripts/check-binaries.mjs` is the pre-commit guard, `tests/` the unit tests.
