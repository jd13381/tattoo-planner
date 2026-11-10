// "Measure yourself": one value per step for the chosen region, with an instruction and a schematic;
// every value goes into the unsaved draft at once, so the 3D region follows. Optional and can be left
// at any step (Close or Esc): the values entered so far stay in the draft (Save writes them).
import { useEffect, useMemo, useRef, useState } from "react";
import { bodyStatus, fieldStatuses, formatCm, type FieldStatus } from "../body/fieldStatus.ts";
import { INPUT_LABELS, untapedKeys, wizardSteps, WIZARD_TIPS } from "../body/measureGuide.ts";
import { REGIONS, type RegionId } from "../body/regions.ts";
import { BODY_IDS, DEFAULT_BODY, SAMPLES, type BodyId } from "../body/samples.ts";
import { useEscape } from "../ui/useEscape.ts";
import type { ArmState } from "../viewer/useArm.ts";
import { MeasureDiagram } from "./MeasureDiagram.tsx";

type Props = {
  arm: ArmState;
  region: RegionId;
  onExit: () => void;
  onSave: () => void;
  saving: boolean;
};

/** What a step's value was when the step was opened (Skip puts it back). */
type Before =
  { kind: "height"; value: number | null | undefined } | { kind: "value"; value: number | null | undefined };

export function MeasureWizard({ arm, region, onExit, onSave, saving }: Props) {
  const steps = useMemo(() => wizardSteps(region), [region]);
  const [index, setIndex] = useState(0);
  const [visited, setVisited] = useState<Set<string>>(() => new Set());
  const before = useRef<Before | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const def = REGIONS[region];
  const summary = index >= steps.length;
  const step = steps[Math.min(index, steps.length - 1)]!;
  const fields = fieldStatuses(arm.measurements, arm.draft, region);
  const field = fields.find((f) => f.key === step.key);
  const bs = bodyStatus(arm.measurements, arm.draft);

  // Remember the value as it was when the step opened; focus the input.
  useEffect(() => {
    if (summary) return;
    before.current =
      step.key === "height_cm"
        ? { kind: "height", value: arm.draft.heightCm }
        : { kind: "value", value: arm.draft.regions?.[region]?.[step.key] };
    input.current?.focus();
    input.current?.select();
    // Only when the step changes, not on every edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, region, summary]);

  const go = (to: number) => {
    if (!summary) setVisited((v) => new Set(v).add(step.key));
    setIndex(Math.max(0, Math.min(to, steps.length)));
  };
  const skip = () => {
    const b = before.current;
    if (b?.kind === "height") arm.setHeight(b.value);
    else if (b) arm.setValue(region, step.key, b.value);
    go(index + 1);
  };

  const setHeight = (n: number | null) => {
    const file = arm.measurements?.height_cm ?? null;
    arm.setHeight(n === file ? undefined : n);
  };
  const setField = (f: FieldStatus, n: number | null) => {
    if (n === null) arm.setValue(region, f.key, f.file === null ? undefined : null);
    else arm.setValue(region, f.key, n === f.file ? undefined : n);
  };
  const onInput = (raw: string) => {
    const n = Number(raw.replace(",", "."));
    const value = raw.trim() === "" || !Number.isFinite(n) || n <= 0 ? null : n;
    if (step.key === "height_cm") setHeight(value);
    else if (field) setField(field, value);
  };

  const value = step.key === "height_cm" ? bs.heightCm : (field?.own ?? null);
  const placeholder =
    step.key === "height_cm" ? formatCm(bs.sampleHeight) : field ? formatCm(field.fallback) : "";
  const fallbackNote =
    step.key === "height_cm"
      ? `Skipped: the ${SAMPLES[bs.body].label.toLowerCase()} keeps its height.`
      : field?.fallbackSource === "other-side"
        ? `Skipped: ${formatCm(field.fallback)} cm, as measured on the other side.`
        : `Skipped: ${formatCm(field?.fallback ?? 0)} cm from the sample body.`;

  // Esc closes the wizard like the Close button (the values entered so far stay in the draft).
  useEscape(onExit);

  const stepNo = Math.min(index, steps.length - 1) + 1;
  return (
    <div className="measure-wizard">
      <div className="float-head mw-head">
        <h2 className="float-title mw-title">Measure yourself · {def.label}</h2>
        <span className="spacer" />
        <span
          className="faint mono mw-count"
          aria-label={summary ? "Summary" : `Step ${stepNo} of ${steps.length}`}
        >
          {summary ? "Summary" : `${stepNo} / ${steps.length}`}
        </span>
        <button
          type="button"
          className="ghost small-button"
          onClick={onExit}
          aria-keyshortcuts="Escape"
          title="Back to the form (Esc); the values entered so far stay, unsaved"
        >
          Close
        </button>
      </div>
      <div className="mw-progress" aria-hidden="true">
        <i style={{ width: `${(Math.min(index, steps.length) / steps.length) * 100}%` }} />
      </div>
      {summary ? (
        <Summary
          arm={arm}
          region={region}
          fields={fields}
          visited={visited}
          onEdit={(key) => setIndex(steps.findIndex((s) => s.key === key))}
        />
      ) : (
        <>
          <div className="mw-scroll">
            <MeasureDiagram kind={def.kind} diagram={step.diagram} label={step.label} />
            <section className="mw-step" aria-label={`Step ${stepNo} of ${steps.length}`}>
              <h3 className="mw-label">{step.label}</h3>
              <p className="mw-instruction">{step.instruction}</p>
            </section>
            {index === 0 && (
              <ul className="mw-tips" aria-label="Tips">
                {WIZARD_TIPS.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            )}
          </div>
          <div className="mw-entry-card">
            {index === 0 && (
              <label className="mw-field">
                <span className="mw-field-name">Sample body</span>
                <select
                  value={bs.body}
                  onChange={(e) => {
                    const b = e.target.value as BodyId;
                    arm.setBody(b === (arm.measurements?.body ?? DEFAULT_BODY) ? undefined : b);
                  }}
                >
                  {BODY_IDS.map((b) => (
                    <option key={b} value={b}>
                      {SAMPLES[b].label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <form
              className="mw-field"
              onSubmit={(e) => {
                e.preventDefault();
                go(index + 1);
              }}
            >
              <label className="mw-field-name" htmlFor="mw-value">
                Your value
              </label>
              <span className="mw-value">
                <input
                  id="mw-value"
                  ref={input}
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step={0.1}
                  aria-label={`${step.label} in cm`}
                  placeholder={placeholder}
                  value={value ?? ""}
                  onChange={(e) => onInput(e.target.value)}
                />
                <span className="faint">cm</span>
              </span>
            </form>
            <p className={`mw-status${value === null ? " faint" : " ok-text"}`} aria-live="polite">
              {value === null ? fallbackNote : "Shown on the 3D model now."}
            </p>
          </div>
        </>
      )}
      <div className="mw-nav">
        <button type="button" className="ghost" onClick={() => go(index - 1)} disabled={index === 0}>
          Back
        </button>
        <span className="spacer" />
        {summary ? (
          <button type="button" className="primary" onClick={onSave} disabled={saving || arm.dirty === 0}>
            {saving
              ? "Saving…"
              : arm.dirty === 0
                ? "Nothing to save"
                : `Save ${arm.dirty} value${arm.dirty === 1 ? "" : "s"}`}
          </button>
        ) : (
          <>
            <button type="button" className="ghost" onClick={skip} title="Leave this value as it was">
              Skip
            </button>
            <button type="button" className="primary" onClick={() => go(index + 1)}>
              {index === steps.length - 1 ? "Finish" : "Next"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/** The end of the wizard: what was entered, what keeps the sample's value. */
function Summary({
  arm,
  region,
  fields,
  visited,
  onEdit,
}: {
  arm: ArmState;
  region: RegionId;
  fields: FieldStatus[];
  visited: Set<string>;
  onEdit: (key: string) => void;
}) {
  const steps = wizardSteps(region);
  const bs = bodyStatus(arm.measurements, arm.draft);
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const untaped = untapedKeys(REGIONS[region].kind);
  const own = steps.filter((s) =>
    s.key === "height_cm" ? bs.heightCm !== null : byKey.get(s.key)?.own != null,
  );
  return (
    <div className="mw-scroll">
      <section className="mw-step">
        <h3 className="mw-label">Summary</h3>
        <p className="mw-instruction">
          {own.length} of {steps.length} values are your own; the rest come from the{" "}
          {SAMPLES[bs.body].label.toLowerCase()}
          {bs.heightCm ? `, scaled to ${formatCm(bs.heightCm)} cm` : ""}. Click a row to go back to it.{" "}
          {arm.dirty > 0 ? "Save writes the new values into measurements.yaml." : "Nothing new to save."}
        </p>
      </section>
      <table className="mw-summary">
        <tbody>
          {steps.map((s) => {
            const f = byKey.get(s.key);
            const v = s.key === "height_cm" ? bs.heightCm : (f?.own ?? null);
            const changed = s.key === "height_cm" ? bs.heightChanged : !!f?.changed;
            return (
              <tr key={s.key} className={changed ? "changed" : undefined} onClick={() => onEdit(s.key)}>
                <th scope="row">{s.label}</th>
                <td className="mono">{v === null ? "—" : formatCm(v)}</td>
                <td className="faint">
                  {v === null ? (visited.has(s.key) ? "skipped" : "sample") : changed ? "new" : "measured"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {untaped.length > 0 && (
        <p className="faint mw-status">
          Not taped: {untaped.map((k) => INPUT_LABELS[k] ?? k).join(", ")}. They keep the sample&apos;s
          values; adjust them in the form if the 3D torso looks off.
        </p>
      )}
    </div>
  );
}
