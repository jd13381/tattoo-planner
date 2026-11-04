# ADR 0010: Editing sessions in the Image studio

- Status: accepted (2026-11-04)
- Context: Jan found "Edit further" confusing: "I can't get out of editing anymore". A review (three independent UX passes over the code) found the causes. Results were grouped by the image family (`derived_from ?? id`), so picking a kept edit showed the same pile again. Nothing ended a round: Keep closed nothing and there was no Close. The image a run started from was a UI flag that was cleared after every run, so the screen showed the original while the variants came from a result, and the next prompt silently went back to the original. Starting a run with Edit further also discarded the other results of the family, including the chosen one. Jan asked for "keep this image → save → close → pick it again → next round" and approved the proposal built on it.

## Decision

**An explicit editing session per image: a source (v0) and a linear stack of versions v1 … vN. Every run starts from the last version; "Continue with this" makes a result the next version; "Save & close" writes the last version as a new image and ends the session.** Rules in `src/edits/session.ts` (pure, unit-tested), sessions held by the dev server (`src/edits/server/editsApi.ts`).

- **Browse** (no session): the picked image large, with a "Versions of <original>" row of its saved edits, and **Start editing** (Create mode: name, format, background and **New image**). No results, no history. Sessions still open are listed in the inspector, and thumbnails of images with one carry an "editing" badge.
- **Session**: the bar shows "Editing <id>", **Close** and **Save & close**. A version strip above the canvas shows v0 → v1 → …; the last one is outlined and says "Next run starts here". The run button names the version ("Make 2 variants of v2", "Edit v1 with Claude"). The canvas shows the version on view next to the results made from it. Results not picked stay visible under their version until the session closes. Clicking an earlier version shows its results, **Continue from vK** (after a confirm, drops the later versions) and **Save vK**. Picking another result of an earlier version also drops the later versions after a confirm. The stack never branches. **Try again** reruns the last prompt on the same version; the prompt stays in the text field after a run.
- **Saving**: **Save & close** keeps the last version (if not already saved), closes the session and picks the new file in the browser, so the next round is one click on Start editing away. A new image (Create mode) switches to Edit mode with the saved file picked. **Save vK** keeps an intermediate version without closing. Saved files are named and stored as before (ADR 0007/0009: `edits/<original>-edit-N.png`, `generated/<name>-N.png`).
- **Provenance**: the manifest entry of a saved version is built from the image the session edited (tags, kind, source; crop only at the same size), and `derived_from` still names the original. An edit of a saved edit starts its notes with `From <that edit's id>.`, whose own entry holds the earlier steps.
- **Close** without saving asks first when unsaved versions, other results or running edits would be lost, then discards every unsaved job of the session (working folders deleted).
- **API**: `POST /api/edits/sessions` `{ mode: "edit", assetId }` (returns the session already open on that image, if any) or `{ mode: "create", name, size, background }`; `POST /api/edits/sessions/<id>/pick` `{ job }`, `/truncate` `{ length }`, `/save` `{ job? }`, `/close`. `POST /api/edits` with `session` runs on the session's last version and ignores `assetId`, `fromJob` and the create fields. `GET /api/edits` lists the open sessions. Jobs carry `session`. Requests without a session still work as in ADR 0007 (tests, scripts); the page always uses sessions.
- **Lifetime**: sessions live in the dev server's memory like the jobs. Restarting `npm run dev` ends them; the status bar says so. Switching tabs or reloading the page keeps them.

Also in this change (Jan, 2026-11-04):

- **Dark checkerboard by default**, also behind the thumbnails (the light letterbox around portrait images looked odd in the dark app). The Light switch stays, because black line work on a transparent background disappears on dark; the choice is remembered in the browser.
- **Reload looks for new images**: the Reload buttons (Image studio, Layout tab Assets panel) first run the same scan as `npm run assets:scan` (`POST /api/assets/scan`, `src/data/server/scanFolder.ts`), then re-read the manifest. A line under the button says what was added, what was skipped (HEIC/TIFF) and which images lie outside the scanned folders (`cards/`, `refs/`, `existing/`, `arm-photos/`).

## Alternatives

- **Jan's flow literally, a save for every step**: clear, but fills `edits/` and the manifest with half-steps and needs a trip through the browser per tweak. Kept as the main exit (Save & close, then Start editing on the saved file); steps inside a session need no file.
- **Branching tree of versions**: more power than a 2–6 round sketch for the artist needs, and harder to read.
- **Chat-style thread**: hides which image the next run works on.
- **Session state only in the browser**: lost on every tab switch (the tab unmounts); the server already holds the jobs.
- **Writing sessions to disk** to survive a restart: possible later; for now unsaved previews already end with the dev server (ADR 0007).

## Consequences

- "Keep as new image", "Edit further", "Discard" on tiles, the "Earlier" section, the Before switch and the inspector's Source section during a session are gone; `staleJobs` and `splitRound` are removed.
- Picking a result never deletes anything until the session closes; temp folders of unpicked results live until Close or the server stops.
- One session per image; a new image can have several sessions side by side (each listed under Open sessions).
