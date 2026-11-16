# Jan's sleeve

Notes for the planner's first user: the left-arm sleeve described in `docs/history/project-brief.md`. Setup: [development.md](development.md).

## Moving the data folder

Jan's move, once: `npm run migrate -- "~/Your Secure Cloud/<library>/tattoo-planner-data"` (or the button), then check Settings → Project.

## Asset ids of `v1-baseline`

`v1-baseline.yaml` uses these asset ids: `anubis-photo` (must point at `arm-photos/anubis1_nr.JPG`, because the layout's crop is fitted to that photo), `rhonas-card` (the Rhonas card image from ideas.pdf; the layout's crop is fitted to the full card), `medusa-ref-01`, `skull-ref-01` and `pegasus-ref-01`. An id that is not in the manifest renders as a placeholder. The entry for the Anubis photo:

```yaml
- id: anubis-photo
  file: arm-photos/anubis1_nr.JPG
  kind: existing
  tags: [anubis, existing]
```

## Anubis from all photos (Settings → Projection → Advanced)

The Anubis wraps partly round the forearm, so one photo cannot show all of it. `config/projections/anubis.yaml` says, for each photo, where the forearm's outline is, where the wrist crease and the top of the tattoo are, and which side of the arm faces the camera (numbers only; the photos stay in the data folder). The planner projects every photo onto the arm's skin coordinates and blends them, the most frontal photo counting most, into one patch that the Layout, Compare and Export use for every element with `projection: anubis` (v1-baseline's `anubis`). The patch is built in the browser when the page loads (about half a second); nothing is written into the data folder.

The **Advanced** page shows each photo upright with the model's skin grid on it: red = inner centre line, green = lateral and medial lines, yellow lines every 2 cm along the arm, magenta every 10 cm from the wrist crease. Drag the orange edge ends onto the forearm's outline and the red marks onto points whose distance from the wrist crease you know (**Mark 1/2 (cm)** in "This photo"), and move the **View at wrist/elbow** sliders (the u facing the camera) until the grid sits on the arm the way the tattoo does. The middle column shows the arm and, below it, the combined patch (centred on the patch); the percentage on each photo's tab (and in **Share of the patch**) is the share of the patch it supplies. **Save** writes the YAML, keeping its comments. The fit Claude made is a starting point: if the head or the ribbons look doubled, nudge the photo whose copy is off.

Requirements: the five photos in `arm-photos/` with entries in `manifest.yaml` (`npm run assets:scan` adds them; the entry is found by file path, its id does not matter). Missing photos are left out with a warning; without any photo (or without a data folder) the planner shows the old single-photo box (`asset`, `crop`, `position`, `size_cm` of the element). Design and limits: `docs/adr/0006-anubis-projection.md`.

**On your Mac** after pulling this change: nothing new to install. Run `npm run assets:scan` once if `manifest.yaml` has no entries for `arm-photos/anubis_extra1.JPG`–`anubis_extra3.JPG` or `anubis_extra4.png` yet, then `npm run dev` and open Settings → Projection → Advanced (anubis).
