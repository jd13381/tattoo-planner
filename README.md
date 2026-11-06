# Tattoo Planner

Plan a tattoo on a 3D body before you see the artist. Place reference images, patterns, bands and lines on a 2D unwrap of an arm, a leg or the torso and see them live on a 3D sample body; compare variants, check how much skin each zone keeps open, and export a PDF handout for your tattoo artist. The output is a **sketch, not a finished design**: the artist designs the tattoo.

Everything runs on your computer. Your project is one folder you choose; nothing is uploaded unless you start a generative image edit with your own OpenAI key (see [Privacy](#privacy)).

## What it does

- **Body regions:** left and right arm, left and right leg, torso, on a female or male sample body. Your own measurements (optional, with a guided measuring wizard) adjust it.
- **Layout editor:** a 2D unwrap of the region with figures (reference images), existing tattoos, pattern fillers, bands and freehand lines; drag, resize, rotate, layer, undo. The 3D view follows every change, also with the elbow bent and as a full body.
- **Blockout and reference modes:** grey shapes for proportions, or the real images on the skin.
- **Compare:** two variants side by side with the coverage differences per zone.
- **Existing tattoos:** bring a tattoo you already have onto the body from a few photos (guided setup).
- **Image studio:** clean up a reference image with built-in operations (background removal, line art, levels, rotate …) or, optionally, redraw it with OpenAI's GPT Image using your own key.
- **Handout:** a PDF with every view, the unwrap, an element table and the open points, plus PNGs, saved into your project folder.

## Quick start

### Desktop app (macOS)

1. Download the DMG for your Mac (Apple Silicon: `arm64`, Intel: `x64`) from the repository's GitHub Releases page.
2. Open it and drag **Tattoo Planner** into Applications.
3. **First start:** the app is not signed with an Apple Developer ID yet, so macOS says it cannot be opened. Right-click (or Control-click) Tattoo Planner in Applications → **Open** → **Open**, or try once, then go to System Settings → Privacy & Security and click **Open Anyway**. macOS remembers the choice. A new version may ask once for Keychain access to "Tattoo Planner Safe Storage"; allow it so a stored OpenAI key can be read.
4. On the start screen, click **Open sample project** to look around, or create your own project.

### From git

Requires Node ≥ 22.18 and npm.

```sh
git clone <this repository>
cd tattoo-planner
npm ci            # install (install scripts are disabled by .npmrc)
npm run dev       # http://127.0.0.1:4320
```

Open the URL in a current Chrome, Edge or Firefox. `npm run desktop` starts the same planner in its own window; more for git users [below](#for-git-users-and-development).

## Sample project

**Open sample project** on the start screen opens a ready-made project: a female sample body with a layout on each region (compass, moon and stars and a meander band on the left arm; sun, swallow and a lotus band on the right arm; mountains on the left calf; a fern and scales on the right leg; a mandala and waves on the torso). Its images are simple placeholder motifs that the planner draws itself; none of them is real tattoo art.

The sample is **read-only**: you can move things, switch modes and look at every region and the full body, but saving, exporting and image edits are off, and the header shows **Sample project (read-only)**. **Save as new project** (Settings → Project; the chip in the header leads there) copies it into a folder you choose, with the placeholder images as PNG files, and opens the copy, which you can change freely.

## Your project folder

A project is one folder (local disk, iCloud Drive, a synced folder …) that holds everything: layouts, measurements, images and exports. Create one on the start screen (name, sample body, folder) or open an existing one; the planner remembers the last project and a list of recent ones.

```
<project>/
├── project.yaml       name, body (female | male), optional height_cm, schema version
├── measurements.yaml  optional; your measurements (see Configuration)
├── layouts/           layout variants, one YAML each
├── projections/       calibrations of photos of existing tattoos
├── manifest.yaml      image catalogue, kept by the planner
├── images/            reference images
├── photos/            body photos for projections
├── edits/, generated/ Image studio results
└── exports/           PDF / PNG handouts
```

Every file is YAML or an image; the YAML files stay hand-editable and keep their comments when the planner saves them. Copy reference images into `images/` and photos of your body into `photos/`, then press **Look for new images** in the Assets tab to catalogue them.

## Image generation (bring your own key)

The Image studio's generative engine uses OpenAI's GPT Image with **your own API key**. It is optional: everything else works without it. Create a key at [platform.openai.com](https://platform.openai.com/api-keys) and add some credit under Billing. In the desktop app, enter it in **Settings → Image generation**: it is stored encrypted with the macOS Keychain and only ever sent to OpenAI. A planner run from git reads it from `.env` as `TATTOO_OPENAI_API_KEY` (see [Settings for git users](#settings-for-git-users)). Each variant shows a rough cost (a few cents).

## Privacy

- The planner runs locally. Its server listens on `127.0.0.1` only and serves the page to this computer alone.
- Your project stays in the folder you chose. There is no account, no cloud storage, no telemetry, no analytics and no update check.
- Only a generative edit that **you start** in the Image studio sends data out: the image (and any reference images you add) and your instruction go to OpenAI, with your key. Built-in operations run on your computer.

Details: [docs/privacy.md](docs/privacy.md).

## Using the planner

**Navigation:** the top bar has **Layout**, **Image studio**, **Compare**, **Assets** and **Settings** (arrow keys move between them; the open tab is in the URL, e.g. `#settings/projection`; the old `#arm`, `#projection` and `#data` links open their Settings section). Settings has a side navigation with **Project** (the data folder setup), **Body & measurements**, **Projection** and **Image generation**.

- **Layout** (start page): pick a variant from the project's `layouts/`, edit it on the 2D unwrap and see it live on the 3D arm (Reference mode by default; in blockout mode (figures dark grey, fillers light grey, bands striped, red lines red, existing tattoo outlined). Click to select, drag to move, round handle to rotate. A selected figure has eight resize handles (they light up on hover; the cursor follows the box rotation): corners resize in proportion around the opposite corner, edges stretch one side; **Shift** swaps the two, **Alt** resizes around the centre, and sizes snap to 0.5 cm (hold **Ctrl/⌘** for free sizes, at least 1 cm). While dragging, a label shows the new size ("9.9 × 18.0 cm", width × height) and a dashed outline the old one; each drag is one undo step. A figure without a width keeps it unset (it follows the height) as long as it is resized in proportion. Alt-click selects the element underneath (repeat to cycle through everything stacked at that point), and hovering outlines the shape a click would select. The 3D arm only shows the result: dragging it always rotates (right-drag pans, scroll zooms) and never selects anything; select in the 2D editor or the elements list. The side panel edits every field, grouped as Position (with the position in cm), Size, Style and Reference image, plus the layer order (**Bring forward** / **Send back**), lock, duplicate and delete. **Outer / Inner** (mode bar over the 2D editor) puts the outer or the palm-side line in the middle of the editor for pieces on the seam (Anubis, Pegasus). The variant picker, **Undo**/**Redo**, **Save as…**, **Save** and **Export** sit in the top bar on the right while the Layout tab is open. **Save** writes the YAML back, keeping comments; **Save as…** duplicates what you see into a new variant (a free name like `v1-baseline-2` is suggested; the new file keeps the comments of the one it came from, under a line saying so; the open variant stays as saved). **Save as…** opens a small form under the button: the suggested name is preselected, the hint checks it live (lowercase letters, digits and dashes, at most 64 characters, warns before overwriting an existing variant), Enter saves and Esc cancels. Every save confirms itself with a short "Saved …" message at the bottom. Switching to another variant with unsaved edits asks Save / Discard / Cancel. Unsaved edits survive a visit to another tab; the variant picker and the Layout tab show a dot and the browser asks before a reload or close discards them (the Projection tab too). Warnings show as an "N notices" chip in the top bar; click it for the list. A duplicate or invalid id shows under the id field; other errors float over the top of the workspace. The coverage table shows the share of figures, fillers, bands, lines and open skin per zone. New figures and existing tattoos start at 10 × 6 cm (unlocked), each new element a little beside the previous one. Figures without a height are drawn 10 cm tall and listed in a warning; the Anubis takes its size from `measurements.yaml` when the layout leaves it empty.
- **Body regions** (Layout tab, region picker left of the variant picker): every layout belongs to one region: left arm (the default, and every layout without a `region:` key), right arm, left leg, right leg or torso (`docs/adr/0011-bodies-and-regions.md`). The variant picker lists the chosen region's layouts; a region without one opens an empty layout (`torso-1`, …) that becomes a file on the first **Save** (with `region: torso` after its name). The editor's centre buttons, edge labels and cm readouts use the region's lines (legs: front/lateral/back/medial from the shin; torso: right flank/front/left flank/back, centred on Front or Back), the coverage table its zones (leg: shin, calf, knee, thigh front and back; torso: chest, stomach, upper and lower back, flanks), and the export its wording. Regions nobody measured use the sample body (`male` unless `measurements.yaml` says `body: female`), scaled by `height_cm` when given; an unmeasured right arm or leg copies the measured other side. The elbow pose is for arms only. Existing tattoos can be projected from photos onto every region.
- **Full body** (Layout tab, switch over the 3D view): the whole sample body in a relaxed A-pose with every region textured by its last opened (else first) layout in the current mode, regions without one in plain skin, and head, neck, hands, feet, hips and shoulders as neutral shapes. **Front / Back / Left / Right** set the camera; click a region to edit it.
- **Elements list** (Layout tab, top of the right column): every element of the variant, top layer first, with its category colour, a warning dot (hover for the reason: height not set, no or unknown reference image, projection problem) and a lock toggle. Click a row to select the element; drag a row to change the layer order.
- **Undo and shortcuts** (Layout tab): **Undo**/**Redo** (arrow buttons next to Save as…, or Cmd+Z / Shift+Cmd+Z, Ctrl on Windows and Linux) step back through every edit: a whole drag, a typing burst in one field and a run of arrow-key nudges count as one step each. Loading or saving a variant starts the history afresh. Further keys: Cmd+S saves (also while typing), Cmd+D duplicates, Delete or Backspace deletes the selected element (not when locked), Esc deselects or leaves Draw mode, the arrow keys nudge the selected element by 0.5 cm (Shift: 2 cm) on the skin, `]` and `[` move it one layer up or down, **V** picks the select tool and **R** toggles the Line tool, and `?` (or the **?** button at the bottom of the tool rail) lists them all. They only act while the Layout tab is open and focus is not in a text field.
- **Layout workspace:** the tool rail on the left holds Select (V), the add buttons (figure, existing, filler, band: each adds one in the middle of the editor) and the Line tool (R); hover a tool for its name. The bar over the 2D editor switches the mode, the grid and the centred side; the status bar under it shows u/v and the position in cm under the cursor (else of the selection), the zoom and **Fit**. Over the 3D view float the view bar (Front/Back/Medial/Lateral, Screenshot), the elbow pose and the coverage table; the right column has **Elements** and **Assets** as tabs and the inspector of the selected element (or of the variant).
- **Line tool** (Layout tab, tool rail, R): while it is on, a colour picker (any colour, plus red, black, grey and blue swatches) floats over the 3D arm, and dragging on the arm draws a stroke on the skin (rotation is off; right-drag pans, scroll zooms; works on the bent arm too). Each stroke becomes a new `line` element (`red-stroke-2`, `red-stroke-3`, … in red, `stroke-1`, … in another colour, stored as `#rrggbb`; blockout draws every line red), as wide as the layout's first red line, else 1.5 cm), selected and editable like any line in the 2D editor, and saved to the YAML with **Save**. The stroke is simplified to the fewest points that stay within 0.3 cm of what was drawn (also across the inner seam); clicks without a stroke are ignored. With a line selected, **continue <id>** extends that line instead, at its nearer end; its existing points are kept as they are.
- **Modes** (bar over the 2D editor; `?debug` in the URL adds the texture render time): **Reference** (default) draws the same layout with the reference images (PROJECT_BRIEF.md §10.1 F6): figures and existing tattoos show their asset's cut-out inside their box, multiplied onto the skin so white paper and pale skin vanish; fillers and bands are the procedural patterns below, clipped exactly to their shape (also across the inner seam); red lines lie on top of everything (§4.3); **Blockout** as above (with **Grid** on it also covers the old "cm grid" mode). A figure whose image is missing shows a labelled placeholder box with the reason (no asset, not in the manifest, file missing, no data folder, cannot be shown). Images are decoded once per page load and cached, so switching modes is instant.
- **Change image** (Layout tab): the element panel of a figure or existing tattoo shows its image large, with **Change image** (a picker panel next to the button: search, kind filter and the grid; click an image to assign it, Enter takes the first hit, Esc closes) and ‹ › to step through the images of the same kind. A selected figure also shows a floating **Change image** button beside it in the 2D editor. Each change is one undo step.
- **Assets** panel (Layout tab, right column): thumbnails of every `manifest.yaml` entry (hidden ones left out), filterable by kind and tag, with a search over id, notes, source and file. Select a figure or existing tattoo in the editor, then click an image to assign it (`asset:`). Missing files are greyed out, manifest problems are listed as warnings. **Reload** catalogues images newly copied into the project folder (the same as **Look for new images** in the Assets tab), then re-reads the manifest and the images. The element panel shows the assigned image with its cut-out marked and edits the reference fields below.
- **Export** (top bar, Layout tab): one click writes the handout for the tattoo artist and PNGs of every picture into the project folder (details below). With unsaved edits it reads **Save & export** and saves first. Progress and the result (where it was saved, **Open PDF**, or the error) show in a card at the bottom of the window. Disabled, with the reason as tooltip, while there are layout errors or images still loading, and without a project folder (or in the read-only sample).
- **Compare**: two variants side by side on the 3D arm, read-only (edit in the Layout tab). A full-bleed workspace: the two arms stand next to each other at a seam in the middle, each with its coverage table floating at its outer edge. Along the top float **Blockout / Reference** (left), the **A** and **B** pickers with ⇄ (swap) on the seam, and the four views (right); both arms share the camera, so rotating or zooming either one moves both. Every coverage cell that differs from the other variant by at least 2 points is tinted (red = more, blue = less; the tooltip gives the difference). The inspector column on the right sums it up ("3 elements differ", open skin of the whole arm A → B with the change in points; click the line to jump to the element list), shows the descriptions (once when both share it), the elbow pose, and the elements that exist in only one variant, whose values differ (by id, with the changed fields) or that are identical. An invalid variant file shows its error over its arm; in Reference mode a "Loading images…" chip shows while images load. While the Layout tab has unsaved edits, they can be compared too ("(unsaved edits)", with a dot on the picker, preselected against the saved file). Variants are the files in the project's `layouts/`; make one with **Save as…** (with a single variant and no unsaved edits the tab says so and offers **Open Layout**).
- **Assets** (tab): every catalogued image as a thumbnail grid with search, kind and tag filters and **Show hidden**; click one for its details, where it is used (element ids per saved layout), editable tags and notes (**Save**) and **Hide** / **Unhide** (a hidden image stays in the manifest as `hidden: true` but is left out of the Layout pickers). The line on top condenses the folder status (state, path, files, structure) with **Look for new images**, **Check folder** and a link to Settings → Project. The dev server writes these edits into `manifest.yaml` (`PATCH /api/assets/entries/<id>`, only `tags`, `notes` and `hidden`, comments kept).
- **Settings → Body & measurements** (was the Arm tab): pick the **sample body** (female or male) and optionally your **body height** (every value nobody measured is scaled to it; in a project folder both are written to `project.yaml`, in an older data folder to `measurements.yaml`), then a **region** (left/right arm, left/right leg, torso). The region fills the view in 3D with a 1 cm grid (bold every 5 cm, red centre lines; legend bottom left; view bar with the four fixed views and the screenshot camera top left; the elbow pose for arms). The form on the right lists the region's values by section (lengths, circumferences, positions, and the torso's shape ratios): an empty field shows the value in use as its hint (the sample body's, or the other side's for a limb), an entered value overrides it, ↺ resets a field to that value, and each row says whether it is **measured**, **edited** (unsaved, with the file's old value) or from the **sample** / **other side**. Every edit shows at once in every 3D view (Layout, Compare, full body). **Save** writes them into `measurements.yaml` per region under `regions:` (the left arm stays in the old top-level `lengths` / `circumferences` / `positions` blocks when the file uses them), keeping comments and untouched lines as they are; **Discard** drops them. The Settings tab and the section show a dot while there are unsaved values.
- **Measure yourself** (Settings → Body & measurements, optional): a guided wizard for the chosen region, one value per step: body height first, then lengths and circumferences in measuring order, each with a short instruction (where the tape goes, which landmark, relaxed or not) and a schematic with the tape line highlighted. The 3D region follows every value as it is typed. **Next** keeps the value, **Skip** leaves it as it was, **Back** goes back, **Leave** returns to the form at any step (entered values stay as unsaved edits); the summary lists what is your own and what keeps the sample's value, and saves. The torso's shoulder line and cross-section shape cannot be taped and are left to the form. The arm steps follow `docs/measuring.md`.
- **Elbow pose** (every 3D view: Arm, Layout, Compare): **Straight**, **Bent 90°** or the slider (0–120°) flexes the elbow; the forearm swings towards the palm side, the skin bends over about ±6 cm around the elbow tip, stretching a little on the outer side and creasing on the inner side. The texture and the unwrap stay the same, so it shows how the elbow and skull area deform. The pose is shared by all tabs; the medial and lateral views show the bend best. Exports still show the straight arm. Model and limits: `docs/adr/0005-elbow-bend.md`. **Screenshot** (the camera icon in the view bar on the Layout and Arm tabs; the top-right corner of the Projection tab's 3D view) saves a PNG to the browser's download folder. The open tab is kept in the URL (`#compare`), and the chip at the right of the header says whether the data folder is set (click it for Settings → Project).
- **Settings → Projection** (existing tattoos, `docs/adr/0014-guided-projection.md`): a list of the existing tattoos brought onto the body from photos, each with its first photo, body part, state ("Ready · 5 photos", "2 of 5 photos missing") and the layouts that show it. **Add existing tattoo** starts the guided setup, **Edit** opens it with the tattoo's answers, **Advanced** the full calibration page (below). The guided setup asks one thing per step, each with a short explanation and a small drawing: name and body part (all five regions); which photos (catalogued images, photos first; **Look for new images** catalogues new files in the project folder, e.g. its `photos/`); then per photo: **Turn** (click the picture in which the start of the body part, e.g. the wrist, is at the bottom), **Outline** (drag four dots onto the left and right edge), **Distances** (drag two points onto spots whose distance from the wrist crease, ankle or navel you know and type the cm) and **Side** (click one of eight drawings of a slice through the limb with the camera below; a fine-tune slider, and "the arm is twisted" for another side at the elbow, knee or neck). From the Distances step on, the model's skin grid lies on the photo, so a wrong answer shows at once. **Check and save** shows the tattoo on the 3D body part and on the unwrap, and saves the projection plus a locked existing element in a layout of that body part (one that already shows it, else the one open in the Layout tab, else the first, else a new `<region>-1`); it says which layout it went into. A layout with unsaved edits in the Layout tab is left alone (the message says so).
- **Advanced** (Settings → Projection → Advanced, the former Projection tab): every number of a calibration, e.g. Jan's Anubis built from all five photos (`anubis1_nr.JPG`, `anubis_extra1–3.JPG`, `anubis_extra4.png`; details below). A full-bleed workspace like the Layout tab: the photo editor fills the left, with the photo switcher floating on top and a status bar below it (grid colour key, photo size and turn; hover it for the full how-to). The middle column shows the 3D body part (view buttons and screenshot on top, elbow pose at the bottom) over the combined patch. The inspector on the right holds **This photo**, **Patch (all photos)** (hover a label for what it means) and **Share of the patch** (each photo's share and weight; click a row to open that photo). **‹ Existing tattoos**, the projection picker, **Revert** and **Save** sit in the top bar; the picker and the section show a dot while there are unsaved edits, and patch warnings show as a notices chip there. **Save** (or ⌘S / Ctrl+S) writes the YAML and confirms with "Saved …"; **Revert** drops the edits. Without a data folder, or while a photo is missing or loading, its frame says why and its fields are disabled.
- **Image studio** (mode _Edit_): touch up a reference image without leaving the planner. Arm photos and photos of existing tattoos are not listed. The tab is a full-bleed workspace: the image browser on the left (search by id, notes or source, filter by kind and tag; **Reload** also picks up images newly copied into `refs/`, `cards/`, `existing/` or `arm-photos/`), the canvas in the middle, and the inspector on the right. Pick an image (the canvas shows it large with a "Versions of …" row of its saved edits), choose an engine and run a step; the first step opens an **editing session** (`docs/adr/0010-editing-sessions.md`). A version strip v0 → v1 → … sits above the canvas; the last version (outlined) is where the next step starts, and the button names it (e.g. "Apply Line art to v1").
  - **Built-in** (default, no key, no network; `docs/adr/0013-builtin-image-operations.md`): remove background (flood fill from the border with a colour tolerance and a soft edge, for scans and drawings on a plain background), line art (threshold with smoothing), levels / contrast (black and white point), black and grey, invert, rotate (90° left or right, 180°) and mirror. The canvas previews the chosen operation live while you move its sliders; **Apply** runs it on the full image and adds the result as the next version at once. **Undo** drops the last version again.
  - **Generative** (GPT Image, redraws): for changes that need new pixels, such as fewer snakes, a skull moved or detached, a hand removed and the area behind it filled in. Presets: simplify, remove an object, remove text / watermark. The dev server sends a copy of the image and your instruction (German is fine) to OpenAI (`gpt-image-2.5-sunburst`, about a minute) and shows 1–3 variants, each with a rough cost, next to the version they came from; click one to see it large, before and after side by side (← / → step, Esc back). **Continue with this** makes a result the next version; **Try again** reruns the prompt. A generative result is redrawn and may change details you did not mention, so compare before and after. Needs your own OpenAI API key (see [Image generation](#image-generation-bring-your-own-key)): in the desktop app entered in Settings → Image generation, from git in `.env` as `TATTOO_OPENAI_API_KEY`. Without a key the Generative engine shows this setup step and stays off; the built-in operations keep working. Design and limits: `docs/adr/0008-generative-edits.md`.
  - **Versions and saving:** engines mix freely within a session (e.g. fewer snakes with GPT Image, then remove the background built-in). Click an earlier version in the strip to see its other results, **Continue from vK** or **Save vK**. **Save & close** writes the last version as `edits/<original>-edit-N.png` with a manifest entry (`derived_from: <original>`, tag `edited`, each step with its engine in `notes`, `From <id>.` when it was an edit of an edit), ends the session and picks the new file, ready for the next round. **Close** ends a session without saving (it asks first). Sessions survive tab switches and page reloads, not a restart of the planner. To try a version on the arm, **Save vK** keeps it as an image without closing the session; assign it in the Layout tab, then come back and carry on. **Dark / Light** switches the checkerboard behind the images (dark by default; light shows black line work on transparent backgrounds). The original is never changed. Without a project folder the tab only links to Settings → Project; in the sample project it is off (read-only).
  - **Reference images** (GPT Image only): the **+** in the corner of an image on the left (shown on hover) sends it along, up to four, numbered in the order they are sent and listed in the inspector, e.g. "Mache ein rotes Dreieck drumherum wie in diesem Referenzbild". The prompt names each reference by its id and notes.
  - **Create new** (mode switch at the top of the inspector): describe a new motif or pattern (until there is a first version, the canvas shows an empty artboard in the chosen format), optionally click up to four images on the left as references, pick a name, format (square, tall, wide) and background (transparent by default), click **New image** and then **Create with GPT Image** (1–3 variants). From v1 on the session works like any edit (built-in or GPT Image); **Save & close** writes `generated/<name>-N.png` and a manifest entry (kind `idea`, tag `generated`, prompts and references in `notes`). Design: `docs/adr/0009-create-images.md`.
- **Settings → Image generation**: whether an OpenAI key is set for the Image studio, how to set one up, and a link to `docs/privacy.md`.
- **Settings → Project**: the open project's name, body and height (saved in `project.yaml`), its folder (**Show in Finder** in the desktop app), **Open other project…** and **Close project**; for the sample **Save as new project**, for an older data folder **Move into project**. Below, the folder's files per sub-folder in collapsible tables, the expected structure and which features need which folder; **Check again** re-reads it.

Geometry and unwrap conventions: `docs/adr/0002-arm-geometry-and-unwrap.md`, generalised to every body region in `docs/adr/0011-bodies-and-regions.md`.

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

**Export** in the top bar (Layout tab) renders the saved layout and writes, only into the project folder:

```
<project>/exports/
├── v1-baseline-2026-11-03.pdf      the handout
└── v1-baseline-2026-11-03/         PNGs: {front,back,medial,lateral,unwrap}-{blockout,reference}.png
```

A second export of the same layout on the same day gets `-2`, then `-3`; nothing is ever overwritten. A card at the bottom of the window shows the progress and, when done, the file name and an **Open PDF** link (served read-only by `GET /api/exports/<base>.pdf`); about 15–20 s. If it fails, the card shows the error, naming the step that failed.

The PDF (A4, English): a cover with the layout's name as title, its description as subtitle, the date, the note that this is a sketch and the artist has creative freedom, and a legend of the element types; all four views (front = inner, back = outer, medial, lateral) at a glance with blockout and reference side by side; one page per view with the elements facing that side; the unwrap with cm grid in both modes; a table of every element (type, reference image, size in cm, position, style or pattern, `notes:` from the YAML); coverage per zone; what this layout leaves open (unset heights, missing images, placeholder measurements). All handout wording lives in `src/export/strings.ts`, ready for a German version. Give an element a `notes: "…"` line in the YAML to pass a remark to the artist.

The endpoint behind it (`server/exportsApi.ts`): `GET /api/exports` (enabled or why not), `GET /api/exports/<path>` (read a written file back), `POST /api/exports` (reserve a name), `PUT /api/exports/<base>.pdf` or `/<base>/<name>.png` (write one file; type, signature, size and path are checked; nothing outside `exports/`). Decisions: `docs/adr/0004-export.md`.

### Reference fields in a layout

Figures and existing tattoos take these optional fields (rules in `src/layout/imageFit.ts`):

| Field                | Meaning                                                                                                                                                                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `crop`               | `{ x, y, w, h }`, 0–1 from the left/top edge of the image as stored (before turning). Overrides the asset's `crop` in the manifest; without either, the whole image.                                                                        |
| `image_rotation_deg` | `90`, `180` or `270`: turns the cut-out clockwise, e.g. for a photo of the arm lying sideways.                                                                                                                                              |
| `flip`               | `true` mirrors the image left-right (after turning).                                                                                                                                                                                        |
| `feather_cm`         | soft edge of the cut-out in cm, default `1`; `0` for a hard edge.                                                                                                                                                                           |
| `filter`             | `none`, `grayscale` or `hatching` (grayscale with an engraving line screen). Default: `grayscale` when the element's centre is on the forearm, `none` above the elbow. Photos are stretched so skin turns white.                            |
| `projection`         | existing tattoos only: a calibration in the project's `projections/` (e.g. `anubis`). The tattoo is then drawn from all its photos where they put it, and the fields above, `position` and `size_cm` only apply while that cannot be built. |

Size: when `size_cm.w` is not set, the box takes the proportions of the upright cut-out (in every mode, so blockout, metrics and picture agree; until the image has loaded, or without a data folder, the old 0.55 × height is used). When both `h` and `w` are set, the image is fitted inside the box without distortion and centred.

## Configuration files

All of these live in the project folder (for an older data folder not yet moved: in this repo's `config/`).

- `project.yaml`: `version: 1`, `name`, `body: female | male` (the sample body), optional `height_cm`; edited in Settings → Project, unknown keys are kept. Body and height here win over the same keys in `measurements.yaml`.
- `measurements.yaml`: measurements in cm (PROJECT_BRIEF.md §13.1). The top-level `arm: left` blocks are the left arm; optional `body` and `height_cm` (the place before `project.yaml`; used only where `project.yaml` says nothing) and `regions:` with any subset of a region's keys (`src/body/inputs.ts` lists them). `null` or a missing key means not measured yet; a project without the file uses the sample body. How to measure and photograph the arm: `docs/measuring.md`.
- `layouts/*.yaml`: layout variants (§13.2), e.g. `v1-baseline.yaml`; a new project starts with an empty `first-sketch.yaml`. Hand-editable.
- `projections/*.yaml`: how photos of an existing tattoo map onto a body region (ADR 0006, ADR 0014; `region:` defaults to `arm-left`), written by the guided setup, fine-tuned in Advanced or by hand.

## For git users and development

Technical decisions live in `docs/adr/`, the product plan in `docs/product/roadmap.md`; `PROJECT_BRIEF.md` is the original brief for Jan's own sleeve. Decisions Claude made without Jan are listed in `docs/claude-decisions.md` for review.

### Setup

```sh
npm ci            # install (install scripts are disabled by .npmrc)
npm run hooks     # enable the pre-commit guard (once per clone)
npm run dev       # http://127.0.0.1:4320
```

Without a project the planner opens a start screen: create a project (name, body, a folder picked in the in-browser folder dialog, which only shows folders inside your home folder) or open an existing one. The open project and the recent ones are remembered in `~/.config/tattoo-planner/config.json` (`$XDG_CONFIG_HOME/tattoo-planner/config.json` when that is set). The desktop app uses the native folder dialog instead.

**Data stays out of git.** Images, PDFs and exports are rejected by `.gitignore`, by the pre-commit guard (`scripts/check-binaries.mjs`) and by CI. The sample project in `samples/demo/` is YAML only; its placeholders are drawn at runtime (`src/sample/placeholders.ts`) and only become PNG files in a folder the user picks with **Save as new project**.

### Settings for git users

To pin the planner to one folder instead (Jan's Seafile folder, CI), set `TATTOO_DATA_DIR` in the shell or in a git-ignored `.env` (`cp .env.example .env`); it wins over the remembered project, and switching or closing projects is then disabled. Quote the path when it contains spaces; `~` is expanded:

```sh
TATTOO_DATA_DIR="~/Your Secure Cloud/<library>/tattoo-planner-data"
```

The only other settings are optional and for generative edits in the Image studio: `TATTOO_OPENAI_API_KEY` and, rarely needed, `TATTOO_OPENAI_MODEL`, `TATTOO_OPENAI_FIDELITY`, `TATTOO_OPENAI_QUALITY` (see `.env.example`). In the desktop app the key is entered in Settings → Image generation instead .

### Older data folders and `npm run migrate` (Jan's workflow)

An older data folder (with `manifest.yaml` but no `project.yaml`, such as Jan's) still opens: its images in `refs/`, `cards/`, `existing/`, `arm-photos/` and `ideas/` keep working, and its layouts, projections and measurements keep coming from this repo's `config/` until you press **Move into project** in Settings → Project or run `npm run migrate -- <folder>`. Both copy `config/layouts/*`, `config/projections/*` and `config/measurements.yaml` into the folder (never overwriting) and write `project.yaml`; afterwards the repo's `config/` is no longer read for it.

Jan's move, once: `npm run migrate -- "~/Your Secure Cloud/<library>/tattoo-planner-data"` (or the button), then check Settings → Project.

### Jan's sleeve

`v1-baseline.yaml` uses these asset ids: `anubis-photo` (must point at `arm-photos/anubis1_nr.JPG`, because the layout's crop is fitted to that photo), `rhonas-card` (the Rhonas card image from ideas.pdf; the layout's crop is fitted to the full card), `medusa-ref-01`, `skull-ref-01` and `pegasus-ref-01`. An id that is not in the manifest renders as a placeholder. The entry for the Anubis photo:

```yaml
- id: anubis-photo
  file: arm-photos/anubis1_nr.JPG
  kind: existing
  tags: [anubis, existing]
```

#### Anubis from all photos (Settings → Projection → Advanced)

The Anubis wraps partly round the forearm, so one photo cannot show all of it. `config/projections/anubis.yaml` says, for each photo, where the forearm's outline is, where the wrist crease and the top of the tattoo are, and which side of the arm faces the camera (numbers only; the photos stay in the data folder). The planner projects every photo onto the arm's skin coordinates and blends them, the most frontal photo counting most, into one patch that the Layout, Compare and Export use for every element with `projection: anubis` (v1-baseline's `anubis`). The patch is built in the browser when the page loads (about half a second); nothing is written into the data folder.

The **Advanced** page shows each photo upright with the model's skin grid on it: red = inner centre line, green = lateral and medial lines, yellow lines every 2 cm along the arm, magenta every 10 cm from the wrist crease. Drag the orange edge ends onto the forearm's outline and the red marks onto points whose distance from the wrist crease you know (**Mark 1/2 (cm)** in "This photo"), and move the **View at wrist/elbow** sliders (the u facing the camera) until the grid sits on the arm the way the tattoo does. The middle column shows the arm and, below it, the combined patch (centred on the patch); the percentage on each photo's tab (and in **Share of the patch**) is the share of the patch it supplies. **Save** writes the YAML, keeping its comments. The fit Claude made is a starting point: if the head or the ribbons look doubled, nudge the photo whose copy is off.

Requirements: the five photos in `arm-photos/` with entries in `manifest.yaml` (`npm run assets:scan` adds them; the entry is found by file path, its id does not matter). Missing photos are left out with a warning; without any photo (or without a data folder) the planner shows the old single-photo box (`asset`, `crop`, `position`, `size_cm` of the element). Design and limits: `docs/adr/0006-anubis-projection.md`.

**On your Mac** after pulling this change: nothing new to install. Run `npm run assets:scan` once if `manifest.yaml` has no entries for `arm-photos/anubis_extra1.JPG`–`anubis_extra3.JPG` or `anubis_extra4.png` yet, then `npm run dev` and open Settings → Projection → Advanced (anubis).

### Desktop app from a checkout

The desktop app (Electron, `desktop/`, docs/adr/0015-desktop-app.md) runs the same server and page as `npm run serve` in its own window. The project choice is remembered in the app's settings folder (`~/Library/Application Support/Tattoo Planner/` on macOS) instead of `~/.config/tattoo-planner/`, and the OpenAI key is entered in Settings → Image generation: it is encrypted with the macOS Keychain (Electron `safeStorage`), stays in the app's main process and is sent only to OpenAI, with a generative edit you start. `TATTOO_DATA_DIR` and a checkout's `.env` still work when the app is started from git.

From a checkout:

```sh
npm run desktop     # builds the page and the shell, then opens the app
```

The first launch downloads the Electron binary for your platform (about 100 MB; Electron no longer uses an install script, so `.npmrc`'s `ignore-scripts` needs no `npm rebuild`). To fetch it ahead of time: `npx install-electron`.

Build the DMGs (macOS only; arm64 and x64 into `release/`, which git ignores):

```sh
npm run dist:mac
```

Without a Developer ID certificate the app is ad-hoc signed and not notarised. Signing switches on when `CSC_LINK` (or `CSC_NAME`) and `CSC_KEY_PASSWORD` are set, notarisation when `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID` are set too. CI (`.github/workflows/desktop.yml`) builds the DMGs on every `v*` tag and on manual runs, uploads them as a workflow artifact and attaches them to a draft GitHub Release for tags; it uses the same variables as repository secrets when they exist.

**First start of an unsigned app.** macOS says the app cannot be opened because Apple cannot check it. Either right-click (or Control-click) Tattoo Planner in Applications → **Open** → **Open**, or try to open it once, then go to System Settings → Privacy & Security and click **Open Anyway**. macOS remembers the choice. Each new version (ad-hoc signed again) may ask once for Keychain access to "Tattoo Planner Safe Storage"; allow it so the stored key can be read.

`npm run dist:dir` packs an unpacked app for the current platform into `release/` (a quick packaging check, also on Linux).

### Cataloguing images from the command line

```sh
npm run assets:scan  # catalogue new images in images/, photos/ and the older folders (Reload in the planner does the same)
```

It scans the open project (`TATTOO_DATA_DIR`, else the remembered one) and writes only its `manifest.yaml`: an entry for every image no entry references yet, with an id from its path (`cards/rhonas.jpg` → `cards-rhonas`) and the kind from its folder (`images/` → `reference`, `photos/` → `arm-photo`; older folders: `cards/` → `card-art`, `refs/` → `reference`, `existing/` → `existing`, `arm-photos/` → `arm-photo`). A text file with the same name next to an image (`refs/medusa.txt`) becomes its `source`. Running it again is safe: it only adds entries for new files. Your edits to `manifest.yaml` (ids, notes, tags, comments, order) are kept; a manifest with errors is never overwritten. Details: `docs/adr/0003-ideas-pdf-ingestion.md`.

The former `npm run ingest` (splitting `ideas.pdf` into images with mupdf) was removed: it was specific to one PDF and mupdf's AGPL licence does not fit an open-source product (`docs/product/roadmap.md` §3). Images it extracted into `ideas/` earlier keep working: they are ordinary manifest entries (`page` and `bbox` stay as they are).

### The server

The planner's server (`server/`, mounted by `npm run dev` and `npm run serve`) reads `<project>/manifest.yaml` (schema: `src/assets/manifest.ts`) and serves, on `127.0.0.1` only:

- `GET /api/assets`: the manifest entries, each with `exists`; invalid entries become warnings instead of hiding the rest; no manifest yet = an empty list.
- `GET /api/projections`, `PUT /api/projections/<name>`: the calibrations in the project's `projections/` (text YAML, validated, comments kept).
- `GET /api/assets/image/<id>`: the image of one manifest entry, nothing else. Only `png`, `jpg`/`jpeg`, `webp`, `gif` and `avif`; HEIC/HEIF answer 415 (export them as JPEG). Paths must be relative, without `..`, and stay inside the project folder after resolving symlinks.
- `/api/project`: status (`none | legacy | project`, path, name, body, height, recent), `PATCH` (name, body, `height_cm`; comments kept), `POST open | create | close | migrate | open-sample | save-sample`, `GET browse?path=` (sub-folders for the folder dialog: inside the home folder only, no symlink escapes, no dot folders) and `GET`/`PUT measurements` (the raw text of `measurements.yaml`). Details in `server/projectApi.ts`.
- While the sample project is open, every write answers `409` with a read-only message (`server/sampleApi.ts`), `GET /api/exports` and `GET /api/edits` report exports and edits as unavailable, and `GET /api/assets/image/<id>` serves the placeholder drawn for that entry.

### Commands and code layout

| Command                       | What it does                                                                      |
| ----------------------------- | --------------------------------------------------------------------------------- |
| `npm run dev`                 | Vite dev server with the planner's API (`server/`)                                |
| `npm test`                    | Vitest unit tests                                                                 |
| `npm run lint`                | ESLint and Prettier check                                                         |
| `npm run format`              | Prettier write                                                                    |
| `npm run typecheck`           | TypeScript project build check                                                    |
| `npm run build`               | Static production bundle in `dist/`                                               |
| `npm run serve -- [port]`     | serves `dist/` plus the API on 127.0.0.1 without Vite (run `npm run build` first) |
| `npm run migrate -- <folder>` | moves the repo's `config/` into a project folder (see above)                      |
| `npm run check`               | lint, typecheck, tests and the binary guard over all files                        |
| `npm run desktop`             | builds the page and the desktop shell, then starts the Electron app               |
| `npm run desktop:build`       | compiles `desktop/` and the server into `dist-desktop/` and draws the app icon    |
| `npm run dist:mac`            | the macOS DMGs in `release/` (see "Desktop app")                                  |
| `npm run dist:dir`            | an unpacked app for the current platform in `release/` (packaging check)          |

`npm run serve` takes the port from its argument or `TATTOO_PORT` (default 4322; `0` picks a free one) and prints the URL; the desktop shell reuses `startServer()` from `server/standalone.ts`.

Layout: `src/body/` builds the body regions, sample bodies, placement, mesh and unwrap coordinates (plain TypeScript), `src/render/` paints textures (blockout, reference, patterns), `src/layout/` holds the layout schema, shapes and image-fit rules, `src/assets/` the manifest schema and the asset browser, `src/viewer/` holds the 3D view and panels, `server/` holds every request handler as plain Node modules (`createApi()` in `server/api.ts`, the project folder in `server/project/`, the Vite-free server in `server/standalone.ts`), `src/project/` the project schema, start screen, folder picker and project screen, `src/data/` the folder listing on the project screen, `src/export/` builds the handout and the PNGs, `src/projection/` projects photos onto the skin (model, patch, calibration schema, the guided wizard's logic in `wizard.ts` and `layoutLink.ts`, the list, wizard and Advanced pages), `src/edits/` edits reference images with built-in operations or GPT Image and creates new ones (prompts and rules, the Image studio tab; `server/editsApi.ts` runs the generative jobs and keeps the sessions; the pixel operations live in `src/render/builtinOps.ts`), `src/config/` holds the config schemas, `desktop/` the Electron shell (main process, preload, key store, URL rules, electron-builder config; the page's side of the bridge is `src/desktop/bridge.ts`), `scripts/check-binaries.mjs` is the pre-commit guard, `tests/` the unit tests.

#### UI conventions

The UI is dark by default, in the "Pro creative tool" style (`docs/claude-decisions.md`, 2026-11-04), with a light theme (Settings → Appearance: System, Light, Dark; ADR 0018). All colours, radii and type sizes are tokens at the top of `src/styles.css`; the comment there lists the rules. In short: `--accent` (blue-violet) is the only interaction colour (selection, focus, primary button, pressed tools), `--red` is for red lines only, `--danger` for errors, `--warn` for notices. Opaque blocks on a page are `.panel` / `.card`; controls over a canvas float in `.float` (with `.float-head`, `.float-title`, `.float-bar`). Buttons: default (hairline), `.primary`, `.ghost`, `.danger`, `.link`, `.icon-button`; `.segmented` for a choice of a few, `input.switch` for on/off, `.chip` for status, `.notices` / `.notice` for messages, `.empty` for empty states, `.mono` for numbers, `<kbd class="kbd">` for key hints. Icons are inline SVG in `src/ui/icons.tsx`. A tab whose page is a full-bleed workspace is listed in `FULL_BLEED` in `src/App.tsx`; a page can put controls into the top bar through the slots App passes to the Layout and Projection tabs (`HeaderSlots`). Fonts (Inter, JetBrains Mono) are bundled from npm, so the planner works offline.

### Status

| Phase (PROJECT_BRIEF.md)            | State                                                                                                         |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 0 Bootstrap                         | done                                                                                                          |
| 1 Stack check and scaffold          | done                                                                                                          |
| 2 Parametric arm and viewer         | done                                                                                                          |
| 3 Unwrap editor and blockout mode   | done                                                                                                          |
| 4 Assets, ideas PDF, reference mode | done                                                                                                          |
| 5 Export for the artist             | done                                                                                                          |
| 6 Iteration and polish              | in progress: variant comparison, elbow-bent pose, red-line brush, Anubis from all photos and image edits done |

Phases A–D of the product plan: `docs/product/roadmap.md`.
