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
