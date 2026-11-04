import { useState } from "react";
import { InfoIcon } from "../ui/icons.tsx";
import {
  CATEGORIES,
  coverageDelta,
  DIFF_THRESHOLD_PCT,
  sharePct,
  ZONES,
  type Category,
  type Coverage,
  type ZoneKey,
} from "./coverage.ts";

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

const NOTE =
  "Share of each zone's skin, counting the topmost element only. Elbow: 4 cm below to 6 cm above the elbow tip; shoulder: the top 8 cm; inner = the half around the palm-side line.";

const TITLES: Record<Category, string> = {
  figure: "Figures",
  existing: "Existing tattoo",
  filler: "Fillers",
  band: "Bands",
  line: "Lines",
  open: "Open skin",
};

type Props = {
  coverage: Coverage;
  title?: string;
  /** Compare tab: highlight cells that differ from this coverage by at least DIFF_THRESHOLD_PCT. */
  compareTo?: { coverage: Coverage; label: string };
};

/** Coverage per zone (PROJECT_BRIEF.md §10.1 F7): the share of skin each element type takes. */
export function MetricsPanel({ coverage, title = "Coverage", compareTo }: Props) {
  const rows: { key: ZoneKey; label: string }[] = [
    ...ZONES.map((z) => ({ key: z.id, label: z.label })),
    { key: "total", label: "Whole arm" },
  ];
  const delta = compareTo ? coverageDelta(compareTo.coverage, coverage) : null;
  const [noteOpen, setNoteOpen] = useState(false);
  return (
    <section className="panel metrics" aria-label={title}>
      <div className="panel-head">
        <h2>{title}</h2>
        <button
          type="button"
          className="ghost icon-button"
          aria-label="How coverage is measured"
          aria-expanded={noteOpen}
          title={NOTE}
          onClick={() => setNoteOpen((o) => !o)}
        >
          <InfoIcon />
        </button>
      </div>
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
          {rows.map(({ key, label }) => {
            const zone = key === "total" ? coverage.total : coverage.zones[key];
            return (
              <tr key={key} className={key === "total" ? "total" : ""}>
                <td title={label}>{ZONE_SHORT[label] ?? label}</td>
                {CATEGORIES.map((c) => {
                  // This variant minus the other one, in whole percentage points.
                  const d = delta?.[key][c] ?? 0;
                  const marked = Math.abs(d) >= DIFF_THRESHOLD_PCT;
                  return (
                    <td
                      key={c}
                      className={`num${marked ? (d > 0 ? " diff more" : " diff less") : ""}`}
                      title={
                        compareTo && d !== 0
                          ? `${d > 0 ? "+" : ""}${d} points vs ${compareTo.label}`
                          : undefined
                      }
                    >
                      {sharePct(zone, c)}%
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      {noteOpen && <p className="muted small">{NOTE}</p>}
      {compareTo && (
        <p className="muted small">
          Tinted: at least {DIFF_THRESHOLD_PCT} points more (red) or less (blue) than {compareTo.label}.
        </p>
      )}
    </section>
  );
}
