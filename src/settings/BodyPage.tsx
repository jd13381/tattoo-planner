// Settings → Body & measurements: the sample body and own height, a region picker, the region in 3D
// with the 1 cm grid, and per region either the measurements form or the "Measure yourself" wizard.
// Edits are a live draft (every tab shows them); Save writes them into measurements.yaml.
import { useEffect, useMemo, useState } from "react";
import { regionBendDeg, supportsBend } from "../body/bend.ts";
import { bodyStatus, fieldStatuses, formatCm, type FieldStatus } from "../body/fieldStatus.ts";
import { INPUT_SECTIONS } from "../body/inputs.ts";
import { INPUT_LABELS, isRatio, SECTION_TITLES } from "../body/measureGuide.ts";
import { REGION_IDS, REGIONS, type RegionId } from "../body/regions.ts";
import { BODY_IDS, DEFAULT_BODY, SAMPLES, type BodyId } from "../body/samples.ts";
import { renderUnwrap } from "../render/unwrapCanvas.ts";
import { WarnIcon } from "../ui/icons.tsx";
import { ArmViewer, ORBIT_HINT, PoseControl } from "../viewer/ArmViewer.tsx";
import type { ArmState, Pose } from "../viewer/useArm.ts";
import { MeasureWizard } from "./MeasureWizard.tsx";

/** Grid texture resolution; 24 px per cm keeps the texture under 2048 px for arms, less for the rest. */
const PX_PER_CM = 24;
const REGION_KEY = "tattoo-planner.body-region";

const SOURCE_TAGS: Record<FieldStatus["source"], string> = {
  edited: "edited",
  measured: "measured",
  "other-side": "other side",
  sample: "sample",
};

function storedRegion(): RegionId {
  try {
    const r = localStorage.getItem(REGION_KEY);
    return REGION_IDS.find((id) => id === r) ?? "arm-left";
  } catch {
    return "arm-left";
  }
}

export function BodyPage({ arm, pose }: { arm: ArmState; pose: Pose }) {
  const [region, setRegionState] = useState<RegionId>(storedRegion);
  const [wizard, setWizard] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [workspace, setWorkspace] = useState<HTMLDivElement | null>(null);
  const [viewerBar, setViewerBar] = useState<HTMLDivElement | null>(null);
  const resolved = arm.body.regions[region];
  const profile = resolved.profile;
  const def = REGIONS[region];
  // Wider textures for the torso (≈ 100 cm round) stay below 4096 px.
  const pxPerCm = def.kind === "arm" ? PX_PER_CM : 16;
  const canvas = useMemo(() => {
    const c = document.createElement("canvas");
    renderUnwrap(c, profile, "grid", null, { pxPerCm, grid: true });
    return c;
  }, [profile, pxPerCm]);

  const setRegion = (id: RegionId) => {
    setRegionState(id);
    try {
      localStorage.setItem(REGION_KEY, id);
    } catch {
      // A blocked storage only forgets the region.
    }
  };

  useEffect(() => {
    if (status?.tone !== "ok") return;
    const t = setTimeout(() => setStatus(null), 2500);
    return () => clearTimeout(t);
  }, [status]);

  const save = () => {
    setSaving(true);
    setStatus(null);
    arm.save().then(
      () => {
        setSaving(false);
        setStatus({ tone: "ok", text: "Saved to measurements.yaml" });
      },
      (e: unknown) => {
        setSaving(false);
        setStatus({ tone: "error", text: `Not saved: ${e instanceof Error ? e.message : String(e)}` });
      },
    );
  };

  const lines = def.lines.join(", ");
  return (
    <div className="arm-page body-page">
      {!arm.loaded.ok && (
        <p className="notice error arm-errors" role="alert">
          <strong>measurements.yaml is invalid:</strong> {arm.loaded.error}. Showing the sample body; fix the
          file before saving.
        </p>
      )}
      <div className="arm-workspace" ref={setWorkspace}>
        <section className="arm-stage" aria-label={`3D ${def.label.toLowerCase()}`}>
          <ArmViewer
            key={region}
            profile={profile}
            canvas={canvas}
            version={0}
            bendDeg={regionBendDeg(def.kind, pose.bendDeg)}
            toolbarTarget={viewerBar}
            screenshotInToolbar
            footer={false}
            viewSides
            frameAround={workspace}
          />
          <div className="float float-bar arm-view-bar" title={ORBIT_HINT}>
            <div ref={setViewerBar} className="viewer-tools" />
          </div>
          {supportsBend(def.kind) && (
            <div className="float pose-panel arm-pose">
              <PoseControl bendDeg={pose.bendDeg} onChange={pose.setBendDeg} variant="panel" />
            </div>
          )}
          <div className="float arm-legend" title={ORBIT_HINT}>
            <span>
              <i className="arm-key grid" aria-hidden="true" />1 cm grid, bold every 5 cm
            </span>
            <span>
              <i className="arm-key red" aria-hidden="true" />
              centre lines: {lines}
            </span>
            <span className="faint">{ORBIT_HINT}</span>
          </div>
        </section>
        <aside className="float measurements" aria-label="Body and measurements">
          {wizard ? (
            <MeasureWizard
              key={region}
              arm={arm}
              region={region}
              onExit={() => setWizard(false)}
              onSave={save}
              saving={saving}
            />
          ) : (
            <MeasurementsForm
              arm={arm}
              region={region}
              onRegion={setRegion}
              onWizard={() => setWizard(true)}
            />
          )}
          <SaveBar arm={arm} saving={saving} status={status} onSave={save} hideSave={wizard} />
        </aside>
      </div>
    </div>
  );
}

function SaveBar({
  arm,
  saving,
  status,
  onSave,
  hideSave,
}: {
  arm: ArmState;
  saving: boolean;
  status: { tone: "ok" | "error"; text: string } | null;
  onSave: () => void;
  hideSave: boolean;
}) {
  if (arm.dirty === 0 && !status) return null;
  return (
    <div className="measure-savebar">
      {status && (
        <p className={`measure-status ${status.tone}`} role={status.tone === "error" ? "alert" : "status"}>
          {status.text}
        </p>
      )}
      {arm.dirty > 0 && (
        <div className="measure-savebar-row">
          <span className="chip plain edited-count">{arm.dirty} unsaved</span>
          <span className="spacer" />
          <button type="button" className="ghost small-button" onClick={arm.discard} disabled={saving}>
            Discard
          </button>
          {!hideSave && (
            <button
              type="button"
              className="primary small-button"
              onClick={onSave}
              disabled={saving || !arm.loaded.ok}
              title="Write the values into measurements.yaml (comments are kept)"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function MeasurementsForm({
  arm,
  region,
  onRegion,
  onWizard,
}: {
  arm: ArmState;
  region: RegionId;
  onRegion: (id: RegionId) => void;
  onWizard: () => void;
}) {
  const def = REGIONS[region];
  const fields = fieldStatuses(arm.measurements, arm.draft, region);
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const own = fields.filter((f) => f.own !== null).length;
  const bs = bodyStatus(arm.measurements, arm.draft);
  const warnings = arm.body.regions[region].profile.warnings;
  const fileBody = arm.measurements?.body ?? DEFAULT_BODY;
  const fileHeight = arm.measurements?.height_cm ?? null;

  const setField = (f: FieldStatus, n: number | null) => {
    if (n === null) arm.setValue(region, f.key, f.file === null ? undefined : null);
    else arm.setValue(region, f.key, n === f.file ? undefined : n);
  };

  return (
    <>
      <div className="float-head">
        <h2 className="float-title">Body &amp; measurements</h2>
        <span className="spacer" />
        <span className="faint mono measurements-unit">cm</span>
      </div>
      <div className="measurements-body">
        <fieldset className="body-choice">
          <legend>Body</legend>
          <label className={`field${bs.bodyChanged ? " changed" : ""}`}>
            <span className="field-name">Sample body</span>
            <select
              value={bs.body}
              onChange={(e) => {
                const b = e.target.value as BodyId;
                arm.setBody(b === fileBody ? undefined : b);
              }}
            >
              {BODY_IDS.map((b) => (
                <option key={b} value={b}>
                  {SAMPLES[b].label}
                </option>
              ))}
            </select>
          </label>
          <label
            className={`field${bs.heightChanged ? " changed" : ""}${bs.heightCm === null ? " sample" : ""}`}
          >
            <span className="field-name">Body height</span>
            <input
              type="number"
              min={0}
              step={0.5}
              placeholder={formatCm(bs.sampleHeight)}
              value={bs.heightCm ?? ""}
              aria-label="Body height in cm"
              title="Scales every value nobody measured"
              onChange={(e) => {
                const n = e.target.valueAsNumber;
                const v = Number.isFinite(n) && n > 0 ? n : null;
                arm.setHeight(v === fileHeight ? undefined : v);
              }}
            />
            <span className="tag">
              {bs.heightCm === null ? "sample" : bs.heightChanged ? "edited" : "own"}
            </span>
          </label>
        </fieldset>

        <fieldset>
          <legend>Region</legend>
          <div className="region-row">
            <select
              className="region-select"
              value={region}
              onChange={(e) => onRegion(e.target.value as RegionId)}
              aria-label="Region"
            >
              {REGION_IDS.map((id) => (
                <option key={id} value={id}>
                  {REGIONS[id].label}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="primary small-button"
              onClick={onWizard}
              title="Step by step, one value at a time"
            >
              Measure yourself
            </button>
          </div>
          <p className="measurements-intro faint">
            {own === 0
              ? `Nothing measured on the ${def.label.toLowerCase()} yet: it shows the ${SAMPLES[bs.body].label.toLowerCase()}${bs.heightCm ? `, scaled to ${formatCm(bs.heightCm)} cm` : ""}.`
              : `${own} of ${fields.length} values measured; the others come from the ${fields.some((f) => f.own === null && f.fallbackSource === "other-side") ? "other side or the " : ""}sample body.`}{" "}
            Measuring is optional. Empty fields show the value in use as a hint.
          </p>
        </fieldset>

        {warnings.map((w) => (
          <p key={w} className="notice compact">
            <WarnIcon />
            <span>{w}</span>
          </p>
        ))}

        {INPUT_SECTIONS[def.kind].map(({ section, keys }) => (
          <fieldset key={section}>
            <legend>{SECTION_TITLES[section]}</legend>
            {(keys as string[]).map((key) => {
              const f = byKey.get(key)!;
              return <FieldRow key={key} f={f} onChange={(n) => setField(f, n)} />;
            })}
          </fieldset>
        ))}
      </div>
    </>
  );
}

function FieldRow({ f, onChange }: { f: FieldStatus; onChange: (n: number | null) => void }) {
  const ratio = isRatio(f.key);
  const from = f.fallbackSource === "other-side" ? "the other side" : "the sample body";
  const tag = f.source === "edited" && f.file !== null ? `was ${formatCm(f.file)}` : SOURCE_TAGS[f.source];
  const title =
    f.own === null
      ? `Not measured: ${formatCm(f.fallback)}${ratio ? "" : " cm"} from ${from}${f.changed && f.file !== null ? ` (file: ${formatCm(f.file)})` : ""}`
      : f.changed
        ? `Unsaved; in the file: ${f.file === null ? "not measured" : formatCm(f.file)}`
        : "Measured (in measurements.yaml)";
  return (
    <label
      className={`field ${f.own === null ? "sample" : f.source}${f.changed ? " changed" : ""}`}
      title={title}
    >
      <span className="field-name">
        {INPUT_LABELS[f.key] ?? f.key}
        {ratio && <span className="faint"> (ratio)</span>}
      </span>
      <input
        type="number"
        min={0}
        step={ratio ? 0.05 : 0.1}
        placeholder={formatCm(f.fallback)}
        value={f.own ?? ""}
        onChange={(e) => {
          const n = e.target.valueAsNumber;
          onChange(Number.isFinite(n) && n > 0 ? n : null);
        }}
      />
      <span className="tag">{tag}</span>
      <button
        type="button"
        className="ghost icon-button field-reset"
        onClick={(e) => {
          e.preventDefault();
          onChange(null);
        }}
        disabled={f.own === null}
        aria-label={`Reset ${INPUT_LABELS[f.key] ?? f.key} to ${from}`}
        title={`Reset to ${from} (${formatCm(f.fallback)})`}
      >
        ↺
      </button>
    </label>
  );
}
