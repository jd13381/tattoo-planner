# ADR 0006: Anubis from all photos (photo projection)

- Status: accepted (2026-11-04)
- Context: PROJECT_BRIEF.md §2.1, §10.1 F9; ADR 0002 (unwrap conventions)

## Problem

The existing Anubis (inner left forearm, 26 × 12 cm, lowest point 2 cm above the wrist crease) wraps partly around the arm. Until now the planner cut it out of one photo (`anubis1_nr.JPG`, palm up) as a flat box, so the parts that wrap round were missing or squashed. Jan took three more photos (`anubis_extra1–3.JPG`) with the forearm turned step by step towards the thumb side.

## Decision

**Forward model** (`src/projection/model.ts`). Locally the forearm is the planner's own elliptical cross-section at that height (circumference and aspect from the profile, points by arc length, ADR 0002), seen orthographically (photos from about 1 m). Each photo is calibrated by numbers only:

- `edges`: the forearm's left and right silhouette, each a straight line through two photo points. At every height they fix where the cross-section lies across the photo, so a real arm that is wider than the model (it lies squashed on a table) still maps edge to edge;
- `along`: two photo points at known distances from the wrist crease (the marker line at 0 cm, the ear tips at 28 cm = 2 + 26). Their projection onto the arm axis (the mean direction of the edges) gives the wrist crease and the scale along the arm;
- `u_view`: the u whose surface normal points at the camera, at the wrist and at the elbow, linear in between. The forearm twists when it turns, so one value is not enough (extra3: 0.15 at the wrist, 0.39 at the elbow);
- `turn`: the quarter turn that makes the wrist point down (after the camera's EXIF orientation), and an optional `weight`.

The image's right is Y × N (shoulder up, N the view normal), so seen from the inner side lateral is on the right, as in the unwrap. For a skin point (u, s) the model gives its position across the silhouette (−1 … 1) and the cosine between its normal and the view direction.

**Patch** (`src/projection/patch.ts`). A texture in skin coordinates: columns are u (from `patch.u[1]` on the left to `patch.u[0]` on the right, the unwrap seen from outside), rows are v (shoulder end on top), `px_per_cm` along the arm. For each patch pixel and each photo it projects into the photo (inverse direction, so no holes), samples the brightness, divides it by the photo's local skin brightness (a max filter over `white_radius_cm`, smoothed, on a 4× coarser grid), which evens out exposure between photos and the shading towards the silhouette, and weighs it by `cos^exponent` (zero when facing away). The weighted mean, divided by `skin_level` and clipped, is the patch: 1 = bare skin. Alpha fades out where only grazing views see the skin and at the patch border (`feather_cm`). The **footprint** for blockout and metrics is the ink (darkness minus a floor of 0.22 that hair and pores stay below) smoothed over 1.5 cm, thresholded at `ink_threshold`, specks under 3 cm² dropped and holes filled.

**Built live in the browser**, not by a script. The browser already decodes the photos (EXIF honoured, max 2048 px) for the asset browser; building the patch from them takes about half a second for four photos and is cached per calibration, photo version and arm profile. Nothing is written into the data folder, a saved calibration shows at once, the Projection tab's preview runs the same code, and Jan has no extra command to run.

**Layout**: an `existing` element gets `projection: <name>` (a file in `config/projections/`). When the patch can be built, the element is drawn from it where the photos put it: the reference renderer maps each patch row onto the unwrap row at the same height, stretched over that row's u range (wrapping at the inner seam), multiplied onto the skin; blockout, metrics, the editor and the handout use the footprint (a new `patch` shape). It cannot be moved or scaled in the editor (it is locked anyway). Missing photos are left out with a warning as long as one is there; with no photo at all (no data folder) the element falls back to its old single-photo box, using `asset`, `position`, `size_cm` and `crop` as before.

**Photos are named by their data-folder path** and matched to the manifest entry with that file (case-insensitive), so renaming an asset id does not break the calibration; the asset server still serves only manifest entries.

**Calibration UI** (Projection tab): each photo upright with the model's skin grid projected onto it (inner line red, lateral and medial green, a line every 2 cm along the arm, magenta every 10 cm), draggable edge ends and marks, view-angle sliders, the blend settings, and a live preview of the patch on the unwrap and the 3D arm (built at 10 px/cm while editing). Save writes the YAML through `PUT /api/projections/<name>`, changing only the numbers that differ, so comments survive.

**Fitting**: Claude read the edges and marks off the photos, then optimised `u_view` (wrist, elbow), small shifts of the marks along the arm and of the edges (≤ 0.015 of the photo width) for the three extra photos by maximising the normalised cross-correlation of each photo's patch with the others where they overlap, with `anubis1_nr` held at u_view 0.5 as the reference. The figure's head, ear tips and ribbons then line up across the photos; the ear tips land at 28.6 cm and the lowest ink at about 1.9 cm.

## Alternatives

- **A Node script writing `existing/anubis-unwrap.png` into the data folder** (with a manifest entry): the patch could be opened in other tools, but it would go stale after every calibration change, need an image codec in Node with EXIF handling (mupdf can decode, but EXIF orientation would be on us) and a command Jan must remember. Easy to add later on top of `buildPatch`, which is plain TypeScript.
- **A separate element type** for projected tattoos: cleaner in theory, but every place that handles `existing` (locking, colours, metrics category, handout) would need a second branch. A field keeps v1-baseline's element and its fallback in one place.
- **Feature matching / homographies** between photos: a homography is wrong for a curved surface, and the skin-coordinate model is what the planner needs anyway.
- **Winner-takes-all instead of blending**: sharper, but every seam between photos would be a hard edge; `exponent` slides between the two (higher = closer to winner-takes-all).

## Known limits

- The cross-section is the planner's ellipse; the real forearm lying on a table is flatter and wider. The edges absorb most of it, but points between the centre and the silhouette can be off by a few millimetres, which shows as soft doubling in the cloak where photos overlap.
- No photo shows the medial side well (the forearm was only turned towards the thumb); ink there comes from grazing views and fades out. A photo with the forearm turned the other way (palm towards the body) would fill it in.
- Lighting differs between photos; the local white normalisation removes most of it, but hair on the lateral forearm survives as faint lines, and the footprint is a rough area, not an outline.
- The patch is grayscale; `filter: hatching` applies the line screen, `filter: none` is treated as grayscale.
