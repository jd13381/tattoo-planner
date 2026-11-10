// The standard backgrounds shipped with the planner (assets/backgrounds/, docs/adr/0019), shown in
// Assets → Backgrounds next to the project's own backgrounds. They live in the repo, not in the data
// folder, so they are read-only here; they are used through Layout → Layers → + Background.
import { STANDARD_BACKGROUNDS } from "./useStandardBackgrounds.ts";

export function BuiltInBackgrounds() {
  const withImage = STANDARD_BACKGROUNDS.filter((s) => s.imageUrl).length;
  return (
    <section className="builtin-backgrounds" aria-labelledby="builtin-backgrounds-title">
      <div className="builtin-backgrounds-head">
        <h3 id="builtin-backgrounds-title">Built in</h3>
        <span className="assets-toolbar-count">{STANDARD_BACKGROUNDS.length}</span>
      </div>
      <p className="faint small">
        Backgrounds that come with the planner. Add one to a layout in Layout → Layers → + Background.
        {withImage < STANDARD_BACKGROUNDS.length &&
          " Those without an image are drawn by the planner as a pattern."}
      </p>
      <ul className="assets-grid builtin-backgrounds-grid">
        {STANDARD_BACKGROUNDS.map((s) => (
          <li key={s.name} title={`${s.label}, tile ${s.tileCm} cm`}>
            <span className="assets-well">
              {s.imageUrl ? (
                <img src={s.imageUrl} alt="" loading="lazy" />
              ) : (
                <span className="builtin-backgrounds-none">Pattern</span>
              )}
            </span>
            <span className="assets-caption">
              <span className="assets-name">{s.label}</span>
              <span className="assets-usage">{s.tileCm} cm</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
