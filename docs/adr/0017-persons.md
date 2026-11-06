# ADR 0017: Several persons in one project

- Status: accepted (2026-11-06, Jan's test notes; data model as agreed with Jan, details decided by Claude, see docs/claude-decisions.md)
- Context: Jan: "Man muss im Tool mehrere Personen anlegen können, die eine eigene Body-Repräsentation haben … ich bin ein Techie und erstelle für Xenia und mich in dem Tool Repräsentationen." Jan's decisions: one project holds several persons, each with an own body (female or male sample body plus optional own measurements), own layouts, own projections and existing tattoos, own measuring photos; the idea library is shared. Jan's real project must open unchanged.

## Decision

### project.yaml

```yaml
version: 1
name: Our tattoos
body: male # the first (root) person's sample body, as before
height_cm: 182 # the root person's, optional
active: # the root person's active variant per region (Home shows it)
  arm-left: v1-baseline
persons: # optional: further persons
  - id: me # optional entry: only names the root person and fixes its place
    name: Jan
  - id: xenia
    name: Xenia
    body: female
    height_cm: 168
    active: { torso: back-1 }
```

- **The top level belongs to the root person** (id `me`): `body`, `height_cm` and `active` mean what they meant before persons existed, and the root person's data stays in the project's top-level folders (`measurements.yaml`, `layouts/`, `projections/`, `photos/`, `existing/`). A project without `persons:` has exactly this one person, so every existing project, Jan's included, opens without migration, and an older planner still reads the root person's data correctly.
- **Further persons** are entries `{ id, name, body, height_cm?, active? }` and keep the same sub-structure under `persons/<id>/` (`measurements.yaml`, `layouts/`, `projections/`, `photos/`, `existing/`). The id is a slug of the name, unique, never `me`, never a folder that already exists.
- An entry with id `me` only names the root person (default name "Me") and puts it in the list order; its body stays top-level.
- **Shared:** `manifest.yaml`, `images/`, `generated/`, `edits/`, `exports/`. The scan catalogues `persons/<id>/photos/` (arm-photo) and `persons/<id>/existing/` (existing); whose photo an image is follows from its path (`assetOwner`), and the projection wizard lists only the current person's photos.
- Edits keep comments and key order (`src/project/yamlDoc.ts`): a new top-level `active:` goes before `persons:`, a new `persons:` gets a comment, the root's entry is inserted first.

### The current person

- Exactly one person is shown at a time. The server keeps it per project in the user config (`config.json`: `currentPerson: { "<project path>": "<id>" }`); the root person is the default and is not stored. In the sample it is kept in memory, like the sample itself.
- `ProjectStore.paths()` resolves `layoutsDir`, `projectionsDir` and `measurementsFile` for the current person, so `/api/layouts`, `/api/projections` and `/api/project/measurements` need no person parameter. `GET /api/project` reports `persons` and `person`; its `body` and `height_cm` are the current person's, and `PATCH /api/project` writes `body`, `height_cm` and `active` to the current person (`name` stays the project's).
- Switching (`POST /api/project/persons/<id>/select`), adding and removing reload the page, as switching project does: every tab is built from that person's body and files. The page asks first when there are unsaved edits and then reloads without the browser's own leave-page question.

### Adding and removing

- `POST /api/project/persons { name, body, height_cm? }` adds the entry, creates `persons/<id>/{layouts,projections,photos}` and shows the new person. `PATCH /api/project/persons/<id>` renames or changes body/height.
- `DELETE /api/project/persons/<id>` never destroys data: the folder moves to the system trash (macOS `~/.Trash`, freedesktop `~/.local/share/Trash` with a `.trashinfo`), or, when that is impossible (another volume, Windows), to `<project>/.trash/`, which the scans skip. The answer says where it went. The root person cannot be removed (its data is the project itself); it can be renamed.
- The sample shows two persons (Alex, female, root; Sam, male, `persons/sam/`) and allows switching between them; everything else stays read-only.

## Alternatives

- **One project per person** (as ADR 0012 first said). Two folders to open in turn, and the idea library would be duplicated. Rejected by Jan.
- **Every person under `persons/`, including the first** (a migration that moves Jan's top-level folders). Breaks the "open unchanged" rule and older planners. Rejected.
- **A `person` query parameter on every per-person endpoint.** Many call sites, and a tab that forgets it would silently read the root person. The server-side current person keeps the API unchanged.
- **The current person in project.yaml.** Two people sharing a synced project folder would flip each other's view, and the file would change on every switch. Rejected.
- **Deleting a person's folder.** Never: data loss by one click. The trash keeps it restorable.

## Consequences

- Body and measurements stay a load-time value of the page (src/viewer/useArm.ts), so a switch is a reload; unsaved edits are named before it.
- Every new per-person file type must be resolved through `ProjectStore.paths()` and documented here.
