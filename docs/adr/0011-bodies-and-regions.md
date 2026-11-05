# ADR 0011: Sample bodies built from lofted regions

- Status: accepted (2026-11-05, decided by Claude under Jan's autonomy rule; see docs/claude-decisions.md)
- Context: docs/product/roadmap.md §4.1 asks for all body parts, a full-body view and a sample body for women and men, with the user's own measurements as an option. Today's arm is a loft of measured elliptical cross-sections with a cm-true "vase" unwrap (ADR 0002).

## Decision

**Every body region is a loft, exactly like today's arm.** A body is a set of regions, each built from a profile (circumference and cross-section aspect along a straight axis, interpolated with the existing monotone cubic) and placed in the body frame by a rigid transform. The whole editor, render, metrics and export pipeline stays per region and unchanged in principle, because it only ever needed a profile: `length`, `circumferenceAt(s)`, `aspectAt(s)`, `maxCircumference`.

Regions for v1:

| id          | from → to (v = 0 → 1)        | u = 0 (texture centre)     | seam (u = 0.5)   |
| ----------- | ---------------------------- | -------------------------- | ---------------- |
| `arm-left`  | wrist crease → shoulder point | outer centre line          | inner centre line |
| `arm-right` | wrist crease → shoulder point | outer centre line          | inner centre line |
| `leg-left`  | ankle → hip crease            | front centre line (shin)   | back centre line (calf) |
| `leg-right` | ankle → hip crease            | front centre line (shin)   | back centre line (calf) |
| `torso`     | waist (navel height) → base of the neck | right flank       | left flank       |

- u keeps its meaning as a fraction of the local circumference; for arms 0.25 stays lateral (thumb side) and 0.75 medial on both sides, so the right arm is the mirror of the left one (geometry mirrored in X, unwrap seen from outside as before).
- On the torso u runs 0 right flank → 0.25 front centre (sternum) → 0.5 left flank (seam) → 0.75 back centre (spine). The seam sits on the left flank so that chest and back pieces both stay whole in the unwrap.
- **Not editable in v1** (drawn in neutral skin, no texture): head, neck, hands, feet, hips/buttocks below the waist line, and the joints between regions (shoulder cap, armpit, groin). Joints are covered by rounded caps that overlap the neighbouring region, as the arm's caps do today. Pieces that cross a region border are out of scope for v1 (roadmap §7, decision 3).
- **Pose:** a relaxed A-pose (arms about 15° away from the body, palms forward), so that the arm keeps today's palm-forward conventions. The elbow bend of ADR 0005 stays for arms; legs get no bend in v1.

**Sample bodies** are two parameter sets, `female` and `male`, in `src/body/samples.ts`: body height, the station circumferences and lengths of every region, region placement (shoulder width, hip width, torso depth). Values are rounded adult averages (roughly 165 cm / 178 cm body height), chosen for plausible proportions, not as anthropometric truth. They are data, not meshes, so there is no licence question and no binary in the repo.

**Own measurements** override sample values per region and per station. Every missing value keeps the sample's value scaled by the ratio of the user's body height to the sample's (when a height is given), so one tape measurement already personalises a region without breaking its proportions. Today's arm placeholders and measurement keys become the `arm-*` station set unchanged, so Jan's `measurements.yaml` maps onto `arm-left` one to one.

**Full-body view** renders every region with its current texture (reference or blockout of the active layout per region), the non-editable parts in neutral skin, front/back/left/right camera presets. Clicking a region opens it in the editor. Selection of single elements stays in the 2D editor (decision of 2026-11-04).

**Layouts are per region:** a layout file gets `region: <id>` (default `arm-left` when missing, so existing files keep working). Variants and the Compare view work within one region.

## Alternatives

- **MakeHuman / MPFB CC0 mesh with a rig and a UV atlas.** Realistic shape and joints, but the UV atlas is not cm-true, every editor and metric would need a distortion map, the mesh has to be shipped as a binary, and own measurements need morph targets. Much more work for a sketch tool; possible later as an alternative geometry source, because the editor only needs a profile per region.
- **Photogrammetry or LiDAR scan import.** Best shape, but needs retopology and auto-UV; not a default for new users. Can come later the same way.
- **One region for the whole torso front and one for the back as separate lofts.** Would duplicate the flank skin; rejected.

## Consequences

- Shoulders, armpits and hips look stylised where regions meet. Acceptable for planning placement and size; it is a sketch tool.
- The `src/arm` modules become `src/body` (profile, geometry, uv, ellipse, interpolate stay framework-free and keep their tests); `arm` keeps working as the first region type.
- Coverage zones become per region (arm: forearm inner/outer, elbow, upper arm inner/outer, shoulder as today; leg: shin, calf, knee, thigh front/back; torso: chest, stomach, back upper/lower, flanks).
