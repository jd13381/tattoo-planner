# Decisions made by Claude (for Jan's review)

Jan asked Claude (2026-11-03) to keep building without waiting for answers, decide open points itself and record each decision here. Jan reviews this list; anything he rejects gets reverted or changed. Design decisions (motifs, placement, style) are provisional guesses, never final.

Format: date, phase, the decision, the alternatives, how to change it.

## 2026-11-03

### Measurements

- **Shoulder circumference 40 cm instead of the measured 50 cm** (`config/measurements.yaml`). The 50 cm at 10 cm below the shoulder point was likely taken around the torso (Jan confirmed there is no bulge). 40 cm is slightly above the armpit value (38 cm). _Change:_ measure again and replace the value.

### Phase 4: structure

- **Phase 4 split into three parallel parts** with fixed contracts committed first: asset manifest schema (`src/assets/manifest.ts`), asset endpoints (`src/assets/types.ts`), pattern painter interface (`src/render/patterns/types.ts`).
- **Manifest fields beyond the brief (§12.4):** `version`, `page` and `bbox` (where an ideas.pdf image sits), `crop` (default cut-out). Unknown `kind` strings are allowed so Jan can add his own.

### Phase 4: procedural patterns

- **Pattern names** for `pattern:` in layouts: `snake-scales`, `hatching`, `starfield` (fillers), `meander`, `lotus` / `lotus-frieze` (bands). Unknown names render as a faint diagonal hatch instead of failing.
- **Look:** snake scales about 1.2 cm wide, scattering out into open skin at low density (§4.4); hatching at 45° with cross-hatching above density 0.5; starfield at most about 0.45 marks per cm². Band repeats are stretched slightly so a whole number fits around the arm and meets at the seam. These are sketch placeholders for balance checks, not designs.
- **Filler density default 0.3** when a layout leaves `density` out (same as the editor's default for new fillers).

### Phase 4: ideas.pdf ingestion and asset scan

Details in `docs/adr/0003-ideas-pdf-ingestion.md`.

- **Library:** mupdf.js (official MuPDF WebAssembly build, AGPL-3.0) as a dev dependency, run by `npm run ingest` / `npm run assets:scan` with Node's built-in TypeScript support. No Python, no native builds. AGPL is fine for a private tool that is never distributed. _Alternative:_ pdfjs-dist (more manual work, re-encodes JPEGs).
- **Ids and files:** `ideas-pNN-MM` and `ideas/page-NN-img-MM.png|jpg`, numbered in reading order (top to bottom, left to right). JPEGs are copied unchanged; everything else becomes sRGB PNG. Page text goes to `ideas/page-NN.txt`.
- **Notes and source:** headings (large text) and short labels above images ("Charon", "Skull") go into `source` and tags; captions go into `notes` of the nearest image (within about 1.3 cm, text above an image preferred). Pages 7–11 (MTG cards) have no heading of their own, so their `source` reads "after heading "Skull" on p.6": retag them as cards if you like.
- **Scan ids:** the file path as a slug (`arm-photos/anubis1_nr.JPG` → `arm-photos-anubis1-nr`), kind from the folder (`cards/` card-art, `refs/` reference, `existing/` existing, `arm-photos/` arm-photo). HEIC/TIFF/PSD files are reported but not catalogued (the browser can't show them).
- **Manifest merge:** your edits always win. Re-running only adds entries for new files and refreshes `page`/`bbox`. Entries are matched by file path; a deleted entry comes back while its file exists, so hide images with a tag instead of deleting the entry. A manifest with errors is never overwritten.

### Phase 4: which images the baseline layout uses

Written into `manifest.yaml` on Seafile (ids renamed, so `v1-baseline.yaml` stays as in the brief). Change by pointing an element's `asset:` at another id in the asset browser, or by renaming ids in the manifest.

- `medusa-ref-01` = ideas p.1 (the drawing you called "the closest I've found to what I have in mind").
- `skull-ref-01` = ideas p.6 image 2 (skull with snake and dagger), because the brief links skull, snake and dagger.
- `rhonas-card` = ideas p.7 (Rhonas the Indomitable card), default crop to the art box. The alternate frame on p.11 is also catalogued.
- `pegasus-ref-01` has no image yet: ideas.pdf contains no Pegasus. Reference mode shows a labelled placeholder.
- `anubis-photo` = `arm-photos/anubis1_nr.JPG` (palm up, no tape measure).
- Pages 7–11 recatalogued as `card-art` with the card names as tags (`rhonas`, `hazoret`, `athreos`, `polukranos`, `mtg`, `egyptian`/`greek`).

### Phase 4: reference mode and asset browser

- **New optional layout fields** for figures and the existing tattoo: `crop: { x, y, w, h }` (0–1 of the stored image; overrides the asset's crop), `image_rotation_deg` (0/90/180/270, clockwise, turns the photo; fine tilt stays `rotation_deg`), `flip` (mirror), `feather_cm` (soft edge, default 1 cm), `filter` (`none`, `grayscale`, `hatching`).
- **Filter default:** grayscale for elements centred below the elbow (the forearm's B&G look, §4), none above. Hatching is a 45° line screen, a rough stand-in for the engraving look.
- **Figure width:** if `w` is not set, the box takes the cut-out's proportions (0.55 × height until the image loads). If both are set, the image is fitted inside the box without distortion.
- **Image look:** images are multiplied onto the skin colour; grayscale and hatching brighten the photo so photographed skin disappears.
- **Red lines** are always drawn on top of everything, regardless of layer order (§4.3), at 90 % opacity.
- **Missing images** (e.g. `pegasus-ref-01`) render as a labelled placeholder box.
- **Asset server:** serves only files named in the manifest, image types only, never outside the data folder, local dev server only. A broken manifest entry is skipped with a warning; a YAML syntax error stops the listing.

### Phase 4: placements in v1-baseline (provisional, yours to change)

- **Anubis:** cut out of `anubis1_nr.JPG` (crop and quarter turn fitted by Claude), 26 × 12 cm from your measurements, lowest point 2 cm above the wrist crease (v moved from 0.12 to 0.203). The photo is fitted, not stretched, so it is drawn about 11 cm wide instead of 12; stretching it would undo the arm curvature in the photo.
- **Rhonas:** cut to the figure with hood and staff (crop fitted by Claude); without a crop the whole landscape card would make the box about 30 cm wide. The card background stays visible (background removal is a later optional step).
- **Overlaps:** Anubis currently overlaps `scales-forearm` and the edge of Rhonas. Not changed: placement is your call.

### Phase 5: export

Details in `docs/adr/0004-export.md`.

- **Browser-side export** (§11.1 left this to Phase 5): views, unwraps and the PDF are made in the running app; a new dev-server endpoint (`/api/exports`) only writes the files. _Alternative:_ a Node script driving a headless browser (large download, renders twice).
- **PDF library jsPDF 4.2.1** (MIT, pinned, no install script), loaded only when exporting. Its optional helpers (html2canvas, canvg, DOMPurify) come along in `node_modules` but are never loaded. _Alternative:_ pdf-lib (lower level, unmaintained since 2021).
- **Language English**, every handout text in `src/export/strings.ts` so a German version is one more object. _Change:_ tell Claude and it adds `HANDOUT_DE` and a language switch.
- **File names:** `exports/<layout>-<YYYY-MM-DD>.pdf` and the PNGs in `exports/<layout>-<YYYY-MM-DD>/`, `-2`, `-3`, … for repeats on the same day (by your local date); never overwritten.
- **No download fallback without `TATTOO_DATA_DIR`:** the button is disabled and says why, so exports only ever land on Seafile. _Alternative:_ offer a browser download (lands in Downloads).
- **Export only saved layouts:** disabled while there are unsaved changes, layout errors or images still loading, so every handout matches a YAML in git.
- **Page plan:** cover with the sketch note, front and back preview and legend; all four views on one landscape page; one page per view (blockout and reference side by side, the elements facing that side); the unwrap with cm grid in each mode; then elements, coverage per zone and open questions. A4, room for printing.
- **Views on white, no grid,** cropped to the arm with the same scale for all eight pictures; the unwrap pages keep the cm grid and turn the grey around the skin white. Views render at 1000 × 2400 px (the arm ends up about 450 × 2400), unwraps at 40 px per cm.
- **JPEG inside the PDF** (quality 0.9, about 2 MB per handout), lossless PNG files next to it.
- **"Facing this side"** lists an element on a view page when it reaches within a fifth of the circumference of that view's centre line; bands count for every side.
- **Open questions** in the handout: the nine questions of PROJECT_BRIEF.md §9 as of today (copied into `strings.ts`; remove answered ones there) plus what the layout leaves open: unset heights, guessed widths, missing images and placeholder measurements.
- **Fix on the way:** the blockout drew the existing tattoo's outline along the inner seam, which showed as a line down the middle of Anubis on the 3D arm (and in the export). The seam no longer counts as an edge.

### Phase 6: comparing variants

- **Compare is its own tab** (read-only), not a split mode inside the Layout tab, so the editor keeps its space. _Alternative:_ a "compare with…" toggle in the Layout tab.
- **One shared camera:** both arms use the same view buttons, and rotating, zooming or panning either arm moves the other (two WebGL canvases, a small camera bus). _Alternative:_ one canvas with two viewports (more code, no gain).
- **Coverage highlighting threshold 2 percentage points** (both values rounded first, as shown); red = more than the other variant, blue = less, difference in the tooltip. Smaller differences are rounding noise. _Change:_ `DIFF_THRESHOLD_PCT` in `src/metrics/coverage.ts`.
- **Element differences** are matched by id and list the changed fields (e.g. `rhonas changed: position`). A renamed element shows as "only in A" plus "only in B".
- **Unsaved edits can be compared:** while the Layout tab has unsaved changes, Compare offers "<name> (unsaved edits)" and preselects it against the saved file. The Layout tab now stays mounted when another tab is open, so unsaved edits are no longer lost by switching tabs.
- **Duplicating a variant = Save as…**, improved instead of adding a second button: it suggests a free name (`v1-baseline-2`, `try-3` → `try-4`) and copies the source file's comments into the new file under the line `# Variant <new>, duplicated from <old>; the comments below come from <old>.` (before, a new variant lost all comments). _Not added:_ deleting or renaming variants in the UI; delete the YAML file instead (git keeps the history).

### Phase 6: elbow-bent pose

Details in `docs/adr/0005-elbow-bend.md`.

- **Pose control** in every 3D view (Arm, Layout, Compare): Straight, Bent 90° and a 0–120° slider in 5° steps, one pose shared by all tabs. _Alternative:_ only a fixed 90° preset.
- **Bend model:** forearm swings towards the palm side, upper arm fixed; the bend is spread over ±6 cm around the elbow tip with a smooth (raised-cosine) curvature; the neutral line sits at 20 % of the elbow's depth from the outer skin, so the outer skin stretches only 2.7 cm at 90° and the inner side creases without folding over. Only vertices move: unwrap, editor, metrics and textures are unchanged. _Change:_ `BEND_DEFAULTS` in `src/arm/bend.ts`.
- **Limit accepted:** beyond about 100° the forearm and upper-arm flesh overlap in the inner crease instead of pressing together. The outer side and elbow tip (skull area) stay clean.
- **Export not bent (follow-up):** the PDF and PNGs still show the straight arm only; a bent page in the handout needs a pose parameter for the offscreen renderer and a new page, left for later.
- **Framing:** a fixed view re-frames as the pose changes; a camera rotated by hand keeps its place.

### Phase 6: brush for red lines on the 3D arm

- **Each stroke is a new line element** (`red-stroke-N`, smallest free N), red, with the width of the layout's first red line (1.5 cm from `red-stroke-1`), placed on top. With a line selected, the opt-in checkbox "continue <id>" appends the stroke at the line's nearer end instead. _Alternative:_ always appending to the selected line (too easy to change a line by accident).
- **Simplification:** Ramer–Douglas–Peucker with a 0.3 cm tolerance on the skin, measured exactly as lines are rendered (u scaled by the local circumference, the short way round the arm), so strokes across the inner seam stay intact. Samples closer than 0.2 cm are skipped while drawing; strokes under 1 cm count as a click and are dropped. Existing points of a continued line are never simplified away. _Change:_ constants at the top of `src/editor/stroke.ts`.
- **Drawing mode turns off rotation** (left-drag draws; right-drag pans, scroll zooms). The live preview is a thin line just above the skin; the real stroke appears in the texture when released.
- **YAML key order for new elements:** new elements are now written with `id` first, then `type` (as in the hand-written files); before, the schema's order put `type` first. Existing elements keep their order.

## 2026-11-04

### Pegasus reference

- **`pegasus-ref-01` = `refs/pegasus.jpg`** (Jan's image), added to `manifest.yaml` on Seafile with a default crop to the figure (`x 0.13, y 0.12, w 0.72, h 0.73`, fitted by Claude). The Pegasus height in v1-baseline stays unset (shown at 10 cm) until Jan sets it.

### Anubis from all photos

Details in `docs/adr/0006-anubis-projection.md`.

- **Projection instead of a flat cut-out:** the five Anubis photos are projected onto the arm's skin coordinates through the planner's own elliptical cross-section and blended into one patch. _Alternative:_ stitching the photos with homographies (wrong on a curved surface).
- **Built live in the browser, no script, nothing written to the data folder:** the browser already decodes the photos; building takes about half a second and is cached. _Alternative:_ `npm run project:anubis` writing `existing/anubis-unwrap.png` (goes stale after each calibration change, needs a Node image codec with EXIF handling, one more command for you).
- **Calibration in `config/projections/anubis.yaml`, numbers only:** silhouette edges as two straight lines, two marks at known distances along the arm, the view angle at wrist and elbow (the forearm twists when turned), quarter turn, weight. Photos are named by their data-folder path and found in the manifest by file, so asset ids may change.
- **Two marks with any distances instead of "wrist crease + one point":** the extra photos do not show the wrist marker line, so their lowest ink and ear tips are used.
- **Fitted calibration (yours to change in the Projection tab):** `anubis1_nr` is the reference (u_view 0.5, wrist marker at 0 cm, ear tips at 28 cm = 2 + 26). For the three extra photos Claude read edges and marks off the photos and then optimised the view angles, small shifts of the marks along the arm and of the edges so the photos agree where they overlap. Result: extra1 is turned slightly towards medial at the wrist (0.67 → 0.52 at the elbow), extra2 and extra3 towards lateral (0.29 → 0.49 and 0.15 → 0.39).
- **Fifth photo `anubis_extra4.png` (arm hanging, palm towards the body) at weight 0.25:** with the palm towards the body the thumb side faces the camera, so it shows the lateral side (fitted u_view 0.35 at the wrist → 0.47 at the elbow; marks at 3.49 and 28.63 cm), not the medial side. Everything it sees well is seen as well by another photo (no new coverage), and at about 18 px per cm on the arm it is the softest photo: at weight 1 it supplies 9 % of the patch and blurs the head and the black arm. At 0.25 it is calibrated and in the blend (6 % of the total weight) without changing the patch noticeably. _Change:_ raise `weight` in the Projection tab if a sharper copy replaces it. The medial side still needs a photo taken from the little-finger side.
- **Transparent pixels count as unseen:** a cut-out PNG's transparent background decodes as black and would read as ink, so pixels with alpha below 50 % are left out of the patch.
- **Blend:** weight cos(viewing angle)^4; each photo divided by its local skin brightness (1.5 cm window) so exposure and shading match; brightness above 90 % of the skin counts as bare skin (hides most hair). _Change:_ `blend:` in the YAML or the sliders.
- **Patch range** u 0.10–0.78, v 0.015–0.42 (from just above the wrist marker line to past the elbow) at 20 px per cm.
- **Layout field `projection: anubis`** on the existing element instead of a new element type; v1-baseline uses it. The element keeps `asset: anubis-photo` and its box as the fallback when no photo is available (e.g. no data folder). Missing photos are left out with a warning.
- **The projected tattoo sits where the photos put it:** its `position` and `size_cm` are ignored while the patch is shown, and the editor does not move it (it is locked anyway). The handout gives its size and position from the patch.
- **Blockout and metrics use a footprint** (ink smoothed over 1.5 cm, specks dropped, holes filled), so the existing-tattoo area follows the figure instead of a box. It is a rough area: hair on the lateral side adds a little, the palest cloak parts may count as open skin.
- **Projection tab** with draggable edges and marks, the model's skin grid drawn on each photo, view-angle and blend sliders, and a live preview on the unwrap and the 3D arm; Save writes the YAML and keeps its comments.
- **Grayscale only:** the patch has no colour; `filter: hatching` applies the line screen, `filter: none` shows it in grayscale.

### Editing reference images

Details in `docs/adr/0007-image-edits.md`.

- **New tab "Edit images"** instead of a button in the Assets panel, so the parallel UX overhaul of the Layout tab does not collide with it. _Change:_ an "Edit…" link from the Assets panel or the element panel can open it later.
- **Edits run as `claude -p` in a temp folder on a copy;** kept results go to `edits/<original-id>-edit-N.png` with a new manifest entry (`derived_from`, tag `edited`, the instructions in `notes`); the original file and its entry are never changed. Assigning the edit to a figure stays a click in the Assets panel. _Alternative:_ replacing the original, or switching every element that uses the original to the edit automatically.
- **Tools:** Bash, Read, Write, Edit, Glob, Grep allowed without asking; WebFetch and WebSearch blocked; missing Python packages (e.g. `rembg`) go into a virtualenv in `~/.cache/tattoo-planner/venv`.
- **Presets:** remove background, keep main figure only, remove text/watermark, stronger contrast, black and grey, trim to motif, mirror. They only fill the text field. _Change:_ `EDIT_PRESETS` in `src/edits/types.ts`.
- **Limits:** two edits at a time, 15 minutes each; unkept results are forgotten when `npm run dev` restarts.

### Generative edits with GPT Image

Details in `docs/adr/0008-generative-edits.md`. Engine choice (OpenAI API key, `gpt-image-2.5-sunburst`) was Jan's.

- **Direct API call from the dev server** instead of letting `claude -p` call the API: one HTTP request, about a minute, no Claude quota. _Alternative:_ Codex CLI with a ChatGPT plan (model not controllable).
- **Defaults:** `input_fidelity=high`, `quality=high`, size kept, PNG out; 2 variants per click (1–3 selectable), at most 4 generative jobs at once. _Change:_ `.env` (`TATTOO_OPENAI_*`) or `MAX_VARIANTS_PER_RUN` / `MAX_RUNNING_OPENAI`.
- **Prompt** wraps Jan's instruction verbatim with "apply exactly this change, keep everything else, no frame/text/watermark". _Change:_ `buildGenerativePrompt` in `src/edits/openai.ts`.
- **Two generative presets** (Simplify, Remove an object): generic wording only, no motif decisions.
- **Rule change:** "no uploading assets to third-party services" in CLAUDE.md and the brief now reads: the planner stays local, image-edit services are fine, nothing from the data folder in git (Jan, 2026-11-04).

### Image studio: new images and reference images

Details in `docs/adr/0009-create-images.md`.

- **One tab "Image studio" with modes Edit / Create** instead of a second tab. _Change:_ split later if the tab gets crowded.
- **Defaults for new images:** square 1024 × 1024, transparent background, 2 variants, name `generated` when empty. _Change:_ the selects in the tab, or the defaults in `ImageEditPage.tsx` / `editsApi.ts`.
- **Up to four references per request**, sent after the image to edit. _Change:_ `MAX_REFERENCES` in `src/edits/openai.ts` (the API takes up to 16).
- **Kept new images:** `generated/<name>-N.png`, kind `idea`, tag `generated`.
- **Create prompt** asks for one centred motif as a clean sketch on a plain background without frame, text, watermark or skin, unless the description says otherwise. _Change:_ `buildCreatePrompt`.

### Layout editor: 3D selection removed, resize handles redone

- **No click-to-select on the 3D arm** (Jan, 2026-11-04: it collided with the orbit gestures). The 3D view only shows the result; selection happens in the 2D editor and the elements list.
- **Eight resize handles** instead of one corner square: corners keep the aspect ratio around the opposite corner, edges stretch one side; Shift swaps, Alt resizes around the centre, Ctrl/⌘ turns snapping off. Sizes snap to 0.5 cm (a size holds its start value until it has moved a quarter centimetre, so a derived 9.9 cm width does not jump), at least 1 cm per side. A figure whose width is not set keeps it unset when resized in proportion; a free resize writes the width. _Alternative:_ aspect kept on every handle by default. _Change:_ `SNAP_CM`, `MIN_SIZE_CM` and `resizeOptions` in `src/editor/resize.ts`.

### UI: "Pro creative tool" design, wave 1 (tokens, shell, Layout tab)

Jan chose the "Pro creative tool" proposal (graphite chrome, translucent floating panels, one blue-violet accent).

- **Dark only** (`color-scheme: dark`, no light theme). The design is built around the skin being the only light surface; a second theme would double the token work for every tab. _Alternative:_ keep the old warm-paper light theme as `prefers-color-scheme: light`. _Change:_ add a light token block in `src/styles.css`.
- **Fonts bundled from npm** (`@fontsource-variable/inter`, `@fontsource/jetbrains-mono` 400/500, imported in `src/main.tsx`) instead of a Google Fonts link, so the planner keeps working offline. Fallback stack: system UI / system monospace. _Alternative:_ system fonts only (no new dependency).
- **Colour roles:** blue-violet `--accent` (#8f84ff) for selection, focus, the primary Save and pressed tools, also the selected element's outline drawn into the blockout texture (was yellow); sleeve red `--red` only for red lines, the brand mark and the Draw red line tool; a lighter `--danger` for errors so error text passes AA. Text 3 is `#868693` (the mockup's `#6c6c79` failed AA).
- **Layout tab as a full-bleed workspace:** tool rail (Select V, add figure/existing/filler/band/line, Draw red line R, shortcuts), 2D editor with a floating mode bar and a status bar (u/v and cm under the cursor, else the selection; zoom, Fit), 3D view with floating view bar, elbow pose, coverage and a right stack (Elements / Assets tabs, inspector). Variant, Undo/Redo, Save as…, Save and Export moved into the top bar; warnings became an "N notices" chip there (errors stay as banners). No separate pan tool: dragging the background pans, as before. _Change:_ `src/editor/LayoutPage.tsx`.
- **New shortcuts V and R** (select tool, toggle Draw red line), only without modifiers and outside text fields.
- **3D canvas is transparent** so the CSS gradient shows; Screenshot flattens it onto `VIEWER_BACKGROUND`. The PDF export keeps its white background.

### Image studio: editing sessions (2026-11-04)

Jan approved the session flow (proposal "Image studio: iteration flow review and proposal"). Details in `docs/adr/0010-editing-sessions.md`. The three open points of the proposal were decided by Claude:

- **Results not picked stay visible** under their version until the session closes (not dropped on pick), so variants can still be compared and swapped in. _Alternative:_ drop them on every pick. _Change:_ `pick` in `ImageEditPage.tsx` could call discard for the siblings.
- **Saving:** Save & close plus an optional "Save vK" per version; no automatic save on pick. _Alternative:_ save every picked version as a file.
- **Sessions are not written to disk:** they end with `npm run dev`, as the unsaved previews always did; the status bar says so. _Change:_ persist `EditManager.sessions` and the job folders.
- **One session per image**; starting again on an image with an open session resumes it.
- **After Save & close of a new image** the studio switches to Edit mode with the saved file picked.
- **Dark checkerboard and thumbnail background by default** (Jan: white backgrounds look odd); the Light switch stays for black line work on transparent backgrounds and is remembered per browser (`localStorage`).
- **Reload runs the scan** (`POST /api/assets/scan`) before re-reading the manifest (Jan: new files did not show up). It only adds entries, like `npm run assets:scan`, and reports images outside `cards/`, `refs/`, `existing/`, `arm-photos/` instead of cataloguing them (`ideas/`, `edits/`, `generated/`, `exports/` are filled by the planner and not reported). _Alternative:_ catalogue any folder, or watch the folder.
- **Tab order Layout, Image studio, Compare, Projection, …** (Jan, 2026-11-04: the two tabs he uses most side by side). The Image studio now stays mounted like the Layout tab, so switching back and forth keeps the picked image, the prompt text and the version on view; the session itself was already kept by the dev server.

## 2026-11-05: product rework (roadmap phases B and C)

Jan asked Claude (2026-11-05) to run Phase B and then work through Phase C on its own, deciding open points and logging them here.

### Architecture

- **Bodies are built from lofted regions** (`docs/adr/0011-bodies-and-regions.md`): arms, legs and torso are lofts like today's arm; head, neck, hands, feet and joints are neutral, non-editable shapes. Sample bodies `female` and `male` are parameter sets, not meshes. _Alternative:_ a CC0 MakeHuman mesh with a UV atlas (realistic, but not cm-true and much more work). _Change:_ a mesh can be added later as another geometry source per region.
- **Torso seam on the left flank**, so chest and back pieces stay whole in the unwrap. _Change:_ `seam` of the torso region.
- **A-pose with palms forward**, so the arm keeps today's conventions.
- **One project folder per person** (`docs/adr/0012-project-folder.md`) with `project.yaml`; current project remembered in `~/.config/tattoo-planner/config.json`, `TATTOO_DATA_DIR` still wins. Jan's Seafile folder opens as a legacy project and keeps using the repo's `config/` until "Move into project" (or `npm run migrate`) copies it over.
- **Server code moves out of the Vite plugins** into `server/`, mounted by Vite in dev and by the desktop app.

### Cuts and simplifications (roadmap Phase C step 6)

Jan approved the cuts (2026-11-05); the details below were decided by Claude. Details in `docs/adr/0013-builtin-image-operations.md`; ADR 0003 and ADR 0007 are marked superseded.

- **ideas.pdf ingestion removed** (`npm run ingest`, mupdf, `src/assets/ideasLayout.ts`, `src/assets/server/pdfExtract.ts`, their tests). `slug()` moved into `src/assets/scan.ts`. The manifest schema keeps `page` and `bbox`, so entries extracted into `ideas/` earlier stay valid; `ideas/` stays a managed (not scanned) folder. _Alternative:_ drop `page`/`bbox` from the schema (would break Jan's manifest). _Change:_ `src/assets/manifest.ts`.
- **package-lock.json updated with `npm uninstall mupdf --package-lock-only`** instead of a plain `npm uninstall`, because this worktree shares `node_modules` with other checkouts that still had mupdf. _Change:_ run `npm ci` after merging to drop the package locally.
- **Built-in operations run in the browser, the server only checks and stores the PNG** (`POST /api/edits/sessions/<id>/apply?step=…&base=N`, body `image/png`). _Alternative:_ run them in the dev server (needs a Node image codec such as `sharp`). _Change:_ `applyOp` in `src/edits/ImageEditPage.tsx`, `apply` in `src/edits/server/editsApi.ts`.
- **A built-in result becomes the next version at once**, without "Continue with this": the operation is deterministic, there is nothing to choose. _Alternative:_ show it as a result to pick, like generative variants. _Change:_ `apply` could leave `session.versions` alone.
- **Race guard `base`:** the page sends the number of versions it saw; the server refuses (409) when the session changed meanwhile, checked before and after copying the files. _Alternative:_ send the job id of the source version.
- **Upload limits:** complete PNG only (signature, IHDR, ends with IEND), at most 50 MB (as the existing outputs) and 100 megapixels. _Change:_ `MAX_OUTPUT_BYTES`, `MAX_OUTPUT_PIXELS` in `src/edits/edit.ts`.
- **Operations and defaults:** remove background (tolerance 32, soft edge 2 px), line art (level 128, smoothing 1 px), levels / contrast (black 20, white 235), black and grey, invert, rotate (90° left / right, 180°), mirror (left to right only). Levels shows black and white point; gamma stays in the function but not in the panel (two controls at most). Tolerance is the largest channel difference to the border colour (median of the opaque border pixels); the soft edge fades inward only, so no removed background comes back. _Change:_ `BUILTIN_OPS` in `src/edits/builtin.ts`.
- **No crop and no eraser brush in the studio:** crop exists per layout element and asset; a brush needs a canvas editor. **No segmentation model for photos** (roadmap §4.4 leaves it optional): large dependency and weights; generative edits cover the hard cases.
- **Live preview on a copy of at most 640 px**, pixel-sized controls scaled to it; Apply runs on the full image. _Change:_ `PREVIEW_MAX_SIDE` in `src/edits/builtin.ts`.
- **Built-in is the default engine**, and while it is chosen the canvas at the last version shows the preview instead of the grid of generative results (switching to Generative or clicking an earlier version shows them). _Alternative:_ GPT Image as default (needs a key).
- **Undo** in the built-in run area drops the last version (it stays visible as a result of the version before until the session closes), without asking: a built-in step is cheap to redo. Generative steps keep the existing confirm on "Continue from vK".
- **Presets** are generative only now: Simplify, Remove an object, and Remove text / watermark (moved from the claude presets, since filling in removed text needs new pixels). The other claude presets (remove background, keep main figure only, stronger contrast, black and grey, trim to motif, mirror) are covered by built-in operations or dropped. _Change:_ `EDIT_PRESETS` in `src/edits/types.ts`.
- **Notes of a saved image** name the built-in steps by their parameters, e.g. `"Line art (level 128, smoothing 1 px)" (built-in)`. Notes of older edits that say `claude -p` stay as they are.
- **No component test for the studio page:** `tsconfig.node.json` (which type-checks `tests/`) has no JSX setting, and adding one only for this would widen the change. A throwaway jsdom render test was run once (no key: built-in usable, generative setup shown, create disabled; with a key the first run opens the session) and not committed.

### Image studio UX review items (coordinator, 2026-11-05)

- **Generative availability checked once up front** (the overview the studio already loads). Without a key the Generative engine card says "needs an API key", choosing it shows one setup note (key from platform.openai.com, `TATTOO_OPENAI_API_KEY` in `.env`, restart), and the GPT run button, Create mode's run button and its name / format / background fields are disabled. No session is opened by a request that would fail. The built-in engine stays fully usable. _Alternative:_ hide the Generative engine without a key (then nobody learns it exists).
- **No "Start editing" gate:** picking an image shows the engines at once; the first Apply or GPT run opens the session (for a new image, the first Create run). _Alternative:_ keep the explicit start (one more click per image).
- **One hint on the canvas:** the head row above the canvas says "The next run starts here" (or "Preview of … · the next run starts here"); the strip only outlines the last version, and the caption under the large image is gone.
- **Plain wording in the studio:** "Unsaved versions are lost when the planner closes", "No data folder is set up …", "Cannot reach the planner's edit service … Restart the planner." The API key note still names `TATTOO_OPENAI_API_KEY` and `.env`, because that is the only way to set a key until the settings screen of roadmap §4.3 exists. _Change:_ point it at the settings screen then.
- **A disabled primary button looks disabled** (hairline, faint text) instead of a dimmed accent, scoped to the studio (`.studio button.primary:disabled`) so other tabs are unchanged. _Alternative:_ change it for every tab (better consistency, but outside this step).
- **ADR 0011 table reformatted** (Prettier only) because `npm run check` failed on it on this branch's base.

### Phase B

Jan's wishes (2026-11-05) and the UX review findings, implemented on `work/phase-b`. Format: decision; _Alternative_; _Change_.

- **Navigation: Layout, Image studio, Compare, Assets, Settings.** Settings holds Project (the old Data folder page, unchanged), Body & measurements (the old Arm page), Projection (the old calibration page) and Image generation (OpenAI key status and setup). Routes are `#settings/<section>`; the old hashes `#arm`, `#projection`, `#data` still open their section, and the Settings tab reopens the section seen last. _Alternative:_ a Settings dialog over the current tab. _Change:_ `src/settings/routes.ts`.
- **Assets tab** = thumbnail grid of every catalogued image (search, kind, tag, "Show hidden"), a detail column with the image, kind, file, source, "Used in" (element ids per saved layout) and editable tags and notes, plus Hide / Unhide; a one-line folder status on top (state, path, file count, structure, Look for new images, Check folder, Project settings). Edits go through a new `PATCH /api/assets/entries/<id>` that changes only `tags`, `notes` and `hidden` in `manifest.yaml`, keeping comments and key order, and refuses a manifest with errors. "Used in" counts saved layouts only, not unsaved edits. _Alternative:_ edit the YAML by hand. _Change:_ `src/assets/AssetsPage.tsx`, `updateManifestEntry` in `src/assets/manifestDoc.ts`.
- **`hidden: true` in the manifest** leaves an image out of the Layout pickers (the Assets side tab and the image picker); an image a figure already shows stays listed for it. The Image studio list is not filtered yet (it is being reworked separately). _Change:_ `pickableAssets` in `src/assets/filter.ts`.
- **Change image:** the element panel shows the figure's image large at the top, with **Change image** (opens a picker panel next to the button: search, kind, the grid; click assigns and closes, Enter assigns the first hit, Esc or a click outside closes) and ‹ › arrows that step through the visible images of the same kind (manifest order, wrapping). A selected figure in the 2D editor shows a floating **Change image** button at its top-right corner (hidden while dragging). Each assignment is one undo step and drops the old image's crop, as before. The free-text `asset` field is gone from the panel (the YAML still takes any id). The Assets side tab stays for browsing. _Alternative:_ a modal dialog. _Change:_ `src/assets/ImagePicker.tsx`, `ImageSwap` in `ElementPanel.tsx`.
- **Layout mode switch:** Reference first and the default; **cm grid** dropped (Blockout with Grid on shows the grid). The renderer keeps its grid mode for the Body page.
- **Export status** moved from the top bar into a floating card above the toasts: progress bar and step, then "Saved in the project's exports folder as <name>.pdf, with N PNGs beside it" with **Open PDF** (served read-only by a new `GET /api/exports/<base>.pdf`, same name rules as writing, symlinks out of `exports/` refused), or the error text inline. With unsaved edits the button reads **Save & export** and saves first (a failed save stops the export) instead of being disabled. _Change:_ `src/export/ExportButton.tsx`, `findExportFile` in `exportsApi.ts`.
- **Handout:** title = layout name, subtitle = its description (else "A placement sketch for the tattoo artist"); legend with generic types only ("Existing tattoo (outlined)", "Line (brush stroke)"); the fixed brief §9 design-question list is gone, the per-layout "Not decided in this layout yet" list stays; the note no longer mentions card art or the sleeve. _Change:_ `src/export/strings.ts`.
- **New figures and existing tattoos** start at 10 × 6 cm and unlocked. **"Width assumed"** is only flagged when the element has an image that could set the width; a plain box is not a warning. New elements land on the first free spot along a diagonal (+0.04 u, −0.04 v) from the editor centre, so repeated adds fan out instead of stacking. _Change:_ `NEW_FIGURE_SIZE_CM`, `NEW_ELEMENT_STEP`, `freeSpot` in `src/editor/edit.ts`.
- **Validation errors:** a duplicate or invalid id shows under the id field of the selected element; all other errors (and id errors of other elements, by element id) float as a notice over the top of the workspace instead of pushing it down. _Change:_ `splitIssues` in `src/editor/layoutOps.ts`.
- **One Line tool** (brush, key R kept) replaces "Add line" and "Draw red line"; the 3D bar's Draw button is gone. While it is on, the bar over the 3D arm has a colour picker (`<input type=color>` plus red, black, grey, blue swatches). Red is stored as `red` (id `red-stroke-N`), any other colour as `#rrggbb` (id `stroke-N`). Blockout still draws every line in the line category's red; Reference uses the colour. The element panel's line colour uses the same control. _Alternative:_ a separate colour per stroke in blockout too. _Change:_ `LINE_SWATCHES` in `edit.ts`, `applyStroke` in `stroke.ts`.
- **Pattern fields are selects:** fillers offer snake-scales, hatching, starfield; bands meander, lotus (`lotus-frieze` is an alias and not offered). An unknown name from the YAML stays selectable, marked "(unknown)". _Change:_ `FILLER_PATTERNS`, `BAND_PATTERNS` in `src/render/patterns/index.ts`.
- **Filler label** sits at the middle of the wrapped u range (`wrappedMidU`), so a filler across the seam is labelled on itself.
- **Developer details:** the render time shows only with `?debug` in the URL; user-facing text no longer names `config/…` paths, `.env` or `npm run dev` outside the setup pages (Settings → Project and Image generation explain the setup and keep the commands there). "Save as…" confirms with "Saved as a new variant: <name>".
- **Coverage table** (floating) has short text column heads (Fig., Exist., Fill., Band, Line, Open) next to the swatches.
- **Element panel:** the filter select no longer lists the auto value twice (e.g. "auto (none)" and "none"); `style` and `red accents` are no longer in the panel (still in the schema, the YAML and the handout).
- **Switching variants with unsaved edits** opens a small popover under the picker with Save / Discard / Cancel instead of `window.confirm`.
