# ADR 0024: Projection workspace instead of the step wizard

- Status: accepted (2026-11-09, from the approved projection redesign spec; details decided by Claude, see docs/claude-decisions.md, "Projection workspace (2026-11-09)")
- Context: ADR 0014 (guided projection; this ADR replaces its step model), ADR 0023 (ink only, eraser, edited photos, "Where was the camera?"), ADR 0020 (persons; studio edits inherit their original's person)

## Problem

The guided setup asked one thing per step: Turn, Outline, Distances and Side per photo, then Clean up, then Check and save. With five photos that is twenty-odd screens, a wrong answer only shows on the 3D body at the very end, going back means clicking through the rail, and the area the patch covers was a separate toggle ("fit to the photos") that went stale when a photo was added. An edit from the Image studio had to be chosen in a second place after the photo itself.

## Decision

**One workspace per tattoo**, opened from the list (Add existing tattoo, Edit):

- **Setup sheet** first: name, body part, photos. The picker lists the current person's tattoo and measuring photos with their edits stacked on them (`projectionPhotoGroups` in `src/assets/projectionPhotos.ts`), each version a button ("Photo", "Edit 1", …). Picking an edit stores the photo as the frame and the edit as the picture: `file: <photo>`, `cleaned: <edit>` (`photoFields`). The points always stay in the photo's frame.
- **Filmstrip** on the left (one thumbnail per photo with a status dot, remove, add), **canvas** in the middle with four tools (Outline 1, Distances 2, Camera 3, Clean up 4), **live 3D over the unwrap** next to it, and an **inspector** on the right with the photo's checklist (outline, two distances, camera side, clean up), the tool's panel and the area.
- **Live preview**: every photo whose outline and distances are done goes into the patch (a 150 ms debounce, 10 px/cm), so a wrong point shows at once on the 3D body and on the unwrap.
- **Save bar**: Save (⌘S), a popover with the target layout and a to-do list of what is still open (errors block, notices do not), Cancel. One undo history (⌘Z, ⌘⇧Z / ⌘Y) covers every change in the workspace, a drag is one step, Esc during a drag cancels it.

**The covered area is automatic** (`autoArea`): the span of all photos' outlines along the body part plus 1 cm, and round it the arc the photos' facings cover. A saved file keeps its `area` as before; opening it, the area is **held** if it still contains every photo, else it switches to automatic with a note (one undo step, so it can be taken back). "Fit to photos" / "Hold area" in the inspector replace the old toggle. The YAML is unchanged: `area` is written as before.

**Direct correction on the unwrap**: dragging the current photo's picture sideways turns it round the body part (`u_view`), up and down moves its distance marks, the top and bottom handles stretch it (the two marks apart); arrow keys nudge (0.1 cm, Shift 1 cm). Other photos are shown as faint outlines (**Ghosts**, G).

**Helpers on the canvas**: landmark chips in the Distances panel (wrist crease, elbow tip …, from the person's measurements, sample values in italic) set the active mark's cm; a cm ruler along the outline; handles are focusable and move with the arrow keys.

**Clean up on the canvas**: the eraser takes the whole canvas with "Ink only | Photo" (Space held compares), right or middle button pans. The picture used for the photo (the photo itself or one of its edits) is a select in the inspector; an edit of another shape gets `cleaned_fit` plus a new optional **`cleaned_offset: { x, y }`** (fractions of the turned photo, −0.5…0.5) to nudge it into place, checked with "Both" on the canvas.

Logic lives in framework-free modules with tests: `draft.ts` (draft ↔ calibration), `area.ts`, `checks.ts`, `history.ts`, `landmarks.ts`, `unwrapDrag.ts`, `ruler.ts`, `photoVersions.ts`. The wizard (`ProjectionWizard.tsx`, `wizardArt.tsx`, the step model in `wizard.ts`) is gone; Advanced is unchanged.

## Consequences

- A projection file written by the wizard opens unchanged; saving it without edits writes the same YAML (new keys only when used: `cleaned_offset`).
- The 3D view and unwrap run while editing, which costs a patch build per change; the debounce and the low preview resolution keep it interactive for five photos.
- The camera side has no "unset" state in the file; a new photo counts it as open until it is chosen (`facingSet`, draft only).
- Not checked in the cloud: Jan's real photos, a GPT edit with `cleaned_offset`, the desktop app.
