# ADR 0003: Ideas PDF ingestion and asset scan

- Status: superseded in part (2026-11-05): the ideas.pdf ingestion (`npm run ingest`, mupdf, `ideasLayout.ts`) was removed, because it was specific to one PDF and mupdf's AGPL licence does not fit the open-source product (`docs/product/roadmap.md` §3). The asset scan (`npm run assets:scan`, the Reload button) and the manifest merge stay as described; entries already extracted into `ideas/` stay valid. Originally proposed 2026-11-03.
- Context: PROJECT_BRIEF.md §10.1 F11, §11.1, §12.3–§12.5, §14 Phase 4

## Decision

**Tool.** `npm run ingest` and `npm run assets:scan` are one Node script (`scripts/assets.ts`, run by Node's built-in type stripping) that reads the PDF with **MuPDF's official JavaScript binding, `mupdf` (mupdf.js)**, pinned at 1.28.1 as a dev dependency. It is WebAssembly: no install script, no native build, no Python, so it runs with Jan's Node on macOS after `npm ci`. Its structured-text API gives, per page, every text line with its box and font size and every image with its box, so images can be traced back to the page and matched to nearby text.

**Images.** Each image is written as `ideas/page-NN-img-MM.<ext>`, numbered in reading order (rows top to bottom, left to right within a row). A JPEG stream in RGB or grey is copied byte for byte (`.jpg`); every other image (Flate/raw, CMYK, indexed, masked) is decoded and written as sRGB PNG. ICC profiles are converted to sRGB, not embedded. Files are rewritten only when their bytes change. The plain text of each page with text goes to `ideas/page-NN.txt`.

**Text next to images** (pure logic in `src/assets/ideasLayout.ts`, unit tested without a PDF):

- _Heading_: a line at least 1.3× the body font size. It applies to the images that start below its top edge and carries over to later pages until the next heading.
- _Label_: a short line (≤ 3 words, no sentence punctuation) directly above an image, e.g. "Charon". It applies to the images below it on the same page.
- _Caption_: the remaining text, grouped into paragraphs. Each paragraph goes to the single closest image within 36 pt; text directly above an image counts as 25 % closer, because the Google Docs export puts captions above the images.

**Manifest entries.** Id `ideas-pNN-MM`, kind `idea`, captions in `notes`, `page` (1-based) and `bbox` in PDF points as `[x0, y0, x1, y1]` with the origin at the **top-left** of the page and y downwards (MuPDF's page space, the way the page is seen; not the bottom-left PDF user space). `source` names the PDF, page, heading and label (`ideas.pdf p.5, under "Additional Elements" > "Charon"`); a heading from an earlier page is stated as such (`after heading "Skull" on p.6`), because a Google Docs export has no section ends. Headings and labels on the image's own page also become tags (slugged).

**Scan.** Images in `cards/`, `refs/`, `existing/` and `arm-photos/` (recursively) that no entry references get an entry with id = slug of the path without extension (`arm-photos/front.JPG` → `arm-photos-front`), kind `card-art`, `reference`, `existing` or `arm-photo`. A sidecar `<name>.txt` next to an image becomes its `source`. Formats a browser cannot show (HEIC, TIFF, …) are reported, not catalogued.

**Merging into `manifest.yaml`** (`src/assets/manifestDoc.ts`, `yaml` Document API as in `src/layout/yamlDoc.ts`): existing entries are matched by `file` (case-insensitive, as on macOS), ingestion also by `id`. A matched entry keeps everything Jan wrote; ingestion refreshes only `page` and `bbox`. New entries are appended with a stable key order; a clashing id gets a `-2` suffix. A manifest that does not parse or validate is never overwritten: the script stops with the error. An unchanged manifest is not rewritten.

## Alternatives

- **`pdfjs-dist`** (Apache-2.0): image positions need the operator list and manual matrix tracking, images come out decoded to RGBA (JPEGs lose their original bytes) and writing PNG would need another dependency. More code for a worse result.
- **Python (PyMuPDF, `pdfimages`)**: same engine or similar quality, but an extra runtime and install step on Jan's Mac.
- **Ids from image content hashes**: stable when pages move, but unreadable and hard to trace back to the page. Page/position ids are what the brief proposes.

## Consequences and known limits

- **Licence**: mupdf.js is AGPL-3.0. That is fine for a private, local tool that is neither distributed nor offered as a network service; it is a dev dependency and is never bundled into the web app. Revisit if the tool is ever published.
- The package is ~14 MB (WebAssembly). It is loaded only by `ingest`.
- Ids depend on page and position. If Jan inserts a page or reorders images in the Google Doc, ids shift: an existing entry then points at a file with different content, and its notes may no longer fit. Re-ingesting after editing the PDF needs a look at the manifest.
- An entry Jan deletes comes back on the next `ingest`/`assets:scan` while its file exists; to hide an image, keep the entry and tag it instead.
- The caption heuristics fit Jan's Google Docs export; a different layout may need other thresholds (`LayoutOptions`).
- When the YAML is rewritten, the `yaml` library normalises some spacing on lines it re-emits (e.g. two spaces before a trailing comment become one); content, comments and key order stay.
