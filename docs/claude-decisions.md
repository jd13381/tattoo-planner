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
