# ADR 0022: Smooth body surface between stations and regions

- Status: accepted (2026-11-06, decided by Claude on Jan's request: "Die Übergänge der Messpunkte sollten fließender sein. Ich habe nicht so eine Kante im Bauch.")
- Context: the full-body view showed a horizontal crease at waist height. The circumference and aspect curves (ADR 0002, 0011) were already a Fritsch–Carlson monotone cubic, so C1 inside every region; the crease came from the join: the torso ended at the waist line in a rounded cap, and the hips were an ellipsoid narrower than the torso there, so the two surfaces met in a groove. The neck was an ellipsoid on the torso's top cap in the same way. Two real slope steps did sit in the curves: after the last station of the arm (shoulder tape, 4–10 cm below the shoulder point) and the leg (thigh top) the value stayed constant, while the curve arrived there still rising. Under grazing light, curvature steps at stations also showed as soft bands.

## Decision

- **Interpolation: a monotone C2 spline.** `monotoneCubic` (`src/body/interpolate.ts`) solves a cubic spline for the slopes, applies Hyman's monotonicity filter (slope 0 at a station that is a local maximum or minimum, at most three times the neighbouring secants), holds every limited slope and solves again until nothing needs limiting. It passes through every station, never overshoots between two neighbouring stations, is C1 everywhere and C2 at every station the filter leaves alone. The ends take the slope of their first stretch, as Fritsch–Carlson did, so a region's ends keep their shape.
- **Flat into a constant stretch.** When a loft continues past its last (or before its first) knot, the curve arrives there with slope 0 (`curve` in `src/body/profile.ts`), so the constant stretch beyond starts without a kink.
- **The torso runs on into a neutral pelvis and neck.** With the body parameters (`buildRegionProfile(id, inputs, params)`), the torso's curves get knots beyond its ends: the hips' widest section (perimeter of `hip_width` × `hip_depth`, at 55 % of `pelvis_height` below the waist), the bottom of the pelvis (80 % of that, 15 % of the pelvis height below the hip crease), and the top of the neck (90 % of `neck_base`, `neck_height` + 2 cm above the neck base). The torso region itself still spans waist to neck base and keeps every station value; only its slopes at the two ends follow from the outside knots. The pelvis and neck lofts are built from the same knots shifted into their own frame, so they share the torso's section and slope where they meet it (`TorsoProfile.pelvis`, `.neck`; `BodyLayout.lofts`). They replace the `hips` and `neck` ellipsoids and render in neutral skin (`src/viewer/NeutralBody.tsx`, used by the full-body view and Home).
- **`maxCircumference`** is now the largest knot value inside the region (exact, since the curve never overshoots), instead of the largest of 201 samples.

## Consequences

- Station values, region lengths, the unwrap width and the cm-true unwrap are unchanged: every renderer, the editor, metrics and export read the same `circumferenceAt`. Between stations the circumference moves by up to about 0.9 cm on Jan's measured left arm (largest on the forearm between wrist and forearm_mid), so a layout point at u = 0.25 moves sideways by at most about 2 mm; the arm's shoulder tape and the leg's thigh top now flatten out instead of ending in a kink.
- The torso's top (shoulder line to neck base) and bottom slopes change with the neck and pelvis knots; without body parameters (`buildTorsoProfile(m)`) it falls back to the region alone and the layout to the old ellipsoids.
- Left as they are: the shoulder joint ellipsoids, the hands and feet, and the joins of the legs into the pelvis (cheap improvements did not apply: arms and legs meet their neighbours at an angle, not end on end). Curvature can still step at a station where the filter must hold the slope (a measured maximum such as the chest, or a stretch much steeper than its neighbour); the slope itself never steps.

## Alternatives

- Catmull-Rom or a plain cubic spline: C1 or C2, but they overshoot between stations (a bulge nobody measured).
- Fritsch–Carlson with better tangents only: C1, curvature still steps at every station.
- Extending the torso region itself below the waist: changes the region's length and every torso layout's v.
- Reshaping the hip ellipsoid to fit the torso: an ellipsoid cannot match both the torso's section and its slope at the waist.
