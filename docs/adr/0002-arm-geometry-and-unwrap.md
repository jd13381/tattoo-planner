# ADR 0002: Arm geometry and unwrap

- Status: accepted (2026-11-03)
- Context: PROJECT_BRIEF.md §11.2, §13, §14 Phase 2

## Decision

**Profile.** The arm is a loft of elliptical cross-sections along a straight axis from the wrist crease (s = 0) to the shoulder point (s = length = elbow→wrist + shoulder→elbow). Each circumference from `measurements.yaml` is a station at a known s: fixed landmarks for wrist, forearm mid, elbow, 5 cm above the elbow and biceps mid; measured distances (`positions` block) for forearm max, armpit level and the shoulder tape. Between stations the circumference follows a monotone cubic spline (Fritsch–Carlson), so the arm never bulges where nobody measured a bulge. Overlapping positions are sorted and reported in the UI instead of folding the mesh.

**Cross-sections.** Ellipses sized so their perimeter equals the measured circumference. The aspect ratio (width across / depth) is an anatomical assumption, not a measurement: 1.4 at the wrist, 1.2 mid forearm, 1.08 at the elbow, 1.0 at the shoulder. Vertices are placed by arc length, so equal steps around the ring are equal cm of skin.

**Axes and sides** (palm-forward pose, units cm): +Y wrist → shoulder; +Z inner (palm side), −Z outer (back), +X lateral (thumb side), −X medial (towards the body). The four fixed views look from these sides.

**Layout coordinates** (§13.2): `u` is the fraction of the local circumference from the outer centre line (0 outer, 0.25 lateral, 0.5 inner, 0.75 medial); `v` = s / length.

**Unwrap ("vase").** Each texture row is as wide as the local circumference in cm, centred on the outer centre line and scaled to the widest circumference. The seam lies on the inner centre line (the texture edges), as §11.2 asks. The unwrap is seen from outside the arm: lateral on the left, medial on the right, shoulder at the top. 1 cm of texture is 1 cm of skin in both directions, so a cm grid stays even on the 3D arm and the editor can show real sizes.

## Alternatives

- **Rectangular UV (u × v):** simpler, but the wrist (≈17 cm) and shoulder (≈38 cm) would get the same texture width, stretching anything near the wrist by about 2×. Fails the Phase 2 acceptance criterion (even cm grid).
- **Seam on the outer line:** would cut Rhonas (u = 0) in half in the editor.

## Known limits

- The axis is straight: no carrying angle, no forearm twist, no bent elbow (Phase 6).
- Lengths along the arm are axial; on the steep flank between forearm and elbow the skin is up to ~1 % longer than the grid says.
- Wrist and shoulder ends are closed with untextured rounded caps; there is no hand or shoulder joint.
