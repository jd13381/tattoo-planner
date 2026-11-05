// Settings → Project: the open project's name, body and height (written to project.yaml), its folder,
// switching or closing it, and for an older data folder "Move into project". Below, the folder's
// structure and files.
import { useState } from "react";
import { FolderContents } from "../data/DataFolderPage.tsx";
import {
  closeProject,
  migrateProject,
  migrationLines,
  openProject,
  reloadForProject,
  updateProject,
} from "./api.ts";
import { useFolderPicker } from "./FolderPicker.tsx";
import { projectStatus } from "./projectData.ts";
import { BODIES, BODY_LABELS, type Body, type MigrationReport, type ProjectStatus } from "./schema.ts";

export function ProjectPage() {
  const [status, setStatus] = useState<ProjectStatus | null>(projectStatus);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [migration, setMigration] = useState<MigrationReport | null>(null);
  const { pickFolder, dialog } = useFolderPicker();

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const switchProject = () =>
    act(async () => {
      const path = await pickFolder({ title: "Open project", purpose: "open" });
      if (!path) return;
      await openProject(path);
      reloadForProject();
    });

  const close = () =>
    act(async () => {
      await closeProject();
      reloadForProject();
    });

  const migrate = () =>
    act(async () => {
      const r = await migrateProject();
      setMigration(r.migration);
      setStatus(r.project);
    });

  if (!status)
    return <p className="notice error">The planner's server did not answer. Restart the planner.</p>;
  const legacy = status.status === "legacy";
  const tone = status.problem ? "warn" : "ok";

  return (
    <div className="df-page">
      <header className={`df-head tone-${tone}`}>
        <span className="df-head-icon" aria-hidden="true">
          <FolderGlyph />
        </span>
        <div className="df-head-text">
          <div className="df-head-title">
            <h2>{status.name ?? "Project"}</h2>
            <span className={`chip ${legacy ? "warn" : "ok"}`}>
              {legacy ? "Older data folder" : "Project"}
            </span>
          </div>
          <p className="df-head-path">
            <code>{status.path}</code>
          </p>
        </div>
        {!status.locked && (
          <div className="toolbar">
            <button type="button" onClick={() => void switchProject()} disabled={busy}>
              Open other project…
            </button>
            <button type="button" className="ghost" onClick={() => void close()} disabled={busy}>
              Close project
            </button>
          </div>
        )}
      </header>
      {status.locked && (
        <p className="notice">
          This planner is set up to always open this folder, so it cannot be switched here.
        </p>
      )}
      {status.problem && <p className="notice warn">{status.problem}</p>}
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}

      {legacy && !migration && (
        <section className="df-panel pj-migrate" aria-label="Move into project">
          <div className="df-panel-head">
            <h2 className="float-title">Move into project</h2>
          </div>
          <p className="muted">
            This is an older data folder: the layouts, projections and measurements still live with the app
            itself. <strong>Move into project</strong> copies them into this folder (nothing is replaced or
            deleted) and adds a project.yaml, so the folder holds everything.
          </p>
          <div className="toolbar">
            <button type="button" className="primary" onClick={() => void migrate()} disabled={busy}>
              {busy ? "Moving…" : "Move into project"}
            </button>
            {!status.canMigrate && (
              <span className="faint small">Nothing to copy; only project.yaml is added.</span>
            )}
          </div>
        </section>
      )}
      {migration && (
        <section className="df-panel pj-migrate" aria-label="Moved into project" role="status">
          <div className="df-panel-head">
            <h2 className="float-title">Moved into the project</h2>
          </div>
          <ul className="pj-summary">
            {migrationLines(migration).map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
          <p className="muted small">
            The planner now reads everything from this folder. You can rename it below.
          </p>
          <div className="toolbar">
            <button type="button" className="primary" onClick={reloadForProject}>
              Continue
            </button>
          </div>
        </section>
      )}

      {status.status === "project" && !migration && (
        <ProjectDetails
          key={`${status.name}|${status.body}|${status.height_cm}`}
          status={status}
          busy={busy}
          onSave={(patch) =>
            act(async () => {
              setStatus(await updateProject(patch));
              // Body and height shape the 3D body, which is built when the page loads.
              if (patch.body !== undefined || patch.height_cm !== undefined) reloadForProject();
            })
          }
        />
      )}

      <FolderContents />
      {dialog}
    </div>
  );
}

function ProjectDetails(props: {
  status: ProjectStatus;
  busy: boolean;
  onSave: (patch: { name?: string; body?: Body; height_cm?: number | null }) => void;
}) {
  const { status } = props;
  const [name, setName] = useState(status.name ?? "");
  const [body, setBody] = useState<Body | null>(status.body);
  const [height, setHeight] = useState(status.height_cm === null ? "" : String(status.height_cm));
  const heightValue = height.trim() === "" ? null : Number(height);
  const heightOk =
    heightValue === null || (Number.isFinite(heightValue) && heightValue >= 50 && heightValue <= 260);
  const patch: { name?: string; body?: Body; height_cm?: number | null } = {};
  if (name.trim() !== status.name) patch.name = name.trim();
  if (body !== null && body !== status.body) patch.body = body;
  if (heightOk && heightValue !== status.height_cm) patch.height_cm = heightValue;
  const changed = Object.keys(patch).length > 0;
  const valid = name.trim() !== "" && heightOk;

  return (
    <form
      className="df-panel pj-details"
      aria-label="Project details"
      onSubmit={(e) => {
        e.preventDefault();
        if (changed && valid) props.onSave(patch);
      }}
    >
      <div className="df-panel-head">
        <h2 className="float-title">Details</h2>
        <span className="faint small">Saved in project.yaml</span>
      </div>
      <div className="pj-fields">
        <label className="pj-field">
          <span>Name</span>
          <input type="text" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="pj-field">
          <span id="pj-body-label">Body</span>
          <div className="segmented" role="group" aria-labelledby="pj-body-label">
            {BODIES.map((b) => (
              <button key={b} type="button" aria-pressed={body === b} onClick={() => setBody(b)}>
                {BODY_LABELS[b]}
              </button>
            ))}
          </div>
        </div>
        <label className="pj-field">
          <span>Height (cm, optional)</span>
          <input
            type="number"
            min={50}
            max={260}
            step={1}
            value={height}
            placeholder="sample"
            aria-invalid={!heightOk}
            onChange={(e) => setHeight(e.target.value)}
          />
        </label>
        <div className="pj-field pj-save">
          <button type="submit" className="primary" disabled={!changed || !valid || props.busy}>
            Save
          </button>
        </div>
      </div>
      <p className="field-hint">
        Body and height scale the sample body wherever you have not measured; measurements are in Body &amp;
        measurements.
      </p>
    </form>
  );
}

function FolderGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4.4l2 2h8.6A1.5 1.5 0 0 1 21 9.5v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z" />
    </svg>
  );
}
