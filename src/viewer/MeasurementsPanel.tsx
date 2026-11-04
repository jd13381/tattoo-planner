import { INPUT_GROUPS, PLACEHOLDERS, type ArmInputKey } from "../arm/inputs.ts";

type Props = {
  /** Values from measurements.yaml (null = not measured). */
  fileValues: Record<ArmInputKey, number | null>;
  /** Values typed into the panel; they win over the file until reset. */
  overrides: Partial<Record<ArmInputKey, number>>;
  onChange: (key: ArmInputKey, value: number | undefined) => void;
  onReset: () => void;
  warnings: string[];
};

const LABELS: Record<ArmInputKey, string> = {
  shoulder_to_elbow: "Shoulder → elbow",
  elbow_to_wrist: "Elbow → wrist",
  wrist: "Wrist",
  forearm_mid: "Forearm mid",
  forearm_max: "Forearm max",
  elbow: "Elbow",
  above_elbow: "Above elbow (+5 cm)",
  biceps_mid: "Biceps mid",
  armpit_level: "Armpit level",
  shoulder: "Shoulder",
  forearm_max_below_elbow: "Forearm max, below elbow",
  armpit_level_below_shoulder: "Armpit level, below shoulder",
  shoulder_below_shoulder: "Shoulder tape, below shoulder",
};

export function MeasurementsPanel({ fileValues, overrides, onChange, onReset, warnings }: Props) {
  const hasOverrides = Object.keys(overrides).length > 0;
  return (
    <aside className="panel" aria-label="Measurements">
      <div className="panel-head">
        <h2>Measurements (cm)</h2>
        <button type="button" className="ghost" onClick={onReset} disabled={!hasOverrides}>
          Reset
        </button>
      </div>
      <p className="muted small">
        From <code>config/measurements.yaml</code>. Edits here are a preview only; write final numbers into
        the file.
      </p>
      {warnings.map((w) => (
        <p key={w} className="warn small">
          {w}
        </p>
      ))}
      {INPUT_GROUPS.map((group) => (
        <fieldset key={group.title}>
          <legend>{group.title}</legend>
          {group.keys.map((key) => {
            const override = overrides[key];
            const file = fileValues[key];
            const source = override !== undefined ? "edited" : file !== null ? "file" : "placeholder";
            const value = override ?? file ?? PLACEHOLDERS[key];
            return (
              <label key={key} className={`field ${source}`}>
                <span>{LABELS[key]}</span>
                <input
                  type="number"
                  min={0}
                  step={0.5}
                  value={value}
                  onChange={(e) => {
                    const n = e.target.valueAsNumber;
                    onChange(key, Number.isFinite(n) && n > 0 ? n : undefined);
                  }}
                />
                <span className="tag">{source}</span>
              </label>
            );
          })}
        </fieldset>
      ))}
    </aside>
  );
}
