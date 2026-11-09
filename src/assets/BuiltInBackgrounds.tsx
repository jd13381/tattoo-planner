// The standard backgrounds shipped with the planner (assets/backgrounds/, docs/adr/0019), shown in
// Assets → Backgrounds next to the project's own backgrounds. They live in the repo, not in the data
// folder, so they are read-only here; they are used through Layout → Layers → + Background.
import { STANDARD_BACKGROUNDS } from "./useStandardBackgrounds.ts";

export function BuiltInBackgrounds() {
  const withImage = STANDARD_BACKGROUNDS.filter((s) => s.imageUrl).length;
  return (
    <section className="builtin-backgrounds" aria-label="Built-in backgrounds">
      <h3 className="assets-nav-head">Built in</h3>
      <p className="faint small">
        Standard backgrounds that come with the planner ({withImage} of {STANDARD_BACKGROUNDS.length} with a
        generated image). Add one to a layout in Layout → Layers → + Background.
        {withImage === 0 && " Without an image the planner draws a procedural version."}
      </p>
      <ul className="builtin-backgrounds-grid">
        {STANDARD_BACKGROUNDS.map((s) => (
          <li key={s.name} title={`${s.label}, tile ${s.tileCm} cm`}>
            {s.imageUrl ? (
              <img src={s.imageUrl} alt={s.label} loading="lazy" />
            ) : (
              <span className="builtin-backgrounds-none faint small">procedural</span>
            )}
            <span className="small">{s.label}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
