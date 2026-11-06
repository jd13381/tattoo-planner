# ADR 0019: Background layers

Status: accepted (2026-11-06)

## Context

Jan (2026-11-06): patterns and fillers need their own editing and must go onto a body part as a background, like layers in Photoshop; a few standard backgrounds (clouds, stars, shading) generated with GPT Image; a whole body part or only an area; a view of its own because the layer lies under the motifs; motifs on top cover it. The aim is to picture how, say, an arm looks when the motifs are tied together by a background. He allowed one exception to "no images in git" for these generated tiles.

Before, a `filler` was an element: a pattern in a rectangular u/v span, drawn in the element order, so it was neither "under everything" nor shaped freely.

## Decision

**Model** (`src/layout/schema.ts`, framework-free, tested). A layout gets `backgrounds:`, an ordered list (bottom first, before `elements:` in the YAML) of layers:

- `source`: one of `{ pattern, scale?, density?, ink?, rotation_deg?, offset_cm? }` (the line patterns snake-scales, hatching, starfield, or a tile pattern), `{ standard, tile_cm?, … }` (a catalogue entry) or `{ image, tile_cm, rotation_deg?, offset_cm? }` (a project asset, kind `background` preferred). Written in flow style on one line.
- `opacity`, `blend` (`multiply` default, `normal` covers), `hidden`, `locked`, `name`, `notes`.
- `cover`: `region` (default, the whole body part) or `area`: the union of `shapes` (`rect` / `ellipse` with centre u, v and size in cm and a rotation, `polygon` in u, v, `span` = the old filler rectangle) then the painted `mask` strokes in order (`{ erase?, radius_cm, points }`), softened by `feather_cm`.
- `gap_cm`: bare skin kept around the motifs.

Ids are unique across elements and layers. New layer nodes get a fixed key order (`LAYER_KEY_ORDER`); existing nodes are updated in place, so comments and hand edits stay.

**Migration.** `type: filler` is no longer an element type. `parseLayout` turns each filler into an area layer (`source: { pattern, density }`, one `span` shape, its id, lock and notes, unknown keys kept), appended after the file's own layers, and reports their ids; the Layout tab shows a notice. The file is only rewritten when the user saves the variant. A file never mixes the two forms after a save. `config/layouts/v1-baseline.yaml` stays in the old form on purpose (the migration test reads it).

**Rendering** (`src/render/backgrounds/`). Reference mode composites the visible layers bottom-up onto the skin before the motifs:

- Pattern space is cm on the skin: `s` around the ring from the seam line (u = 0.5, growing in screen x), `y` from the region's end. A tile is sampled with wrap, so it is cm-true at every circumference; a 1.5 cm cross-fade at the end of each ring closes it at the seam whatever the circumference (`seamCrossfade`).
- Procedural tiles (clouds, stars, smoke dotwork, waves, geometric) are periodic by construction and deterministic (own hash, seeded by the layer id). Line patterns reuse the band/filler painters on a strip.
- The knockout is the motifs drawn source-over onto a scratch canvas (image alpha, or the box without an image; bands their strip), dilated by `gap_cm`. The area alpha is a hard coverage mask blurred by `feather_cm` (box blur, wrap-aware around the ring, prefix sums along it).
- Blockout shows layers as one class `BACKGROUND` in the light grey the fillers had; coverage counts it as the category `background`, with the hard edge (gap and feather left out). The handout lists layers before the elements.

**Editor.** A Layers tab (eye, lock, drag to reorder, + add: standard / line pattern / project image), a Background view (Motifs | Background) in which the motifs are dimmed and passive and the inspector edits the selected layer, with the tools Select, Rect, Ellipse, Polygon, Brush and Eraser, and a Motifs on/off switch that hides the motifs in 2D and 3D. The operations are pure functions (`src/editor/backgroundOps.ts`), one undo history with the elements.

**Standard backgrounds.** `assets/backgrounds/backgrounds.yaml` lists name, label, tile size, fallback and the fixed GPT Image prompt. The app shows the catalogue image when the build has it (`import.meta.glob`) and the procedural version of the same name otherwise, so the feature works without any image. `npm run backgrounds:generate` (`server/backgrounds.ts`) sends the prompts with the Image studio's engine and key, makes each result seamless (offset-and-blend, `makeSeamless`), stores at most 1024 px and 2 MB (greyscale when possible) and sets `file`, `generated`, `licence` by editing lines, so the folded prompts stay byte for byte. The pre-commit guard allows exactly `assets/backgrounds/*.png|webp` up to 2 MB.

**Image studio.** A Background mode creates a square opaque tile from a preset or a description, seam-fixes every result on the server, shows it tiled 3 × 3 and keeps it as `backgrounds/<name>-N.png`, kind `background`.

## Consequences

- One undo history and one file for motifs and backgrounds; Compare and the handout see layers through the same layout.
- Older planners cannot read a saved layout with `backgrounds:` (strict schema). Acceptable: there is one user and the planner updates from git.
- Rendering cost grows with layers × pixels; at the export's 40 px/cm a whole-arm layer adds a few hundred ms. Dilations are cached per gap within a render.
- Line patterns ignore `rotation_deg` (their painters draw upright); the tile patterns and images honour it.
- GPT Image tiles are only roughly seamless; the offset-and-blend fix hides the edge but can soften a blob in the middle of the tile. Jan reviews the tiles before they are committed.
