import { useMemo } from "react";
import { renderUnwrap } from "../render/unwrapCanvas.ts";
import { ArmViewer } from "./ArmViewer.tsx";
import { MeasurementsPanel } from "./MeasurementsPanel.tsx";
import { fileValues, INPUT_COUNT, loadedMeasurements, type ArmState, type Pose } from "./useArm.ts";

/** Grid texture resolution; 24 px per cm keeps the texture under 2048 px for real arms. */
const PX_PER_CM = 24;

export function ArmPage({ arm, pose }: { arm: ArmState; pose: Pose }) {
  const { profile, placeholders } = arm;
  const canvas = useMemo(() => {
    const c = document.createElement("canvas");
    renderUnwrap(c, profile, "grid", null, { pxPerCm: PX_PER_CM, grid: true });
    return c;
  }, [profile]);

  return (
    <div className="arm-page">
      {!loadedMeasurements.ok && (
        <p className="notice error" role="alert">
          <strong>config/measurements.yaml is invalid:</strong> {loadedMeasurements.error}. Showing
          placeholders.
        </p>
      )}
      <PlaceholderNotice count={placeholders.length} />
      <div className="arm-layout">
        <ArmViewer
          profile={profile}
          canvas={canvas}
          version={0}
          bendDeg={pose.bendDeg}
          onBendDeg={pose.setBendDeg}
        />
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
    <p className="notice warn" role="status">
      <strong>
        Placeholder arm: {count} of {INPUT_COUNT} values not measured yet.
      </strong>{" "}
      Proportions are generic until <code>config/measurements.yaml</code> is filled in (see{" "}
      <code>docs/measuring.md</code>).
    </p>
  );
}
