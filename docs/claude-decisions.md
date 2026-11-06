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

### Body regions and sample bodies (roadmap Phase C step 3, ADR 0011)

- **Mirrored regions via a flag, not a reflected mesh.** The right arm, the left leg and the torso turn u the other way round (seen from outside u grows to the right), so `RegionProfile.mirrored` and `screenSign` carry the direction through every u ↔ screen conversion (shapes, unwrap rows, reference images, grid, editor, nudge, brush, coverage, PDF marks) and the mesh builder turns its rings the other way. Pictures are never mirrored and stored u keeps the ADR's meaning (0.25 lateral on both arms, 0.25 front on the torso). _Alternative:_ keep the pipeline in one direction and convert u at load and save (stored values would differ from what the editor shows). _Change:_ `src/body/uv.ts` `screenSign`, `REGIONS[*].mirrored`.
- **Legs: u = 0 front (shin), 0.25 lateral on both sides**, like the arms. _Alternative:_ 0.25 towards the body's left on both legs. _Change:_ `REGIONS` and `viewsFor`.
- **Torso editor centres on Front (u = 0.25) or Back (0.75)**, not on the texture centre (right flank). _Change:_ `editorCentres` in `src/body/regions.ts`.
- **The cm grid now follows the editor centre** (it used to disappear on the Inner view), since the torso is never edited centred on its texture centre. _Change:_ `paintGrid(…, { centerU })`.
- **Unmeasured right arm / leg copies the measured other side** before falling back to the sample, so Jan's right arm matches his left. _Alternative:_ sample values only (ADR wording). _Change:_ `MIRROR` in `src/body/body.ts`.
- **Male sample arm = the old placeholders** (33/27 cm …), so an unmeasured left arm looks exactly as before on the default body. All other sample values are rounded estimates for ≈165 / ≈178 cm, not anthropometric data. _Change:_ `src/body/samples.ts`.
- **Torso aspect ratios and the "shoulder line" circumference are inputs** (sample values, `shape:` section in `measurements.yaml`), since they cannot be taped and differ more between bodies than an arm's. _Change:_ `INPUT_SECTIONS.torso`.
- **measurements.yaml:** `regions:` takes any subset of a region's keys; the old top-level arm blocks stay the left arm, and giving the left arm in both places is an error. `existing` and `notes` became optional. _Change:_ `src/config/measurements.ts`.
- **Region picker in the top bar** left of the variant picker, with the number of layouts per region; a region without a layout opens an empty unsaved `<region>-1` layout (not marked dirty until edited), written with `region:` right after `name:` on the first save. _Alternative:_ an empty state with a "New layout" button.
- **Full-body view as a switch over the Layout tab's 3D view** (region view or full body), straight A-pose (no elbow bend), other regions painted in the current mode at 8 px/cm with their last opened (else first) layout. Clicking a region switches the editor (asking first when there are unsaved edits). _Change:_ `src/viewer/BodyViewer.tsx`, `src/editor/RegionTextures.tsx`.
- **Compare follows the region open in the Layout tab** (no picker of its own). _Change:_ `region` in `ComparePage.tsx`.
- **Handout wording per region:** the left arm keeps `HANDOUT_EN` unchanged (Jan's sleeve, design questions included); other regions get their own title, views, lines, zones and landmarks and no design questions. _Change:_ `handoutText` in `src/export/strings.ts`.
- **Photo projection only on the left arm** (ADR 0006 models the left forearm); elsewhere the element falls back to its box with a notice.
- **Torso 3D region view frames with 1.5 × the margin**, since the short, wide torso otherwise fills the canvas behind the floating panels. (The live views now use the panel-aware framing of Measuring wizard (C4); the export keeps this.)

### Project folder and server (C1, C2)

Implemented on `work/project` (docs/adr/0012-project-folder.md, "Implementation"). Format: decision; _Alternative_; _Change_.

- **One `createApi()` middleware for every shell**, routing by prefix like Connect's `use(prefix)`; Vite mounts it in `configureServer` and `configurePreviewServer` through a plugin written inline in `vite.config.ts` (so `server/` has no Vite import). _Alternative:_ one Vite plugin per area as before. _Change:_ `server/api.ts`.
- **The current project is asked on every request** (a config read and two `stat`s), so opening a project needs no server restart. _Alternative:_ cache it in memory. _Change:_ `ProjectStore` in `server/project/store.ts`.
- **Switching, creating or closing a project reloads the page.** Body, measurements, layouts and assets are loaded once by many hooks; a reload resets them all. _Alternative:_ a project context that every hook listens to. _Change:_ `reloadForProject()` in `src/project/api.ts`.
- **Measurements load before the app modules** (`main.tsx` awaits `/api/project` and `/api/project/measurements`, then imports the app), so `useArm` keeps reading module constants and its signature is unchanged. _Alternative:_ make the measurements React state (touches every page that reads them). _Change:_ `src/project/projectData.ts`.
- **Body and height: `project.yaml` first, then `measurements.yaml`** (coordinator, 2026-11-05: the bodies step put them into `measurements.yaml` as an interim place). _Change:_ `withProjectBody()` in `src/project/projectData.ts`.
- **`TATTOO_DATA_DIR` locks the project**: open, create and close answer 409 and the project screen hides them. Any folder it names without `project.yaml` counts as legacy (old behaviour, even without a manifest). _Alternative:_ let the UI switch away for the session. _Change:_ `refuseWhenLocked()`.
- **Create:** a folder name field under the picked location (default: the project name, made safe), or the location itself when emptied; the parent must exist; dot files do not make a folder non-empty; a legacy folder is migrated with the given name and body. New projects get an empty `first-sketch` layout on the left arm, because the Layout tab draws nothing without a layout. _Change:_ `create()` in `store.ts`, `NewProjectForm`.
- **Migration names the project after its folder, body male**, and creates `layouts/` and `projections/`; layouts are copied unchanged (no `region:` means `arm-left`). It is idempotent; the summary lists created / copied / kept files. _Change:_ `server/project/migrate.ts`.
- **Legacy folders read layouts, projections and measurements from the repo's `config/` only while it exists**; without it (packaged app) they use the folder itself. Writing measurements of a legacy folder (`PUT`) writes `config/measurements.yaml`, as editing by hand did.
- **Folder browser:** real paths, home only, symlinks only when they stay in home, dot folders hidden, 500 entries. Open accepts only a project or legacy folder ("Choose this folder" is disabled elsewhere); New accepts any folder as location. _Change:_ `server/project/browse.ts`, `FolderPicker.tsx`.
- **`npm run serve` defaults to port 4322** (dev 4320, preview 4321), `0` picks a free port, and refuses requests whose `Host` is not `127.0.0.1:<port>` or `localhost:<port>` (DNS rebinding). _Change:_ `server/standalone.ts`.
- **Writes to layouts and projections now also refuse cross-site requests** (`Sec-Fetch-Site`), like every other write. Otherwise endpoint behaviour is unchanged.
- **Settings → Project replaces the Data folder page:** project header (name, chip, path, Open other / Close), details form (name, body, height 50–260 cm; body or height changes reload), Move into project with its summary, then the folder's structure and files. The setup steps with `.env` and `npm` commands are gone from the page (README covers them); the structure list shows the project layout and older locations only where they hold files. _Change:_ `src/project/ProjectPage.tsx`, `src/data/expected.ts`.
- **`config/` wording left in the Body & measurements and Projection pages** (`ArmPage`, `MeasurementsPanel`, `ProjectionPage`): the wizard steps working on those pages in parallel own them. _Change:_ say "measurements.yaml" / "projections/" there.

### Measuring wizard (C4)

Implemented on `work/measure`. Format: decision; _Alternative_; _Change_.

- **Settings → Body & measurements is one page for every region:** sample body and height on top, a region select, the region in 3D with the cm grid (the old arm page generalised), and a form generated from `INPUT_SECTIONS`. Empty fields show the value in use as placeholder; tags say measured / edited / sample / other side; ↺ resets a field. _Alternative:_ a page per region kind. _Change:_ `src/settings/BodyPage.tsx`.
- **Edits are one shared draft** (`useArm`: per-region values, body, height; `null` clears a file value), resolved live in every tab through `resolveBody`, saved together with **Save**. Typing the file's own value drops the edit. _Alternative:_ save every field on blur (no way to try values). _Change:_ `MeasurementDraft` in `src/config/measurementsDoc.ts`, `fieldStatuses` in `src/body/fieldStatus.ts`.
- **Writing keeps the file byte for byte where nothing changed:** values that exist are replaced in the text at their source range (alignment and trailing comments survive); new keys and removals go through the yaml Document API and only the top-level blocks they change are re-rendered (yaml's printer would otherwise re-align every comment in Jan's file). The left arm stays in the legacy top-level blocks when the file uses them (a new legacy section lists all its keys, null where unmeasured); everything else goes under `regions:` in region, section and key order, and emptied blocks are removed. _Alternative:_ always `doc.toString()` (reformats comments). _Change:_ `updateMeasurementsText`.
- **Saving:** `saveMeasurementsText(text)` (`src/viewer/measurementsStore.ts`) PUTs the whole text to `/api/project/measurements`; body and height go to `project.yaml` (`PATCH /api/project`) in a project folder, and the height then leaves `measurements.yaml`; in a legacy folder they stay `body` / `height_cm` in `measurements.yaml`. After a save the page keeps the returned text in a small store instead of reloading. The copy-as-YAML panel is gone. _Change:_ `save` in `src/viewer/useArm.ts`.
- **The wizard starts with the body height, then the region's taped values in measuring order** (a position right after the circumference whose tape it measures to; arm order from `docs/measuring.md`). The torso's shoulder line and its three shape ratios have no step (no tape gives them) and stay in the form. Values go into the draft as typed; **Skip** restores the value the step opened with, **Leave** keeps what was entered. Switching region restarts the wizard. _Change:_ `wizardSteps`, `untapedKeys` in `src/body/measureGuide.ts`.
- **Instructions in English, short, from `docs/measuring.md`** for the arm; legs and torso use the landmarks of `src/body/profile.ts` (ankle, knee centre ±8 cm, hip crease; navel, lowest ribs, chest at the armpits, neck base, shoulder points). _Change:_ `ARM_STEPS`, `LEG_STEPS`, `TORSO_STEPS`.
- **Diagrams are hand-built SVG schematics** (outline by half-width knots per kind, limbs drawn wider than to scale so the tape stays readable, landmarks labelled on the left, a girth as a front/back ellipse, a length as an arrow beside the outline). _Alternative:_ render the 3D region with the tape line (heavier; the live 3D view is next to it anyway). _Change:_ `src/settings/MeasureDiagram.tsx`.
- **Body height must be 50–260 cm to save** (the project schema's range), but any positive value previews. **The `existing` (Anubis) size is read once at load**; the page never edits it.
- **3D framing clear of floating panels:** fixed views fit the mesh's bounding box into the part of the canvas the `.float` panels leave free (largest panel first, cut away by the side that keeps the most room for the region's on-screen aspect) and move the picture there with `setViewOffset`, so orbiting still turns about the region. Used in the Layout tab's region and full-body views and on this page; the export renderer keeps `viewCamera`. _Alternative:_ fixed insets per page. _Change:_ `freeInsets`, `fitCamera` in `src/viewer/views.ts`, `useFreeInsets`.

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

### Desktop app (C7)

Implemented on `work/desktop` (`docs/adr/0015-desktop-app.md`). Format: decision; _Alternative_; _Change_.

- **electron-builder, not Electron Forge**: DMG, notarisation and "sign only when the secrets exist" come built in, and the roadmap named it. _Alternative:_ Forge with its DMG and notarize makers. _Change:_ `desktop/electron-builder.config.mjs`, the `dist:*` scripts.
- **Electron 45.1.0, electron-builder 26.18.0**: the newest releases older than 7 days on 2026-11-05 (installed with npm 11, which applies `.npmrc`'s `min-release-age`; npm 10 ignores it). Electron 45 has no postinstall and fetches its binary on first launch, so no `npm rebuild --ignore-scripts=false` is needed. _Change:_ `package.json`.
- **tsc compiles the shell and the server into `dist-desktop/`** (`rewriteRelativeImportExtensions`), no bundler. _Alternative:_ esbuild, or Node's type stripping inside Electron (works in a checkout, not reliably from `app.asar`). _Change:_ `tsconfig.desktop.json`.
- **Unsigned by default, signing switches itself on**: ad-hoc signature (`identity: "-"`, needed on Apple Silicon) unless `CSC_LINK`/`CSC_NAME` exist; notarised only with a certificate plus `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`. Jan has not decided on the Apple Developer account (roadmap §7). _Change:_ add the repository secrets; nothing in the code.
- **Two DMGs (arm64, x64)**, not one universal app. _Alternative:_ `arch: ["universal"]` (one file, twice the size). _Change:_ `mac.target` in the builder config.
- **Tags create a draft release**, so Jan reviews the notes before it is public; a manual run only uploads the workflow artifact. _Alternative:_ publish directly. _Change:_ drop `--draft` in `desktop.yml`.
- **The Keychain key wins over `TATTOO_OPENAI_API_KEY`** when both exist (model and options still from the environment); with neither, generative edits stay off. In the desktop app Settings shows "the key from the environment is in use" when only `.env` has one. _Change:_ `settingsFromEnv()` in `server/settings.ts`.
- **Key check before saving:** text without spaces, at most 512 characters, starting with `sk-` (every OpenAI key format). No test request to OpenAI on save: that would be a network call the user did not start. _Change:_ `keyProblem()` in `desktop/keyStore.ts`.
- **Linux `basic_text` storage counts as unavailable**, so no key is stored with a fixed password there. Only matters for a Linux build, which is not released.
- **One settings folder for `npm run desktop` and the installed app** (`userData` set to "Tattoo Planner" explicitly; Electron would use the package name `tattoo-planner` in a checkout). _Change:_ `app.setPath("userData", …)` in `desktop/main.ts`.
- **CSP and request blocking in the shell, not in `dist/index.html`**, so `npm run dev` (Vite's HMR) is unaffected. Checked in the packed Linux app: the start screen, a new project's Layout tab with WebGL and Settings load without CSP errors.
- **Fuses:** `runAsNode`, `NODE_OPTIONS`, `--inspect` off, only `app.asar`, cookie encryption; asar integrity validation off until the app is signed. _Change:_ `electronFuses` in the builder config.
- **"Show in Finder"** next to the project path in Settings → Project (desktop only), and the Image studio's key note now links to Settings → Image generation instead of naming `.env`.
- **Placeholder icon**: a dark rounded tile with a light forearm and two red bands, drawn by `scripts/desktop-icon.mjs`. _Change:_ that script, or a designed icon before the public release (as SVG source rendered at build time, still no committed binary).
- **`--no-sandbox` skips `app.enableSandbox()`**, so the app can be smoke-tested as root in a Linux container; per-window `sandbox: true` stays.
- **Not verified here (Linux container):** the macOS build, `.icns` conversion, Keychain, native folder dialog, Finder reveal and the unsigned first start. Check on Jan's Mac: `npm run desktop`, then `npm run dist:mac` and open the DMG.

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

### Guided projection (C5)

Roadmap Phase C step 5, ADR 0014. Format: decision; _Alternative_; _Change_.

- **The forward model takes the region's convention** (u = 0 angle, `mirrored`) and interpolates `u_view` up to the region's twist reference (elbow, knee, neck). Left-arm results are unchanged bit for bit. _Alternative:_ a separate model per region kind. _Change:_ `sectionView`, `twistReach` in `src/projection/model.ts`.
- **Projection files get an optional `region:`** (default `arm-left`); the keys keep the arm's names (`u_view.wrist` / `elbow`, cm from the wrist crease) for every region, so `anubis.yaml` stays as it is. _Alternative:_ neutral keys (`start` / `far`) with a migration. _Change:_ `src/projection/schema.ts`.
- **Settings → Projection opens a list** of existing tattoos (photo, body part, state, layouts) with Add existing tattoo, Edit (wizard, prefilled) and Advanced (the former page, unchanged apart from region-aware labels, a back button, no `config/` paths in messages, and the 2D preview centred on the patch instead of the inner line). _Alternative:_ the wizard as a dialog over the Advanced page. _Change:_ `src/projection/ProjectionSettings.tsx`.
- **Wizard steps:** name + body part, photos, then per photo Turn → Outline → Distances → Side, then Check and save. Turn comes first (points are placed in the turned photo); turning keeps placed points on the picture and untouched ones on screen. Next is disabled with a plain reason (`stepIssue`). Steps already answered can be reopened from the step rail. _Alternative:_ the order of the brief's list (turn last). _Change:_ `wizardSteps`, `stepIssue` in `src/projection/wizard.ts`.
- **Eight orientation drawings** (a slice through the limb seen from above, camera below, the four centre lines labelled), computed with the model's maths, plus a fine-tune slider; a "twisted" switch adds a second choice for the far end. _Alternative:_ four drawings (too coarse for photos taken between two sides). _Change:_ `facingOptions`, `sectionSketch`.
- **The skin grid shows from the Distances step on**, not on Outline, because before the marks are set it would be at the wrong scale and mislead.
- **Derived values:** patch area from the facing directions (±0.25 u) and the marks (−1 cm … +2 cm); blend and resolution defaults for new tattoos, kept from the file on edit; the saved area kept on edit unless "Fit the covered area to the photos" is on. Distances of a newly picked photo copy those of the previous one. _Change:_ `fitArea`, `newPhoto`, `toCalibration`.
- **Save links the tattoo into a layout of its region:** one that already shows it, else the one open in the Layout tab, else the first, else a new `<region>-1`; selectable before saving. The element is locked, at the patch middle, with `size_cm.h` = patch height. A layout with unsaved edits in the Layout tab is not written (message). Layout lists in other tabs learn about it through a `tattoo-planner:layout-saved` window event; an open layout without unsaved edits reloads. _Alternative:_ only write the projection and let the user add the element. _Change:_ `src/projection/layoutLink.ts`, `LAYOUT_SAVED_EVENT` in `src/layout/useLayouts.ts`.
- **New projection files** are written in the hand-written style (points and short lists on one line) so they pass Prettier and read like `anubis.yaml`. _Change:_ `newProjectionText` in `src/projection/yamlDoc.ts`.
- **No automatic detection or cross-photo optimisation yet** (ADR 0014, Alternatives); the Advanced page stays for fine-tuning.

### Sample project and docs (C8)

Roadmap Phase C step 8, ADR 0012 ("Sample project"). Format: decision; _Alternative_; _Change_.

- **Placeholders are PNGs drawn on the server** from signed distance fields (compass, moon, wave, fern, mandala, mountains, sun, swallow: dark line work with a muted red accent on opaque off-white paper, 512 px; paper rather than transparency because the Assets grid and the Image studio show images on a dark checkerboard, where dark ink on transparency is invisible, and reference mode multiplies paper away on the skin), encoded by a small PNG writer with `node:zlib` and cached per motif. The sample's `manifest.yaml` names ordinary `images/<motif>.png` files; the server draws the one whose base name is a motif. Everything downstream (textures, crops, the handout, the Image studio, the scan) sees a normal PNG, and "Save as new project" writes the same bytes as real files. Rendering is deterministic (same motif and size → same bytes). _Alternative:_ SVG generated in code (simpler to draw, but the planner does not accept SVG anywhere: the asset server, the edits and the scan would all need a new type, and served SVG needs script hardening); drawing on a canvas in the page (the server could not copy the images on "Save as"). _Change:_ `src/sample/placeholders.ts`, `server/png.ts`, `placeholderPng` in `server/project/sample.ts`.
- **The sample is read-only by one guard in front of the API**, not by checks in every handler: while it is open, `server/sampleApi.ts` answers every non-GET request below `/api/layouts`, `/api/projections`, `/api/assets`, `/api/edits`, `/api/exports` and `/api/project` (except `open`, `create`, `close`, `open-sample`, `save-sample`) with 409 and "The sample project is read-only. Save it as a new project (Settings → Project) to keep changes." `GET /api/exports` and `GET /api/edits` report exports, built-in and generative edits as unavailable with the same text, so those buttons are disabled with the reason instead of failing late. The store also refuses `update`, `migrate` and `writeMeasurements` itself (defence in depth). _Alternative:_ a `readOnly` flag passed into each handler (more code paths to forget). _Change:_ `isSampleWrite`, `handleSampleRequest`, `createApi`.
- **Opening the sample is kept in memory only**, never in `config.json`: the sample's path is inside the app (`app.asar` in the desktop app) and changes with every install, and a restart should not land in a read-only project. The remembered project and the recent list stay untouched; **Close project** goes to the start screen as for any project. With `TATTOO_DATA_DIR` set, open-sample and save-sample answer 409 like open and create, and the start screen disables all three. _Alternative:_ remember a `sample: true` marker. _Change:_ `openSample`, `readOnly` in `server/project/store.ts`; `sampleAvailable` and `sample` in `ProjectStatus`.
- **"Save as new project"** lives in Settings → Project (the header chip "Sample project (read-only)" leads there) and reuses the new-project form (name, body, location, folder name), prefilled with "My sample project" and the sample's body. The target must be empty or new, like Create, and outside the sample folder; YAML files are copied byte for byte except `project.yaml` (name and body set, comments kept), the standard project folders are created, and nothing is ever overwritten (`wx`). The copy is opened and remembered. _Alternative:_ a separate dialog on the start screen. _Change:_ `saveSampleAs` in the store, `copySample`, `ProjectPage.tsx`, `NewProjectForm` props.
- **Sample content:** female body, one layout per region with 2–4 elements each (figures, a filler, a band or a line), all within the existing pattern names; no real tattoo art, no third-party images. _Change:_ `samples/demo/`.
- **Sample path** comes from the app folder (`<root>/samples/demo`, `root` being the checkout or `app.asar`), never the working directory; electron-builder packs `samples/**/*.yaml`. The copy reads with `readFile`/`readdir`/`stat` only, which Electron supports inside `app.asar`. _Change:_ `createContext`, `desktop/electron-builder.config.mjs`.
- **Privacy link:** Settings → Image generation links `docs/privacy.md` on GitHub (`PRIVACY_URL`, the current repository; it moves with the public repository in Phase D). _Alternative:_ render the page inside the app (needs a Markdown renderer). _Change:_ `src/settings/ImageGenerationSettings.tsx`.
- **README for outside users first:** what it does, quick start (DMG, git), sample project, project folder, bring-your-own-key, privacy, then the feature reference; `TATTOO_DATA_DIR`, `.env`, `npm run migrate`, Jan's sleeve, building the app and the server API moved under "For git users and development". No screenshots yet (they would be binary files; see open points). _Change:_ `README.md`, `docs/privacy.md`.
- **Developer wording in the UI:** photo and load errors no longer mention `TATTOO_DATA_DIR`, the Data folder tab or `npm run …`; they point to Settings → Project and the Assets tab's **Look for new images**, and a server that does not answer is "restart the planner". The `.env` steps in Settings → Image generation are shown only outside the desktop app and are labelled as being for a planner run from a git checkout. A new `manifest.yaml` names the button first and the npm script for git users. _Change:_ `photoStatus.ts`, `useLayouts.ts`, `useProjections.ts`, `useAssets.ts`, `runExport.ts`, `useLayoutSources.ts`, `NEW_MANIFEST_TEXT`.
- **Open:** screenshots for the README (they must not be committed as images per CLAUDE.md; a link to images hosted with the release, or Jan's OK for an allow-listed `docs/screenshots/` folder, is Jan's call).

### Small fixes (2026-11-06 test notes)

Jan's test notes of 2026-11-06. Format: decision; _Alternative_; _Change_.

- **Skewed torso lines were the cm grid, not the geometry.** The torso mesh and unwrap were already right: every ring places u by arc length (a fraction of u is the same fraction of the 3D perimeter at every aspect ratio), the front and back lines sit on the symmetry plane at every height, and images are drawn row by row centred on their own u, so motifs never skewed. But the grid's lengthwise lines were all measured in cm from the texture centre (the right flank on the torso). A line a quarter ring away (front, back) then moved by a quarter of every change in circumference (male sample: waist 86 → chest 100 → shoulder line 88 → neck 42 cm), the S-shape on the back and the strong curve towards the neck. Now each line is measured from the nearer of the region's two main centre lines (`MAIN_LINES`: outer/inner on limbs, front/back on the torso, the lines the 2D editor can centre on), so it keeps its cm distance from that line all the way along; the two families meet on the other two centre lines (lateral/medial, the flanks), which are drawn as axes. Legs had the same drift (lateral thigh) and the arms a smaller one on their inner half; both follow the same rule. The left arm's mesh, UVs and the lines on its outer half are unchanged; only the lines on its inner half are now measured from the inner line. The grid is also the same on the skin whichever line the 2D editor is centred on. _Alternative:_ re-centre the torso texture on the front (moves the problem to the back); lines of constant u (straight, but no longer 1 cm apart); four anchor lines (seams on the 45° diagonals, in the middle of the outer forearm). _Change:_ `gridLines` in `src/render/cmGrid.ts`, `MAIN_LINES` and `editorCentres` in `src/body/regions.ts`, `tests/cmGrid.test.ts`.
- **Change image without the ‹ › arrows** (Jan: confusing, you do not see what comes next). The element panel keeps one **Change image** button; the picker it opens is larger instead: up to 760 × 680 px, shrunk to the window with an 8 px margin, placed left of the button when it fits, else right of it, else as far right as fits; thumbnails at least 140 px (104 px below 640 px window width). `stepAsset` and its tests are gone. _Alternative:_ a centred modal dialog (loses the link to the button that opened it). _Change:_ `ImageSwap` in `src/editor/ElementPanel.tsx`, `LayoutPage.tsx`, `src/assets/pickerPlacement.ts`, `ImagePicker.tsx`, `.picker-grid` in `src/styles.css`.
- **README cut to a start page** (Jan: far too long, `npm run desktop` only after a long scroll): two-line description, **Start** (desktop app from a checkout, `npm run dev`, DMG, sample project), a short feature list, privacy in one paragraph, links to the docs and the two commands every contributor needs. The reference material moved, unchanged in substance, into `docs/usage.md` (sample project, project folder, image generation, every tab, patterns, export, layout fields, configuration files), `docs/development.md` (setup for git users, `TATTOO_DATA_DIR`, migrate, desktop builds and signing, cataloguing, server API, commands, code layout, UI conventions, status) and `docs/jans-sleeve.md` (Jan's asset ids, the Anubis projection, his data-folder move). Links into the old README sections were updated (`v1-baseline.yaml` comment, `scripts/assets.ts` message, ADR 0015); the app itself links no README anchor. _Alternative:_ one long `docs/reference.md` (harder to find the developer part). _Change:_ `README.md`, the three docs files.

### Local models (2026-11-06 test notes)

Research and benchmark preparation only (`docs/research/local-image-models.md`, `benchmark/local-image-models/`); no app code. Format: decision; _Alternative_; _Change_.

- **Top 3 to benchmark: FLUX.2 [klein] 4B, FLUX.2 [klein] 9B, FLUX 3 Image Klein**, all in mflux. 4B is the only current edit model with an Apache 2.0 licence that clearly fits 16 GB; 9B is the quality step within 16 GB (non-commercial); FLUX 3 Klein is a stretch test of the newest model (18.5 GB peak at `-q 4` on an M4 Pro). Z-Image-Turbo and Qwen-Image-2.1-Turbo are optional candidates. _Alternative:_ Qwen-Image-Edit-2511 (Apache 2.0, best open editor of 2025) does not fit 16 GB; FIBO 2 and Qwen-Image-2.1 have non-commercial licences. _Change:_ the `CANDIDATES` table in `run_benchmark.py`.
- **One runtime, mflux 0.24.0 via `uv tool install`**: covers every candidate, MLX is the fastest path on Apple GPUs and the CLI is scriptable. _Alternative:_ ComfyUI on MPS (slower, fragile, heavy install), Draw Things (GUI-first; good for trying by hand), stable-diffusion.cpp (single binary, attractive for a product, slower on Apple GPUs).
- **The benchmark script is Python with inline `uv` metadata** (Pillow pinned) so it needs no project setup and nothing in `node_modules`; Python is not covered by `npm run check` (eslint/prettier ignore `.py`), so it was checked with `py_compile` and `ruff check`. _Alternative:_ a shell script (no image maths for the seam check).
- **Tileable backgrounds by "shift by half, then repair the seam cross"** plus a numeric seam score and a 2×2 preview, because transformer models have no circular-padding switch. _Alternative:_ circular padding (SDXL UNets only) or a toroidal-RoPE pipeline (not in mflux).
- **Timings include model load and quantisation** (one CLI process per job, as a planner engine would run it); a 256 px warm-up keeps downloads out. Peak memory is macOS `time -l` "peak memory footprint", plus swap growth from `vm.swapusage`. _Alternative:_ a long-running Python process with the model kept loaded (faster per image, but needs the memory permanently).
- **Results go to `~/tattoo-benchmark-results`**; the script refuses an output folder inside the repo, and `__pycache__/` is git-ignored.
- **Unverified:** no number has been measured on an M4 with 16 GB; the FLUX 3 Klein Hugging Face repository name in the README and the licences marked [S] need checking on the model cards (huggingface.co was not reachable from the cloud session).

### Key (2026-11-06 test notes)

Jan's note: set and check the GPT key in Settings; report a broken key at startup with what it means. ADR 0016. Format: decision; _Alternative_; _Change_.

- **A key entered in Settings when run from git is saved by the server in `~/.config/tattoo-planner/openai-key`** (plain text, 0600, atomic), never in `.env`. _Alternative:_ rewrite `.env` (risks Jan's hand-edited file and its key). _Change:_ `OpenAIKeys` in `server/settings.ts`.
- **Precedence: Keychain (desktop) > saved in Settings > `.env`/shell.** Removing the saved key falls back to `.env`, which is shown as "not used while this one is set". _Alternative:_ `.env` wins (then a key typed in the UI would silently do nothing for Jan). _Change:_ `OpenAIKeys.current()`.
- **The check is `GET /v1/models/<image model>`**: authenticated, free, no data; 403/404 count as "no access to the image model". Missing credit is only caught when OpenAI answers 429 there. _Alternative:_ a tiny paid image request. _Change:_ `src/edits/keyCheck.ts`.
- **Save refuses only a key OpenAI rejects (401)**; offline, no model access or no credit still save, with the result shown ("Saved. …"). Offline must not block entering a key. _Alternative:_ save only valid keys. _Change:_ `PUT /api/openai-key`, desktop save path in `ImageGenerationSettings.tsx`.
- **In the desktop app the page checks a new key through the local server first** (`POST /api/openai-key/test { key }`), then stores it through the bridge as before; the server's key file is off there. _Alternative:_ a new IPC call that checks in the main process (duplicate of the server logic). _Change:_ `ImageGenerationSettings.tsx`, `createContext`.
- **Startup check: once per server run, cached per key**, asked by the page on mount; the switch is `openaiStartupCheck` in `config.json` (default on). _Change:_ `server/openaiKeyApi.ts`.
- **The notice floats under the top bar** (fixed, dismissible, `sessionStorage` per check) instead of a strip in the flow, because the workspaces are sized to `100dvh − header`. `valid` and `rate-limited` show nothing; `network`/`error` read "could not check … does not mean the key is broken". Later checks from Settings only clear it, so Test key on the Settings page does not re-raise it. _Change:_ `src/settings/KeyCheckNotice.tsx`, `.key-notice` in `styles.css`.
- **Shell vs `.env` source** is told apart by comparing with `process.env` (both are merged before the server sees them). _Change:_ `OpenAIKeys.envKey()`.

### Theme (2026-11-06 test notes)

Jan: a dark and a bright mode, following the OS or set directly, like Job Radar; the dark design stays as it is. ADR 0021. Format: decision; _Alternative_; _Change_.

- **Dark is untouched, light is an override.** `:root` keeps the dark values; `:root.light` overrides colour tokens only. The ~50 hard-coded chrome colours further down `styles.css` became tokens carrying their old dark value (e.g. `--press`, `--popover-bg`, `--seg-bg`, `--stage-1..3`, `--thumb-checker-a/b`). Before/after screenshots of all tabs in dark mode match except for a few anti-aliased border pixels and the new Settings entry. _Alternative:_ `html:not(.dark)` (light without JavaScript). _Change:_ `src/styles.css`.
- **Light palette:** cool light greys (`--bg` #f3f3f6) with white panels and top bar, hairlines as 10–26 % of a blue-black, the same blue-violet accent darkened to #5a4de0 (white text on it 5.9:1, accent text #4b3fd0), and status colours darkened so they pass AA as text on their own tints (`--warn` deep ochre #925500, `--danger` #b8222a, `--ok` #166c3e). Text tokens pass AA on `--bg`, `--surface` and `--surface-2`. The 3D stage is a mid-light grey spotlight (#efeff3 → #cbcbd4) so the light skin keeps a visible silhouette. _Alternative:_ a white stage (the arm blends into it). _Change:_ `:root.light` in `src/styles.css`.
- **Same in both themes:** content colours, the drawn 2D sheets (blockout, reference, grid), the 3D skin and lights, the colour-coded projection markers, the brand tile, blockout legend swatches and the handout/PDF. The measuring diagram's body outline gets its own token (`--diagram-ink`), because skin colour on a light panel is invisible.
- **Image studio backdrop** follows the theme until the user picks Dark or Light in the canvas bar; a picked backdrop is kept as before (`tattoo-planner:studio-backdrop`). _Alternative:_ always dark (light theme would open on a dark checkerboard). _Change:_ `useBackdrop` in `src/edits/ImageEditPage.tsx`.
- **First paint:** an external classic script `public/theme-init.js` instead of an inline script, since the desktop CSP allows `'self'` scripts only; a test checks that it agrees with `src/ui/theme.ts`.
- **Desktop:** the choice is also kept in `userData/theme.json`, because localStorage does not survive a restart there (new port, new origin); the window background and `nativeTheme.themeSource` are set from it before the window opens. The dark window background changed from #16161a to the page's `--bg` #0a0a0d so nothing flashes. _Change:_ `desktop/themeFile.ts`, `desktop/main.ts`, `desktop/preload.cts`.
- **The control lives in Settings → Appearance only**, not in the top bar, which the Layout tab already fills. _Alternative:_ a compact icon-only group in the header (easy to add: `ThemeControl` is self-contained).
- **The viewer's "Save view as PNG"** flattens onto a theme background (`VIEWER_BACKGROUND.dark` unchanged, `.light` #dedee5).

### People and Home (2026-11-06 test notes)

ADR 0017 (persons) and ADR 0018 (Home, active variant). Format: decision; _Alternative_; _Change_.

- **The top level of `project.yaml` is the first ("root") person's**, id `me`: `body`, `height_cm`, `active` and the top-level folders keep their meaning, so Jan's project opens unchanged and an older planner still reads it. Further persons are `persons:` entries with data in `persons/<id>/`; an optional `{ id: me, name: Jan }` entry names the root person (default "Me"). _Alternative:_ every person under `persons/` (needs a migration of Jan's folder). _Change:_ `resolvePersons` in `src/project/persons.ts`, `personHolder` in `src/project/yamlDoc.ts`.
- **The current person is kept per project in the user config** (`currentPerson` in `config.json`), not in `project.yaml`, so two people sharing a synced folder do not flip each other's view; the sample keeps it in memory. The server resolves every per-person path from it, so the layout, projection and measurement endpoints are unchanged. _Alternative:_ a `person` parameter on every request; the choice in `project.yaml`. _Change:_ `rememberedPerson`, `ProjectStore.paths()`.
- **Switching, adding or removing a person reloads the page** (as switching project does), after the page named unsaved edits; the reload then skips the browser's own leave-page prompt (`reloadDiscardingChanges`), which in the desktop app would silently block it. _Alternative:_ rebuild the body and every tab's data in place (large, error-prone change to load-time modules). _Change:_ `src/project/PersonSwitcher.tsx`, `App.tsx` unload guard.
- **Removing a person moves their folder to the system trash** (macOS `~/.Trash`, freedesktop `~/.local/share/Trash` with `.trashinfo`), falling back to `<project>/.trash/`; the answer names the place and the UI shows it. The root person cannot be removed, only renamed. A new person never reuses a folder already on disk (`xenia-2`). _Alternative:_ Electron's `shell.trashItem` (desktop only; the server is shared with the browser). _Change:_ `server/project/trash.ts`.
- **Photos belong to a person by path**: `persons/<id>/photos|existing/` to that person, top-level `photos/`, `existing/`, `arm-photos/` to the root person, everything else is the shared library. The scan catalogues the person folders; the projection wizard lists only the current person's photos. The Assets tab still lists everything (the assets task restructures it). _Change:_ `assetOwner`, `visibleToPerson`, `scanCandidates`.
- **Active variant default is the region's first variant by name**, and a marked name that no longer exists falls back to it, so Home never shows a hole after a rename. Stored per person in `project.yaml` (`active:`), set with the star in the Layout tab. _Change:_ `activeVariant`.
- **Home look:** a full-bleed stage with a token-based radial backdrop, a soft breathing spotlight and a floor glow, warm key / cool rim lights and a contact shadow; a slow turntable (75 s per turn, off with `prefers-reduced-motion`) that stops on drag or zoom; the hero (avatar, name, body, "n of 5 regions planned") top left; region cards with an unwrap thumbnail, coverage bar and counts. Avatars use a hue from the person id; saturation and lightness are tokens (`--avatar-s`, `--avatar-l`) for the light theme. _Change:_ `src/home/`, the "Home and persons" section of `src/styles.css`.
- **Card stats** use the coverage classifier at 2 px/cm without image aspects (whole percents, fast enough for five regions on every load). _Change:_ `regionStats` in `src/home/model.ts`.
- **The sample opens also with `TATTOO_DATA_DIR` set** (Jan could not find it): it is never remembered, and **Close / Leave the sample** returns to the project that was open before (the fixed folder, the remembered one, or the start screen); "Save as new project" stays refused when the folder is fixed. This replaces the C8 rule that the sample is not offered there. The start screen leads with **Explore the sample**; Home offers it at the bottom of the side column. _Change:_ `readOnly`, `close`, `openSample` in `server/project/store.ts`.
- **The sample has two people**: Alex (root, female, the existing layouts) and Sam (male, 182 cm, `persons/sam/layouts/`: a left-arm sleeve in two variants, a torso, a right leg), to show the switcher and the active variant. _Change:_ `samples/demo/`.
- **Top bar:** a person chip left of the project chip; in tabs that fill the top bar (Layout, Projection) under 1600 px it shrinks to its avatar and the brand text hides, so the tabs stay visible. The sample's project chip reads "Sample (read-only)". _Change:_ `PersonMenu`, styles.
- **Open:** whether exports should name the person (the handout title still uses the project); per-person filtering in the Assets tab (left to the assets task).
