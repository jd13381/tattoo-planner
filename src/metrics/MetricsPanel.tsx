import { CATEGORIES, ZONES, type Category, type Coverage, type ZoneCoverage } from "./coverage.ts";

const ZONE_SHORT: Record<string, string> = {
  "Forearm inner": "Forearm in",
  "Forearm outer": "Forearm out",
  "Upper arm inner": "Upper in",
  "Upper arm outer": "Upper out",
};

const LABELS: Record<Category, string> = {
  figure: "Fig.",
  existing: "Exist.",
  filler: "Fill.",
  band: "Band",
  line: "Line",
  open: "Open",
};

const TITLES: Record<Category, string> = {
  figure: "Figures",
  existing: "Existing tattoo",
  filler: "Fillers",
  band: "Bands",
  line: "Lines",
  open: "Open skin",
};

const pct = (z: ZoneCoverage, c: Category) => (z.area > 0 ? Math.round((100 * z.byCategory[c]) / z.area) : 0);

/** Coverage per zone (PROJECT_BRIEF.md §10.1 F7): the share of skin each element type takes. */
export function MetricsPanel({ coverage }: { coverage: Coverage }) {
  const rows = [
    ...ZONES.map((z) => ({ label: z.label, zone: coverage.zones[z.id] })),
    { label: "Whole arm", zone: coverage.total },
  ];
  return (
    <section className="panel metrics" aria-label="Coverage">
      <h2>Coverage</h2>
      <table>
        <thead>
          <tr>
            <th>Zone</th>
            {CATEGORIES.map((c) => (
              <th key={c} className={`num cat-${c}`} title={TITLES[c]}>
                {LABELS[c]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ label, zone }) => (
            <tr key={label} className={label === "Whole arm" ? "total" : ""}>
              <td title={label}>{ZONE_SHORT[label] ?? label}</td>
              {CATEGORIES.map((c) => (
                <td key={c} className="num">
                  {pct(zone, c)}%
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">
        Share of each zone's skin, topmost element counted. Elbow: 4 cm below to 6 cm above the elbow tip;
        shoulder: top 8 cm; inner = the half around the palm-side line.
      </p>
    </section>
  );
}
