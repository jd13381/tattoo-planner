# ADR 0029: The author's Anubis tattoo in the sample project

- Status: accepted (2026-11-16, Jan: "das foto kann auch im repo landen, das ist mir egal. hätte sogar etwas nett persönliches")
- Context: the sample project (ADR 0012, ADR 0017) shipped no image file; its motifs are drawn at runtime. So it had no existing tattoo, and the README screenshot of the existing-tattoos feature showed an empty page. Jan wanted the README to show his own Anubis tattoo, projected onto a male body, and is fine with its photos being public.

## Decision

- **Sam, the sample's male person, has the Anubis as an existing tattoo.** `samples/demo/persons/sam/projections/anubis.yaml` is the calibration fitted on Jan's arm (five photos), with each photo's points moved into the cropped photo; both of Sam's left-arm variants hold it as a locked `existing` element. Sam's left arm has Jan's measurements (`persons/sam/measurements.yaml`, forearm 30 cm): on the sample body's shorter forearm the head, 28 cm above the wrist, ran over the elbow and was cut off. Its area is widened to `v: [0, 0.65]` so the workspace does not report that it cuts off what the photos show.
- **Five photos, cropped to the forearm.** `samples/demo/photos/anubis-1.jpg` … `anubis-5.jpg`: Jan's five Anubis photos, turned upright and cropped to the forearm (no table, packages or torso), at most 1600 px on the long side, JPEG. Listed in the sample's manifest as `existing` images.
- **A third image exception in git**, next to ADR 0019 and ADR 0026: the pre-commit guard and `.gitignore` allow `samples/demo/photos/*.jpg`, directly in that folder, at most 500 KB each. The desktop app ships them (`desktop/electron-builder.config.mjs`).
- **The server serves and copies them as they are**: `GET /api/assets/image/<id>` in the sample falls back from the drawn placeholder to the real file, and "Save as new project" copies them with the placeholders.
- **README screenshots** (ADR 0026) show Sam on Home as the hero (only the 3D stage, turned so the inner left forearm faces the camera) and Sam's Anubis in the projection workspace.

## Consequences

- These are the only real photos in the repository and in the app. Nothing else from Jan's data folder goes into git; the rule in CLAUDE.md stands.
- The photos are public with the repository and its history. Removing them later needs a history rewrite to be complete.
