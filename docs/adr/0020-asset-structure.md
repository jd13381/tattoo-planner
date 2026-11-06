# ADR 0020: Asset structure, references and deleting images

- Status: accepted (2026-11-06, Jan's test notes; details decided by Claude, see docs/claude-decisions.md "Assets")
- Context: Jan's notes on the Assets tab. He wants to delete an image in the detail view; to select several images and then act on them ("Auswählen + Aktion", like the iPhone Photos app: delete or hide); and to keep measuring photos apart from photos of existing tattoos. A project can now hold several persons (ADR 0017), so photos belong to a person and the image library is shared. Jan's real manifest (`assets/manifest.yaml`, written by hand and by the scan) must stay byte-identical while it is only read, and his older folders (`refs/`, `cards/`, `existing/`, `arm-photos/`, upper-case `.JPG`) must keep working.

## Decision

### Categories, derived at read time

Every image is in exactly one category. There are six:

- **Shared library:** Ideas (`reference`), Made in studio (`generated` and `edit`), Backgrounds (`background`).
- **Per person:** Measuring photos (`measuring`) and Tattoo photos (`existing`).

`categoryOf(entry, projectionFiles)` in `src/assets/category.ts` derives the category. The first rule that matches wins:

1. An explicit `category:` field in the entry.
2. Kind `background` or `backgrounds/` → background (the Image studio's Background mode keeps tiles there, ADR 0019; an edited background keeps the kind and stays one).
3. `derived_from` or `edits/` → edit.
4. `generated/` or the tag `generated` → generated.
5. `photos/measuring/` → measuring.
6. `photos/existing/`, `existing/` (also `persons/<id>/existing/`) or kind `existing` → existing.
7. Any other body photo (kind `arm-photo`, `photos/`, `arm-photos/`, a person's folder) → existing when a projection uses the file, else measuring.
8. Anything else → reference.

`personOf` gives a photo its person in this order: an explicit `person:` field, then `persons/<id>/…`, then the root person `me`. The shared library has no person.

The derived values travel as `effectiveCategory` and `effectivePerson` in `GET /api/assets`. They are never written back. Only an explicit **Move to …** writes `category:` (and `person:` for a person other than the root), so a manifest that is only read keeps every byte.

Sections in the sidebar:

- **All images.**
- **Library:** Ideas, Made in studio, Backgrounds.
- **The current person:** Measuring photos, Tattoo photos. The heading is "Your photos" while the project has one person, else the person's name.
- **Smart albums:** Unused, Missing files, Hidden.

The image pickers offer the library. Photos come in with a **Show photos** switch, and backgrounds where a background is asked for. The projection wizard lists the current person's tattoo photos, then their measuring photos, then everything else folded away.

### Persons

The server takes the store's persons (`ProjectStore.persons()`, ADR 0017) and gives each one its `layouts/` and `projections/` folder (`server/persons.ts`). References therefore count every person's use of an image. The page takes the current person from the persons store (`useCurrentPerson` in `src/assets/person.ts`). Switching person reloads the page, as before.

The scan catalogues `persons/<id>/photos/` and `persons/<id>/existing/`, and never looks inside dot folders (`.trash`, `.trash-pending`).

### References

`GET /api/assets/usage` returns, per asset id, where the image is used:

- layout elements: every `asset` or `*_asset` key, and the `source.image` of background layers (ADR 0019), across all persons
- projection photos
- edits derived from it
- open studio sessions

Cards show a usage badge. The detail panel links to each use; **Show** opens the layout and selects the element.

### Changing and deleting, with undo

`POST /api/assets/batch` takes `{ action: hide | unhide | move | delete, ids, … }` for up to 500 ids at once. All manifest changes are text-level. Removing or changing an entry cuts or edits its own lines only, checks that the result parses to the intended manifest, and falls back to a re-serialised document only when it does not. Every write, including the scan and the Image studio's "keep", runs under one process-wide manifest lock and is written atomically.

- **Hide, unhide, move** answer with an undo token. Undo restores the manifest text from before, but only while the file is unchanged since; otherwise it answers 409.
- **Delete** is refused for images an open studio session uses. A photo that a projection uses is refused unless `force` is set; the confirmation dialog shows a checkbox for that. Layout uses are listed in the dialog but do not block the delete: the element shows its missing-image state, as it did before.
- An accepted delete moves the files, and a `.txt` sidecar if present, into `<project>/.trash-pending/<token>/` and records the manifest text before and after in `pending.json`. Then the page shows an **8-second undo toast**.
- **Undo** puts the files back and restores the manifest, if it is unchanged since.
- The delete becomes final (**commit**) in any of these cases:
  - the toast expires
  - the page leaves (`sendBeacon`)
  - the server's 20-second timer fires
  - any assets request finds a pending delete older than 60 seconds
  - the server stops

  Commit hands the files to a `Trasher`:
  - the desktop app: Electron `shell.trashItem`
  - macOS from a checkout: a move into `~/.Trash`
  - elsewhere: `<project>/.trash/<stamp>-<id>/` with the entry as `entry.yaml`, so nothing is ever deleted outright

- A file that another entry still names is not moved.

`POST /api/assets/import` takes one dropped file into the section it was dropped on. The file is written with a unique name, never over an existing file, and the entry gets the section's category (and person). HEIC and other formats the browser cannot show are refused with a note.

### The page

The grid is a listbox with a roving focus. Plain click opens the detail; **Select** (or Cmd/Ctrl-click, Shift-click for a range) turns on select mode. A sticky action bar offers Hide/Unhide, Move to … and Move to Trash.

Keys:

| Key                | Action                                                    |
| ------------------ | --------------------------------------------------------- |
| arrows, Home, End  | move through the grid (with Shift: extend the selection)  |
| Enter              | open the detail                                           |
| Space              | select                                                    |
| Cmd/Ctrl+A         | select all                                                |
| Delete / Backspace | delete                                                    |
| H                  | hide                                                      |
| Cmd/Ctrl+Z         | undo the last action                                      |
| Esc                | closes the dialog, then ends select mode, then the detail |

The trash confirmation is a native modal `<dialog role="alertdialog">` with focus on Cancel. The detail panel has a "Danger zone" with Move to Trash and, in the desktop app, Reveal in Finder. The sample project is read-only: actions are disabled with a hint, and the server refuses every write (409).

## Consequences

- Jan's folders need no migration; his manifest changes only through an explicit action. Hide and move undo restore it byte for byte.
- Categories can disagree with an old `kind:` (an `arm-photo` that a projection uses shows as a tattoo photo). An explicit Move fixes it for good.
- `.trash-pending/` and `.trash/` live in the project folder and sync with it until committed or emptied. Both are dot folders the scan skips.
- Not yet verified on a Mac:
  - macOS `~/.Trash`
  - Electron `shell.trashItem`
  - Reveal in Finder
  - Jan's real manifest
- Removing a person (ADR 0017) uses its own trash code (`server/project/trash.ts`, with a freedesktop trash on Linux). Folding both into one module is a follow-up.
