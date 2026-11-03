import { useMemo } from "react";
import { renderUnwrap } from "../render/unwrapCanvas.ts";
import { ArmViewer } from "./ArmViewer.tsx";
import { MeasurementsPanel } from "./MeasurementsPanel.tsx";
import { fileValues, INPUT_COUNT, loadedMeasurements, type ArmState } from "./useArm.ts";

/** Grid texture resolution; 24 px per cm keeps the texture under 2048 px for real arms. */
const PX_PER_CM = 24;

export function ArmPage({ arm }: { arm: ArmState }) {
  const { profile, placeholders } = arm;
  const canvas = useMemo(() => {
    const c = document.createElement("canvas");
    renderUnwrap(c, profile, "grid", null, { pxPerCm: PX_PER_CM, grid: true });
    return c;
  }, [profile]);

  return (
    <div className="arm-page">
      {!loadedMeasurements.ok && (
        <section className="card notice error" role="alert">
          <h2>config/measurements.yaml is invalid</h2>
          <p>{loadedMeasurements.error}. Showing placeholders.</p>
        </section>
      )}
      <PlaceholderNotice count={placeholders.length} />
      <div className="arm-layout">
        <ArmViewer profile={profile} canvas={canvas} version={0} />
        <MeasurementsPanel
          fileValues={fileValues}
          overrides={arm.overrides}
          warnings={profile.warnings}
          onChange={arm.setOverride}
          onReset={arm.resetOverrides}
        />
      </div>
    </div>
  );
}

export function PlaceholderNotice({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <section className="card notice warn" role="status">
      <h2>
        Placeholder arm: {count} of {INPUT_COUNT} values not measured yet
      </h2>
      <p>
        Proportions are generic until <code>config/measurements.yaml</code> is filled in (see{" "}
        <code>docs/measuring.md</code>).
      </p>
    </section>
  );
}
