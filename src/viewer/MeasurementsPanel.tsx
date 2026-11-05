import { useEffect, useState, type ReactNode } from "react";
import { INPUT_GROUPS, PLACEHOLDERS, type ArmInputKey } from "../body/inputs.ts";
import { changedKeys, overridesYaml } from "../body/overridesYaml.ts";
import { WarnIcon } from "../ui/icons.tsx";

type Props = {
  /** Values from measurements.yaml (null = not measured). */
  fileValues: Record<ArmInputKey, number | null>;
  /** Values typed into the panel; they win over the file until reset. */
  overrides: Partial<Record<ArmInputKey, number>>;
  onChange: (key: ArmInputKey, value: number | undefined) => void;
  onReset: () => void;
  warnings: string[];
  /** Shown above the values (the Arm tab's placeholder notice). */
  notice?: ReactNode;
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

/** The measurements inspector (a float in the Arm tab's workspace): every arm input, editable. */
export function MeasurementsPanel({ fileValues, overrides, onChange, onReset, warnings, notice }: Props) {
  const hasOverrides = Object.keys(overrides).length > 0;
  const changed = changedKeys(overrides, fileValues);
  const yaml = overridesYaml(overrides, fileValues);
  return (
    <aside className="float measurements" aria-label="Measurements">
      <div className="float-head">
        <h2 className="float-title">Measurements</h2>
        <span className="faint mono measurements-unit">cm</span>
        <span className="spacer" />
        {changed.length > 0 && (
          <span className="chip plain edited-count" title="Values that differ from the file">
            {changed.length} edited
          </span>
        )}
        <button
          type="button"
          className="ghost small-button"
          onClick={onReset}
          disabled={!hasOverrides}
          title="Back to the values in the file"
        >
          Reset
        </button>
      </div>
      <div className="measurements-body">
        <p className="measurements-intro faint">
          From <code>config/measurements.yaml</code>. Edits here are a preview only; write final numbers into
          the file.
        </p>
        {notice}
        {warnings.map((w) => (
          <p key={w} className="notice compact">
            <WarnIcon />
            <span>{w}</span>
          </p>
        ))}
        {changed.length > 0 && <ChangedValues count={changed.length} yaml={yaml} />}
        {INPUT_GROUPS.map((group) => (
          <fieldset key={group.title}>
            <legend>{group.title}</legend>
            {group.keys.map((key) => {
              const override = overrides[key];
              const file = fileValues[key];
              const source = override !== undefined ? "edited" : file !== null ? "file" : "placeholder";
              const value = override ?? file ?? PLACEHOLDERS[key];
              const changedFromFile = source === "edited" && override !== file;
              return (
                <label
                  key={key}
                  className={`field ${source}${changedFromFile ? " changed" : ""}`}
                  title={source === "edited" ? `In the file: ${file ?? "not measured"}` : undefined}
                >
                  <span className="field-name">{LABELS[key]}</span>
                  <input
                    type="number"
                    min={0}
                    step={0.1}
                    value={value}
                    onChange={(e) => {
                      const n = e.target.valueAsNumber;
                      onChange(key, Number.isFinite(n) && n > 0 ? n : undefined);
                    }}
                  />
                  <span className="tag">
                    {source === "edited" && file !== null ? (
                      <>
                        was <span className="mono">{file}</span>
                      </>
                    ) : (
                      source
                    )}
                  </span>
                </label>
              );
            })}
          </fieldset>
        ))}
      </div>
    </aside>
  );
}

/** The edited values as YAML for config/measurements.yaml, with a copy button. */
function ChangedValues({ count, yaml }: { count: number; yaml: string }) {
  const [copied, setCopied] = useState<"ok" | "failed" | null>(null);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(null), 2000);
    return () => clearTimeout(t);
  }, [copied]);
  const copy = () =>
    navigator.clipboard.writeText(yaml).then(
      () => setCopied("ok"),
      () => setCopied("failed"),
    );
  return (
    <div className="changed-values">
      <div className="changed-values-head">
        <span>
          {count} value{count === 1 ? "" : "s"} differ{count === 1 ? "s" : ""} from the file
        </span>
        <button type="button" className="primary small-button" onClick={() => void copy()}>
          {copied === "ok" ? "Copied" : "Copy as YAML"}
        </button>
      </div>
      <pre aria-label="Changed values as YAML">{yaml}</pre>
      <p className="faint" role="status">
        {copied === "ok"
          ? "Copied. Paste over the same keys in config/measurements.yaml."
          : copied === "failed"
            ? "The browser blocked the clipboard; select the text above instead."
            : "Paste over the same keys in config/measurements.yaml."}
      </p>
    </div>
  );
}
