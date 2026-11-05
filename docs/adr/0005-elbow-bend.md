# ADR 0005: Elbow-bent pose

- Status: proposed (2026-11-03)
- Context: PROJECT_BRIEF.md §10.1 F2 ("plus elbow-bent view if feasible"), §14 Phase 6, ADR 0002 (straight arm, known limits)

## Decision

**Only vertices move.** The bend is a pure function on the straight mesh (`src/body/bend.ts`, unit-tested in `tests/bend.test.ts`): positions and normals change, UVs and triangles are shared with the straight mesh. The unwrap, the editor, the metrics and every texture stay exactly as they are; the texture simply bends with the skin. Raycasts (the brush tool) hit the bent mesh and still read the same UVs.

**Pose.** The upper arm stays in place; the forearm swings towards the palm side (+Z) about an axis parallel to X (lateral–medial), as in flexing the elbow from the palm-forward pose. The flexion angle runs from 0° (straight) to 120° in the UI (`MAX_FLEXION_DEG`); a fully bent elbow reaches about 140–150°, where the forearm and upper arm flesh press together, which this model cannot show.

**Bending zone.** The bend is spread over ±6 cm around the elbow tip (`zoneHalfCm`). Inside the zone a neutral line curves with a raised-cosine curvature κ(s) = θ · (1 + cos(π(s − e)/h)) / 2h: zero at the zone edges (no kink where the bend starts), largest at the elbow tip, integrating to the flexion angle θ. Above the zone nothing moves; below it the forearm turns rigidly by θ.

**Neutral line close to the outer skin.** The neutral line lies at 20 % of the elbow's depth from the outer (back) skin (`neutralDepth`), roughly where the joint axis sits behind the crease. Each vertex keeps its signed distance d from the neutral line, measured along the line's normal; its position along the line is unchanged. Hence:

- **Outer side:** skin stretches by θ × d over the zone: about 1.3 cm at 45°, 2.7 cm at 90° and 3.6 cm at 120° on the outer centre line (placeholder arm), within 6 % of the whole line's length. A tattoo on the back of the elbow gets slightly longer, as real skin over the olecranon does.
- **Inner side (crease):** skin compresses by 1 − d·κ, which would turn negative (the surface folding through itself) at strong curvature. Instead the distance is limited smoothly: d′ = f(d·κ)/κ with f(x) = x / (1 + x⁴)^¼, which is d for gentle bends and never reaches the centre of curvature. The skin is pulled into a crease and is never turned inside out.
- **Normals** turn with the cross-section (rotation by the local angle φ(s)). In the crease they ignore the compression, which only affects shading there.

## Alternatives

- **Rotation about one fixed joint axis** (rigid skinning, no zone): a sharp kink at the elbow and a gap or overlap on both sides.
- **Linear blend skinning with two bones:** the classic "candy wrapper" collapse at strong angles; needs weights tuned per vertex.
- **Neutral line in the middle of the arm:** the outer skin would stretch about 2.5 times as much (≈ 6.5 cm at 90°), which overstates how a tattoo on the elbow distorts.
- **A physical skin simulation:** far beyond a sketch tool.

## Known limits

- At large angles (beyond ~100°) the inner flesh of forearm and upper arm overlap in the crease instead of pressing against each other; the crease area is not meaningful there. The outer side and the elbow tip, which matter for the skull, stay clean.
- No forearm rotation (pronation), no carrying angle, no muscle bulge when flexing.
- The cross-section keeps its width (X) in the crease; only the depth shrinks.
- The export (PDF and PNGs) still shows the straight arm only. A bent view in the handout is a follow-up: `renderArmViews` would need a pose parameter and the handout one more page.
