// The Arm & measurements tab: a full-bleed 3D arm with the 1 cm grid texture, view / pose /
// screenshot in floating bars, and the measurements as a dense inspector on the right.
import { useMemo, useState } from "react";
import { renderUnwrap } from "../render/unwrapCanvas.ts";
import { WarnIcon } from "../ui/icons.tsx";
import { ArmViewer, ORBIT_HINT, PoseControl } from "./ArmViewer.tsx";
import { MeasurementsPanel } from "./MeasurementsPanel.tsx";
import { fileValues, INPUT_COUNT, loadedMeasurements, type ArmState, type Pose } from "./useArm.ts";

/** Grid texture resolution; 24 px per cm keeps the texture under 2048 px for real arms. */
const PX_PER_CM = 24;

const GRID_HINT =
  "Grid: 1 cm, bold every 5 cm; red lines mark outer, lateral, inner and medial centre lines.";

export function ArmPage({ arm, pose }: { arm: ArmState; pose: Pose }) {
  const { profile, placeholders } = arm;
  const canvas = useMemo(() => {
    const c = document.createElement("canvas");
    renderUnwrap(c, profile, "grid", null, { pxPerCm: PX_PER_CM, grid: true });
    return c;
  }, [profile]);
  const [viewerBar, setViewerBar] = useState<HTMLDivElement | null>(null);

  return (
    <div className="arm-page">
      {!loadedMeasurements.ok && (
        <p className="notice error arm-errors" role="alert">
          <strong>config/measurements.yaml is invalid:</strong> {loadedMeasurements.error}. Showing
          placeholders.
        </p>
      )}
      <div className="arm-workspace">
        <section className="arm-stage" aria-label="3D arm">
          <ArmViewer
            profile={profile}
            canvas={canvas}
            version={0}
            bendDeg={pose.bendDeg}
            toolbarTarget={viewerBar}
            screenshotInToolbar
            footer={false}
            viewSides
          />
          <div className="float float-bar arm-view-bar" title={ORBIT_HINT}>
            <div ref={setViewerBar} className="viewer-tools" />
          </div>
          <div className="float pose-panel arm-pose">
            <PoseControl bendDeg={pose.bendDeg} onChange={pose.setBendDeg} variant="panel" />
          </div>
          <div className="float arm-legend" title={`${ORBIT_HINT} ${GRID_HINT}`}>
            <span>
              <i className="arm-key grid" aria-hidden="true" />1 cm grid, bold every 5 cm
            </span>
            <span>
              <i className="arm-key red" aria-hidden="true" />
              centre lines: outer, lateral, inner, medial
            </span>
            <span className="faint">{ORBIT_HINT}</span>
          </div>
        </section>
        <MeasurementsPanel
          fileValues={fileValues}
          overrides={arm.overrides}
          warnings={profile.warnings}
          onChange={arm.setOverride}
          onReset={arm.resetOverrides}
          notice={<PlaceholderNotice count={placeholders.length} />}
        />
      </div>
    </div>
  );
}

/** Not every value is measured yet: the arm uses generic proportions for the rest. */
export function PlaceholderNotice({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <p className="notice compact" role="status">
      <WarnIcon />
      <span>
        <strong>
          Placeholder arm: {count} of {INPUT_COUNT} values not measured yet.
        </strong>{" "}
        Proportions are generic until <code>config/measurements.yaml</code> is filled in (see{" "}
        <code>docs/measuring.md</code>).
      </span>
    </p>
  );
}
