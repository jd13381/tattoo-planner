// Settings → Project: the open project's name and folder with Open other / Close, for the read-only
// sample "Save as new project", for an older data folder "Move into project", then the project's
// name, body and height (written to project.yaml), the people, and the folder's files and structure
// in a closed "Project folder details" disclosure.
import { useState } from "react";
import { ProjectFolderDetails } from "../data/DataFolderPage.tsx";
import { desktopBridge } from "../desktop/bridge.ts";
import {
  closeProject,
  migrateProject,
  migrationLines,
  openProject,
  reloadForProject,
  saveSampleAs,
  updateProject,
} from "./api.ts";
import { FolderGlyph, useFolderPicker } from "./FolderPicker.tsx";
import { projectStatus } from "./projectData.ts";
import { PeoplePanel } from "./PeoplePanel.tsx";
import { getPersons } from "./personsStore.ts";
import { BODIES, BODY_LABELS, type Body, type MigrationReport, type ProjectStatus } from "./schema.ts";
import { NewProjectDialog } from "./StartScreen.tsx";
import { shortPath } from "./startForm.ts";

export function ProjectPage() {
  const [status, setStatus] = useState<ProjectStatus | null>(projectStatus);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [migration, setMigration] = useState<MigrationReport | null>(null);
  const { pickFolder, dialog } = useFolderPicker();
  const desktop = desktopBridge();

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
      const path = await pickFolder({ title: "Open a project", purpose: "open" });
      if (!path) return;
      await openProject(path);
      reloadForProject();
    });

  // Nothing is lost: the project folder stays as it is; unsaved edits are named by the page's
  // leave-page question before the reload.
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
  const sample = status.sample;

  return (
    <div className="prj-page">
      <header className={`prj-head${sample ? " sample" : ""}`}>
        <span className="prj-head-icon" aria-hidden="true">
          <FolderGlyph />
        </span>
        <div className="prj-head-text">
          <p className="prj-eyebrow">
            {sample ? "Sample, shipped with the planner" : legacy ? "Older data folder" : "Project"}
          </p>
          <h2 className="prj-title">{status.name ?? "Project"}</h2>
          {!sample && status.path && (
            <p className="prj-path">
              <code title={status.path}>{shortPath(status.path)}</code>
              {desktop && (
                <button
                  type="button"
                  className="link prj-reveal"
                  onClick={() => void act(() => desktop.revealInFinder(status.path!))}
                >
                  Show in Finder
                </button>
              )}
            </p>
          )}
        </div>
        {!status.locked && (
          <div className="prj-head-actions">
            <button type="button" onClick={() => void switchProject()} disabled={busy}>
              Open other…
            </button>
            <button
              type="button"
              className="ghost"
              onClick={() => void close()}
              disabled={busy}
              title="Back to the start screen. The project folder stays as it is."
            >
              Close project
            </button>
          </div>
        )}

        {sample && (
          <div className="prj-sample" role="note">
            <p>
              <strong>Changes to the sample are not saved.</strong> Try anything you like; to keep your work,
              save a copy as your own project and carry on there.
            </p>
            {!status.locked && (
              <button
                type="button"
                className="primary"
                onClick={() => {
                  setError(null);
                  setSaving(true);
                }}
                disabled={busy}
              >
                Save as new project…
              </button>
            )}
          </div>
        )}
      </header>

      {status.locked && (
        <p className="notice">
          This planner is set up to always open this folder, so it cannot be switched here.
        </p>
      )}
      {status.problem && <p className="notice warn">{status.problem}</p>}
      {error && !saving && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}

      {legacy && !migration && (
        <section className="df-panel prj-card" aria-labelledby="prj-migrate-title">
          <div className="df-panel-head">
            <h2 className="float-title" id="prj-migrate-title">
              Move into project
            </h2>
          </div>
          <div className="prj-card-body">
            <p className="prj-text">
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
          </div>
        </section>
      )}
      {migration && (
        <section className="df-panel prj-card" aria-labelledby="prj-moved-title" role="status">
          <div className="df-panel-head">
            <h2 className="float-title" id="prj-moved-title">
              Moved into the project
            </h2>
          </div>
          <div className="prj-card-body">
            <ul className="pj-summary">
              {migrationLines(migration).map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
            <p className="prj-text muted">
              The planner now reads everything from this folder. You can rename it below.
            </p>
            <div className="toolbar">
              <button type="button" className="primary" onClick={reloadForProject}>
                Continue
              </button>
            </div>
          </div>
        </section>
      )}

      {status.status === "project" && !sample && !migration && (
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

      {status.status === "project" && !migration && <PeoplePanel readOnly={sample} />}

      <ProjectFolderDetails />

      {saving && (
        <NewProjectDialog
          title="Save as new project"
          subtitle="Copies the sample, with its people, layouts and placeholder images, into a new folder and opens the copy."
          initialName="My sample project"
          initialBody={status.body}
          submitLabel="Save and open"
          busyLabel="Saving…"
          busy={busy}
          error={error}
          pickFolder={pickFolder}
          onClose={() => {
            setSaving(false);
            setError(null);
          }}
          onCreate={(fields) =>
            void act(async () => {
              await saveSampleAs(fields);
              reloadForProject();
            })
          }
        />
      )}
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
  const who = getPersons().current?.name ?? "the person shown";

  return (
    <form
      className="df-panel prj-card"
      aria-labelledby="prj-details-title"
      onSubmit={(e) => {
        e.preventDefault();
        if (changed && valid) props.onSave(patch);
      }}
    >
      <div className="df-panel-head">
        <h2 className="float-title" id="prj-details-title">
          Details
        </h2>
      </div>
      <div className="prj-card-body">
        <div className="prj-fields">
          <label className="pj-field prj-field-name">
            <span>Project name</span>
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
            <span>Height (cm)</span>
            <input
              type="number"
              min={50}
              max={260}
              step={1}
              value={height}
              placeholder="Optional"
              aria-invalid={!heightOk}
              onChange={(e) => setHeight(e.target.value)}
            />
          </label>
        </div>
        <div className="prj-card-foot">
          <p className="prj-hint">
            Body and height belong to {who}. They scale the sample body wherever nobody has measured;
            measurements live in Body &amp; measurements.
          </p>
          <button type="submit" className="primary" disabled={!changed || !valid || props.busy}>
            Save changes
          </button>
        </div>
      </div>
    </form>
  );
}
