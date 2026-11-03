import { useMemo, useState } from "react";
import measurementsText from "../../config/measurements.yaml?raw";
import { measuredValues, PLACEHOLDERS, resolveInputs, type ArmInputKey } from "../arm/inputs.ts";
import { buildProfile } from "../arm/profile.ts";
import { parseMeasurements } from "../config/loadMeasurements.ts";
import { ArmViewer } from "./ArmViewer.tsx";
import { MeasurementsPanel } from "./MeasurementsPanel.tsx";

const loaded = parseMeasurements(measurementsText);
const INPUT_COUNT = Object.keys(PLACEHOLDERS).length;
const fileValues: Record<ArmInputKey, number | null> = loaded.ok
  ? measuredValues(loaded.measurements)
  : (Object.fromEntries(Object.keys(PLACEHOLDERS).map((k) => [k, null])) as Record<ArmInputKey, null>);

export function ArmPage() {
  const [overrides, setOverrides] = useState<Partial<Record<ArmInputKey, number>>>({});

  const { profile, placeholders } = useMemo(() => {
    const { inputs, placeholders } = resolveInputs({ ...fileValues, ...overrides });
    return { profile: buildProfile(inputs), placeholders };
  }, [overrides]);

  return (
    <div className="arm-page">
      {!loaded.ok && (
        <section className="card notice error" role="alert">
          <h2>config/measurements.yaml is invalid</h2>
          <p>{loaded.error}. Showing placeholders.</p>
        </section>
      )}
      {placeholders.length > 0 && (
        <section className="card notice warn" role="status">
          <h2>
            Placeholder arm: {placeholders.length} of {INPUT_COUNT} values not measured yet
          </h2>
          <p>
            Proportions are generic until <code>config/measurements.yaml</code> is filled in (see{" "}
            <code>docs/measuring.md</code>).
          </p>
        </section>
      )}
      <div className="arm-layout">
        <ArmViewer profile={profile} />
        <MeasurementsPanel
          fileValues={fileValues}
          overrides={overrides}
          warnings={profile.warnings}
          onChange={(key, value) =>
            setOverrides((o) => {
              const next = Object.entries(o).filter(([k]) => k !== key);
              if (value !== undefined) next.push([key, value]);
              return Object.fromEntries(next);
            })
          }
          onReset={() => setOverrides({})}
        />
      </div>
    </div>
  );
}
