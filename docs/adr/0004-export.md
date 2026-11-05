# ADR 0004: Export for the artist

- Status: proposed (2026-11-03)
- Context: PROJECT_BRIEF.md §1.2, §10.1 F10, §11.1 ("PDF export: browser-side or a headless browser — decide in Phase 5"), §12, §14 Phase 5

## Decision

**Everything is generated in the browser; only the dev server writes files.** One click on **Export** in the Layout toolbar:

1. asks the dev server for a free name (`POST /api/exports`, body `{ layout, date }`): `<layout>-<YYYY-MM-DD>`, or `-2`, `-3`, … when that day's PDF or PNG folder exists. Reserving creates `exports/<base>/` (an atomic `mkdir`), so two exports never get the same name;
2. paints the unwrap of the current layout in blockout and in reference mode with the existing renderer (`src/render/unwrapCanvas.ts`): at 30 px/cm without grid as texture for the views, at 40 px/cm with the cm grid for the unwrap pages;
3. renders the four fixed views (front = inner, back = outer, medial, lateral) of both textures offscreen with plain three.js (`src/export/renderViews.ts`): the same mesh, materials, lights and tone mapping as the live viewer (`src/viewer/scene.ts`), on white, 1000 × 2400 px, then crops all eight renders to the same box around the arm so every view has the same scale;
4. sends the ten PNGs (`exports/<base>/{front,back,medial,lateral,unwrap}-{blockout,reference}.png`) and finally the PDF (`exports/<base>.pdf`) with `PUT /api/exports/<path>`.

**PDF library: jsPDF 4.2.1** (MIT, pinned exactly, released 2026-03-17), loaded with a dynamic `import()` only when exporting. It needs no install script. Images go into the PDF as JPEG (quality 0.9; each embedded once even when used on two pages), so the handout stays around 2 MB; the PNG files stay lossless. Text uses the built-in Helvetica (WinAnsi): Latin-1 including German umlauts and the usual typographic marks; other characters are replaced (`toPdfText`).

**Endpoint rules** (`src/export/server/exportsApi.ts`, shared names in `src/export/names.ts`): only `<base>.pdf` or `<base>/<name>.png` with `base = <layout>-<YYYY-MM-DD>[-N]` (lowercase slug, real date) and a folder created by a reservation; Content-Type must match the extension, and the bytes must start with the PDF or PNG signature; at most 100 MB per PDF and 50 MB per PNG; files are written with `O_EXCL` (never overwritten); `exports/` and the export folder must be real folders inside the real data folder (no symlinks out); requests with `Sec-Fetch-Site: cross-site|same-site` are refused (the non-simple Content-Types also need a CORS preflight that Vite never grants). Without `TATTOO_DATA_DIR`, `GET /api/exports` says why and the button is disabled with that reason.

**Page plan** (A4, 16 mm margins, footer "Sketch, not a final design · layout · date" and page numbers on every page):

- p. 1, cover: title, Jan's left arm, layout name and description, date, the note "This is a sketch, not a design" (§1.2: creative freedom welcome), contents, front and back in reference mode, legend.
- p. 2, all four views at a glance (landscape): blockout and reference side by side per view.
- p. 3–6, one page per view: blockout and reference large, the elements facing that side (with type and size), legend.
- p. 7–8, the unwrap with cm grid in blockout and in reference mode, with the centre lines named along the top and the print scale.
- p. 9 on, tables (flowing over pages as needed): element notes (id, type, reference image, size in cm, position in words and u/v, style or pattern, notes from the YAML), coverage per zone, open questions (unset heights, guessed widths, missing images, placeholder measurements, then the design questions of PROJECT_BRIEF.md §9).

**Structure.** Pure TypeScript with unit tests: the handout content (`handout.ts`), page geometry, wrapping, table pagination and image cropping (`pdfLayout.ts`), names and the endpoint (`names.ts`, `server/`). Browser-only and thin: `renderViews.ts` (WebGL), `pdf.ts` (jsPDF drawing), `runExport.ts` (orchestration), `ExportButton.tsx`. Every handout text is in `strings.ts` (`HANDOUT_EN`), so a German version is one more object of the same type.

## Alternatives

- **Node script with a headless browser** (Playwright/Puppeteer printing an HTML page): would need a ~150 MB browser download on Jan's Mac and the images re-rendered outside the running app; the browser already has the rendered scene and the decoded images.
- **pdf-lib** instead of jsPDF: lower-level (no text measuring helpers, no image scaling help) and its last release is from 2021.
- **Browser download instead of the endpoint**: lands in the download folder rather than on Seafile and cannot pick `-2` names; kept out (see below).
- **HTML/CSS print layout** (`window.print()`): no control over file name and location, results vary by browser.

## Consequences and limits

- Export works only under `npm run dev` with a data folder; with `TATTOO_DATA_DIR` unset the button explains why and offers no download, so an export never lands outside Seafile.
- The export uses the layout as saved: the button is disabled while there are unsaved changes, layout errors, or reference images still loading.
- One export takes about 15–20 s in a software-rendered (SwiftShader) browser; on a Mac GPU it should be faster.
- Exports are deterministic in content (same YAML, measurements and images give the same pictures and tables); the PDF's creation date differs.
- The §9 questions are copied into `strings.ts`; when Jan answers one, remove it there (or move them into the layout YAML later).

## Update 2026-11-05: export canvases in main memory

Jan's first export on his Mac froze the whole machine for 30–60 s and then failed with Safari's "The object is in an invalid state". The reference renderer copies images one pixel row at a time, partly with "multiply" blending: at export resolution (40 px/cm, about 1600 × 2960 px) that is thousands of tiny draws per canvas, plus read-backs for PNG and JPEG encoding. Browsers put a 2D canvas on the GPU by default, and the window server shares that GPU, so the queued work stalled everything; after such a stall Safari resets its GPU process and the next canvas copy throws.

Decision: every canvas of the export and of the reference renderer is created with `willReadFrequently` (`src/render/cpuCanvas.ts`), which keeps it in main memory, where row copies, blending and read-backs are cheap and cannot stall the display. Only the four 3D views still use WebGL (one short-lived context, now checked for context loss). The export frees its canvases when it ends, also after a failure, and an error names the step that failed.
