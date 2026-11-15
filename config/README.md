# config/

The original data of the first sleeve the planner was built for (`PROJECT_BRIEF.md`), from before projects had their own folder (docs/adr/0012-project-folder.md). It is kept as an example and because tests read it:

- `measurements.yaml`: the measurements of one left arm, in cm.
- `layouts/v1-baseline.yaml`: the first layout, in the old form with a `filler` element; tests read it.
- `projections/anubis.yaml`: the calibration of an existing tattoo projected from photos (docs/adr/0006); numbers only, the photos were never in the repository.

New projects keep these files in their own project folder. An older data folder that has not been moved into a project yet still reads and writes this `config/`; `npm run migrate` moves it.
