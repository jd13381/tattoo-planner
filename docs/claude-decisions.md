# Decisions made by Claude (for Jan's review)

Jan asked Claude (2026-11-03) to keep building without waiting for answers, decide open points itself and record each decision here. Jan reviews this list; anything he rejects gets reverted or changed. Design decisions (motifs, placement, style) are provisional guesses, never final.

Format: date, phase, the decision, the alternatives, how to change it.

## 2026-11-03

### Measurements

- **Shoulder circumference 40 cm instead of the measured 50 cm** (`config/measurements.yaml`). The 50 cm at 10 cm below the shoulder point was likely taken around the torso (Jan confirmed there is no bulge). 40 cm is slightly above the armpit value (38 cm). _Change:_ measure again and replace the value.

### Phase 4: structure

- **Phase 4 split into three parallel parts** with fixed contracts committed first: asset manifest schema (`src/assets/manifest.ts`), asset endpoints (`src/assets/types.ts`), pattern painter interface (`src/render/patterns/types.ts`).
- **Manifest fields beyond the brief (§12.4):** `version`, `page` and `bbox` (where an ideas.pdf image sits), `crop` (default cut-out). Unknown `kind` strings are allowed so Jan can add his own.

### Phase 4: procedural patterns

- **Pattern names** for `pattern:` in layouts: `snake-scales`, `hatching`, `starfield` (fillers), `meander`, `lotus` / `lotus-frieze` (bands). Unknown names render as a faint diagonal hatch instead of failing.
- **Look:** snake scales about 1.2 cm wide, scattering out into open skin at low density (§4.4); hatching at 45° with cross-hatching above density 0.5; starfield at most about 0.45 marks per cm². Band repeats are stretched slightly so a whole number fits around the arm and meets at the seam. These are sketch placeholders for balance checks, not designs.
- **Filler density default 0.3** when a layout leaves `density` out (same as the editor's default for new fillers).
