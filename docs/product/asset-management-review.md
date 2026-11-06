# Asset management review (2026-11-06)

Synthesis of three reviews (information architecture, interaction design, frontend architecture) run before the Assets rework; ADR 0020 records what was built. Kept as the requirements reference for later changes.

Lead's decisions in **bold** where analyses differed.

## Categories (new optional manifest fields `category`, `person`; `kind` kept)

- Shared: `reference` (UI "Ideas"), `generated` + `edit` (UI "Made in studio", shown as one section with a sub-filter), `background` (UI "Backgrounds").
- Per person: `measuring` (UI "Measuring photos"), `existing` (UI "Tattoo photos" / "Existing tattoos").
- Pure `src/assets/category.ts`: `categoryOf(entry, projections?)`, `personOf`. Order: explicit `category` wins; `derived_from` → edit; under `generated/` or tag generated → generated; kind background or under `backgrounds/` → background; `persons/<id>/…` → that person; `photos/measuring/` → measuring; kind `existing` → existing; kind `arm-photo` / under `photos/`, `arm-photos/` → **existing if a projection references the file, else measuring** (Jan's front/back/lateral/medial arm photos are measuring photos; anubis* photos are projection photos); else reference.
- Derived at read time, never written back to existing entries. Write `category`/`person` only on user change or for new entries. KEY_ORDER: id, file, kind, category, person, derived_from, …, hidden. Jan's manifest must stay byte-identical when only read.
- New files land in: `images/`, `generated/`, `edits/`, `backgrounds/`; default person `photos/existing/`, `photos/measuring/`; other persons `persons/<id>/photos/{existing,measuring}/`. Never move/rename existing files (projections reference by path). "Move to…" changes fields only.
- Scan: path-based rule function instead of top-level SCAN_FOLDERS map; ignore dot folders (`.trash`).

## Navigation

- **Left sidebar** (like macOS Photos): LIBRARY: Ideas, Made in studio, Backgrounds; PERSON (current person name, or "Your photos" with one implicit person): Measuring photos, Tattoo photos; SMART: Unused, Hidden, Missing file; plus "All images" at top. Counts per entry. Tags/search apply within section. Kind dropdown becomes a sub-filter only where useful. Kinds never shown raw (label map).
- Move folder-health header ("structure 3/10") out of Assets into Settings → Project.
- Pickers scoped: motif ImagePicker/AssetBrowser default Ideas + Studio (+ Backgrounds for background layers), "Show photos" opt-in; projection PhotoPicker shows current person's Tattoo photos first, others collapsed; Image studio respects `hidden` and the category default.

## References / usage (pure `src/assets/references.ts`, replaces usage.ts with re-export)

- From layouts of every person (generic walk for any `asset` key, so background layers count), projections (photo `file` matched case-insensitively via fileKey), `derived_from` children, open studio sessions. Server endpoint `GET /api/assets/usage`. Cards show badge ("2 layouts", "1 projection", "Unused"); detail "Used in" entries are links (layout with element selected; projection in Settings → Projection).

## Delete

- Jan's decision: macOS Trash, warn with what uses it. **Trash implementation:** inject `trash(absPath)` into the server context: desktop passes Electron `shell.trashItem`; git/browser mode on macOS moves the file into `~/.Trash/` (rename, fall back to copy+unlink across volumes; unique name on clash); on other OSes, `<project>/.trash/<timestamp>-<id>/…` with `entry.yaml`. No `trash` npm dependency. Listing reports trash mode so copy is right.
- **Undo:** for 8 s via toast: server first moves files to a hidden `<project>/.trash-pending/` and restores catalogue entries on undo; commits to the real trash when the toast expires, on next request after timeout, or on server shutdown/page unload (sendBeacon). Keep it robust: pending items older than 1 min are committed on any later request/startup.
- Confirmation `alertdialog`, focus on Cancel. Title "Move N images to the Trash?", body explains Trash. If used: list of uses ("compass: element compass in layout left-arm"; "anubis-side: photo 2 of projection Anubis forearm"). Buttons: Cancel / Hide instead / Move to Trash. Projection photos: allowed only with explicit force checkbox "I know this breaks projection X" (**not hard-blocked**, but strongly warned). Open studio session → refused.
- Delete: trash file + sidecar `.txt`, skip if another entry uses same file; remove entry with `removeManifestEntries(text, ids)` keeping comments and other entries byte-identical. Dangling refs not rewritten; edits show "Edited from X (deleted)".
- One shared manifest lock `server/manifestLock.ts` used by scan, keep, PATCH, batch.
- Sample project: read-only guard already returns 409 for non-GET; UI disables actions up front with hint.

## Hide / Select mode

- `POST /api/assets/batch {action: hide|unhide|set|delete, ids, patch?, force?}` (≤500), single delete = one-id batch.
- Select mode like iPhone Photos: "Select" button; click toggles; shift-click range; cmd-click toggle (enters select mode); Cmd+A selects visible; Esc layered exit; "Done". Sticky bottom action bar `role=toolbar`: "3 selected · 1 in use · Hide/Unhide · Move to ▾ · Move to Trash… · Done", aria-live count. Pure `src/assets/selection.ts` with tests.
- Hidden: excluded everywhere unless "Show hidden"/Hidden smart album. Undo toast after hide/move.
- Keyboard: roving focus grid; Enter open detail; Space toggle; Delete/Backspace opens trash dialog (never deletes without it, not in inputs); H hide; Cmd+Z undo while toast.
- Selected state distinct from focus ring (check glyph).

## Detail panel

- Large preview, id, category label + "Move to…", source, tags (fix clipped input: hint into placeholder), notes; actions Hide/Unhide, Reveal in Finder (desktop only), danger zone "Move to Trash…". Per category extras: Studio: "Edited from" link + children strip + prompt; Measuring photos: person, pose label if derivable; Tattoo photos: used in projections. In select mode: summary of selection.

## Import (should)

- Drag & drop onto Assets: overlay "Drop to add to <section>", copies into the section's folder with category/person set; HEIC/TIFF rejected per file with message; new cards selected after drop; scan is not needed.

## Empty states (copy)

- Ideas: "No ideas yet. Drop reference images here, or make one in the Image studio."
- Measuring photos: "No measuring photos yet. They help check your measurements. Drop photos of your arm here."
- Tattoo photos: "No photos of existing tattoos yet. Add them here, then bring a tattoo onto the body in Settings → Projection."
- Filter: "Nothing matches 'x' in <section>. [Clear filter]"; only hidden: "All N images here are hidden. [Show hidden]".

## Accessibility

listbox/option with aria-selected, real alt text, focus kept after actions (next card after delete), toast timer pauses on focus/hover.
