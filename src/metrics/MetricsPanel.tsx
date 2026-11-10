import { useState } from "react";
import type { RegionKind } from "../body/profile.ts";
import { ChevronIcon, CoverageIcon } from "../editor/editorIcons.tsx";
import { InfoIcon } from "../ui/icons.tsx";
import {
  CATEGORIES,
  coverageDelta,
  DIFF_THRESHOLD_PCT,
  sharePct,
  ZONES_BY_KIND,
  zoneCoverage,
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
  background: "Bg.",
  band: "Band",
  line: "Line",
  open: "Open",
};

const NOTE: Record<RegionKind, string> = {
  arm: "Share of each zone's skin, counting the topmost element only. Elbow: 4 cm below to 6 cm above the elbow tip; shoulder: the top 8 cm; inner = the half around the palm-side line.",
  leg: "Share of each zone's skin, counting the topmost element only. Knee: 5 cm below to 6 cm above the knee centre; front = the half around the shin line.",
  torso:
    "Share of each zone's skin, counting the topmost element only. Flanks: about 7 cm either side of each flank line; chest and upper back above the lowest ribs.",
};

const WHOLE: Record<RegionKind, string> = { arm: "Whole arm", leg: "Whole leg", torso: "Whole torso" };

/** Column heads of the collapsible float: short words under the swatches. */
const HEADS: Record<Category, string> = {
  figure: "Figure",
  existing: "Tattoo",
  background: "Backg.",
  band: "Band",
  line: "Line",
  open: "Open",
};

const TITLES: Record<Category, string> = {
  figure: "Figures",
  existing: "Existing tattoo",
  background: "Background",
  band: "Bands",
  line: "Lines",
  open: "Open skin",
};

type Props = {
  coverage: Coverage;
  title?: string;
  /**
   * Compare tab: highlight cells that differ from this coverage by at least DIFF_THRESHOLD_PCT. The
   * panel variant explains the tint under the table; with "float" the page shows that legend.
   */
  compareTo?: { coverage: Coverage; label: string };
  /**
   * "float": the compact Pro table for a floating panel over a canvas: swatch-only column heads,
   * numbers without "%", zeros as a dot, and a bar for the open skin.
   */
  variant?: "panel" | "float";
  /**
   * Layout tab (float only): the panel folds into a one-line summary ("19% covered · 81% open") that
   * opens the table again. The page owns and remembers the state.
   */
  collapsible?: { open: boolean; onToggle: () => void };
};

/** Coverage per zone (PROJECT_BRIEF.md §10.1 F7): the share of skin each element type takes. */
export function MetricsPanel({
  coverage,
  title = "Coverage",
  compareTo,
  variant = "panel",
  collapsible,
}: Props) {
  const float = variant === "float";
  const fold = float ? collapsible : undefined;
  const rows: { key: ZoneKey; label: string }[] = [
    ...ZONES_BY_KIND[coverage.kind].map((z) => ({ key: z.id, label: z.label })),
    { key: "total", label: WHOLE[coverage.kind] },
  ];
  const delta = compareTo ? coverageDelta(compareTo.coverage, coverage) : null;
  const [noteOpen, setNoteOpen] = useState(false);
  const note = NOTE[coverage.kind];
  if (fold && !fold.open) {
    const open = sharePct(coverage.total, "open");
    return (
      <button
        type="button"
        className="float cov-pill"
        aria-expanded={false}
        aria-label={`${title}: ${100 - open}% covered, ${open}% open skin. Show the table per zone.`}
        title="Show the coverage per zone"
        onClick={fold.onToggle}
      >
        <CoverageIcon />
        <span className="cov-pill-title">{title}</span>
        <span className="cov-pill-meter" aria-hidden="true">
          <i style={{ width: `${100 - open}%` }} />
        </span>
        <span className="cov-pill-text">
          <b>{100 - open}%</b> covered <span className="cov-pill-dot">·</span> <b>{open}%</b> open
        </span>
        <ChevronIcon dir="up" />
      </button>
    );
  }
  return (
    <section
      className={float ? `float metrics compact${fold ? " cov-table" : ""}` : "panel metrics"}
      aria-label={title}
    >
      <div className={float ? "float-head" : "panel-head"}>
        <h2 className={float ? "float-title" : undefined}>{title}</h2>
        {float && <span className="spacer" />}
        {float && <span className="faint mono">% of zone</span>}
        <button
          type="button"
          className="ghost icon-button"
          aria-label="How coverage is measured"
          aria-expanded={noteOpen}
          title={note}
          onClick={() => setNoteOpen((o) => !o)}
        >
          <InfoIcon />
        </button>
        {fold && (
          <button
            type="button"
            className="ghost icon-button"
            aria-label={`Collapse ${title.toLowerCase()}`}
            aria-expanded
            title="Collapse to a one-line summary"
            onClick={fold.onToggle}
          >
            <ChevronIcon dir="down" />
          </button>
        )}
      </div>
      <table>
        <thead>
          <tr>
            <th>Zone</th>
            {CATEGORIES.map((c) => (
              <th key={c} className={`num cat-${c}`} title={TITLES[c]}>
                {fold ? (
                  <span className="cov-head">{HEADS[c]}</span>
                ) : float && c !== "open" ? (
                  <span className="sr-only">{TITLES[c]}</span>
                ) : (
                  LABELS[c]
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ key, label }) => {
            const zone = key === "total" ? coverage.total : zoneCoverage(coverage, key);
            return (
              <tr key={key} className={key === "total" ? "total" : ""}>
                <td title={label}>{ZONE_SHORT[label] ?? label}</td>
                {CATEGORIES.map((c) => {
                  // This variant minus the other one, in whole percentage points.
                  const d = delta?.[key][c] ?? 0;
                  const marked = Math.abs(d) >= DIFF_THRESHOLD_PCT;
                  const pct = sharePct(zone, c);
                  const diffTitle =
                    compareTo && d !== 0 ? `${d > 0 ? "+" : ""}${d} points vs ${compareTo.label}` : undefined;
                  if (float)
                    return (
                      <td
                        key={c}
                        className={`num${pct === 0 && c !== "open" ? " zero" : ""}${c === "line" ? " line" : ""}${c === "open" ? " open" : ""}${marked ? (d > 0 ? " diff more" : " diff less") : ""}`}
                        title={`${TITLES[c]}: ${pct}%${diffTitle ? ` (${diffTitle})` : ""}`}
                      >
                        {c === "open" ? (
                          <>
                            <span className="share-bar" aria-hidden="true">
                              <i style={{ width: `${pct}%` }} />
                            </span>
                            {pct}
                          </>
                        ) : pct === 0 ? (
                          "·"
                        ) : (
                          pct
                        )}
                      </td>
                    );
                  return (
                    <td
                      key={c}
                      className={`num${marked ? (d > 0 ? " diff more" : " diff less") : ""}`}
                      title={diffTitle}
                    >
                      {pct}%
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      {float && !fold && (
        // The column heads are swatches only (no room for words): one line says which is which.
        <p className="metrics-legend" aria-hidden="true">
          {CATEGORIES.filter((c) => c !== "open").map((c) => (
            <span key={c} className={`cat-${c}`}>
              {TITLES[c]}
            </span>
          ))}
        </p>
      )}
      {noteOpen && <p className="muted small metrics-note">{note}</p>}
      {compareTo && !float && (
        <p className="muted small">
          Tinted: at least {DIFF_THRESHOLD_PCT} points more (red) or less (blue) than {compareTo.label}.
        </p>
      )}
    </section>
  );
}
