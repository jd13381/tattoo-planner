# ADR 0014: Guided projection of existing tattoos

- Status: accepted (2026-11-05, decided by Claude under Jan's autonomy rule; see docs/claude-decisions.md)
- Context: docs/product/roadmap.md P6 and Phase C step 5; ADR 0006 (the forward model and calibration, built for the Anubis on the left forearm); ADR 0011 (body regions)

## Problem

ADR 0006 projects several photos of an existing tattoo onto the arm's skin, but the calibration is a page of numbers (edges, along marks, `u_view` at wrist and elbow, turn, weight, patch ranges, blend settings) tuned by hand for one tattoo on one region. A new user with a few phone photos cannot be expected to know what `u_view: { wrist: 0.29, elbow: 0.485 }` means, and a tattoo on a leg or the back had no model at all.

## Decision

**The forward model works on every region.** It only ever needed the region's profile: the cross-section at each height and the direction u turns. `sectionView` takes the region's u = 0 angle and `mirrored` flag (the same convention as the mesh, `ringAngles` in `src/body/geometry.ts`); image right stays the physical Y × N, so on a mirrored region the photo shows u growing to the right, as its unwrap does. `u_view` is interpolated from the region's start to its **twist reference** (`twistReach`: elbow tip on arms, knee on legs, the neck on the torso, which has no joint in between) and constant beyond. The patch keeps its column order (u1 on the left); the renderer mirrors it on mirrored regions. A projection file gets an optional `region:` (default `arm-left`, so `anubis.yaml` is unchanged); the YAML keys keep the arm's names (`u_view.wrist` / `elbow`, "cm from the wrist crease"), read as "the region's start" and "its twist reference" elsewhere. Left-arm patches are bit-for-bit what they were (checked on the Anubis calibration with synthetic photos), and every existing test is unchanged.

**A guided wizard is the default entry** of Settings → Projection: a list of the existing tattoos (first photo, body part, state, layouts that show it) with **Add existing tattoo**, **Edit** (the wizard prefilled from the file) and **Advanced** (the former calibration page, for fine-tuning). The wizard asks one thing per step, each with a sentence, a small schematic and a "Next" that says why it is disabled:

1. Name (free text; the file name is its slug) and body part (all five regions).
2. Photos: the catalogued images, kinds `existing` / `arm-photo` first; **Look for new images** catalogues files added to the project folder.
3. Per photo, four steps: **Turn** (click the one of four turned thumbnails in which the start of the body part is at the bottom: the model needs it), **Outline** (drag four dots onto the two silhouette edges), **Distances** (drag two points onto spots at known distances from the start line and type the cm), **Side** (click one of eight drawings of a slice through the limb with the camera below, drawn with the model's own maths, plus a fine-tune slider; "the limb is twisted" reveals a second choice for the far end). From the Distances step on, the model's skin grid lies on the photo, so a wrong answer shows at once.
4. Check and save: the patch (built live, as in ADR 0006) on the 3D region and the unwrap; save writes the projection through the existing `PUT /api/projections/<name>` and links it into a layout of that region.

Turn comes first, not last: every point is placed in the turned photo, so turning after placing points would move them. Turning moves points the user has placed with the picture and leaves untouched starting points where they are on screen.

**Derived, not asked:** the patch area (`fitArea`: a quarter turn either side of every facing direction, the shortest arc covering them; along the region from 1 cm below the lowest mark to 2 cm above the highest), the blend settings and the resolution (defaults for a new tattoo, kept from the file when editing). Editing keeps the saved area unless "Fit the covered area to the photos" is switched on, so numbers tuned in Advanced survive the wizard; opening Jan's Anubis in the wizard and saving reproduces the calibration exactly (a test).

**Where it shows:** the layout is one of the region's layouts that already shows the projection, else the one open in the Layout tab, else the region's first, else a new `<region>-1`; the user can pick another of the region's layouts. A missing element is added as a locked `existing` element with `projection:`, positioned at the patch middle (the box only shows while the photos cannot be read). A layout with unsaved edits in the Layout tab is not written; the message says so. Layout lists pick up layouts saved elsewhere through a window event, and an open layout without unsaved edits reloads.

All rules live in framework-free modules with unit tests (`src/projection/wizard.ts`, `layoutLink.ts`); the React files only draw.

## Alternatives

- **Automatic edge and landmark detection** (segmentation of the limb, a pose model for the wrist): fewer clicks, but a model download, unreliable on tattooed skin and on cut-off photos, and a wrong guess is harder to fix than a drag. The steps can later start from a detected guess.
- **Optimising `u_view` and the marks across photos** (the cross-correlation fit Claude ran by hand for the Anubis, ADR 0006): needs overlapping photos and minutes of compute; worth adding as a "Refine" button once real users have several photos.
- **Asking for the patch area**: precise, but a concept users do not have; the derived area plus Advanced covers it.
- **A separate wizard file format**: two formats for one thing; the wizard writes the ADR 0006 file, so Advanced and hand edits keep working.

## Limits

- The cross-section is the planner's ellipse; on the torso (much flatter, and with breasts, shoulder blades) the edges absorb less, and a photo of the back taken at an angle maps worse than one of a limb.
- The schematic orientations assume the camera roughly at the height of the tattoo and about a metre away (as ADR 0006).
- Pieces across a region border are out of scope, as in ADR 0011.
