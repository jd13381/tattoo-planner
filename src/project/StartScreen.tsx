// The start screen when no project is open (docs/adr/0012-project-folder.md): sample project (coming
// later), new project, open project, recent projects. Opening or creating reloads the page.
import { useState } from "react";
import { createProject, openProject, reloadForProject } from "./api.ts";
import { useFolderPicker } from "./FolderPicker.tsx";
import { baseName, projectFolder } from "./folders.ts";
import { BODIES, BODY_LABELS, type Body, type ProjectStatus } from "./schema.ts";

export function StartScreen({ status }: { status: ProjectStatus | null }) {
  const { pickFolder, dialog } = useFolderPicker();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      reloadForProject();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const openPicked = async () => {
    const path = await pickFolder({ title: "Open project", purpose: "open" });
    if (path) await run(() => openProject(path));
  };

  const recent = status?.recent ?? [];
  return (
    <div className="start-page">
      <header className="start-head">
        <h2>Open a project</h2>
        <p className="muted">
          A project is one folder with your layouts, measurements, images and exports. Nothing leaves this
          computer.
        </p>
      </header>
      {status?.problem && <p className="notice warn">{status.problem}</p>}
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      <div className="start-grid">
        <section className="panel start-card" aria-label="New project">
          <h2>New project</h2>
          <NewProjectForm
            busy={busy}
            pickFolder={pickFolder}
            onCreate={(fields) => run(() => createProject(fields))}
          />
        </section>
        <div className="start-side">
          <section className="panel start-card" aria-label="Open project">
            <h2>Open project</h2>
            <p className="muted small">Choose a folder you used with the planner before.</p>
            <button type="button" onClick={() => void openPicked()} disabled={busy}>
              Choose folder…
            </button>
          </section>
          <section className="panel start-card" aria-label="Sample project">
            <h2>Sample project</h2>
            <p className="muted small">Coming soon: a ready-made project to try the planner with.</p>
            <button type="button" disabled>
              Open sample project
            </button>
          </section>
          {recent.length > 0 && (
            <section className="panel start-card" aria-label="Recent projects">
              <h2>Recent</h2>
              <ul className="start-recent">
                {recent.map((r) => (
                  <li key={r.path}>
                    <button
                      type="button"
                      className="ghost"
                      disabled={busy || !r.available}
                      title={r.available ? r.path : `Not available: ${r.path}`}
                      onClick={() => void run(() => openProject(r.path))}
                    >
                      <span className="start-recent-name">{r.name ?? baseName(r.path)}</span>
                      <span className="faint start-recent-path">
                        {r.available ? r.path : "not available"}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
      {dialog}
    </div>
  );
}

type NewFields = { path: string; name: string; body: Body };

export function NewProjectForm(props: {
  busy: boolean;
  pickFolder: ReturnType<typeof useFolderPicker>["pickFolder"];
  onCreate: (fields: NewFields) => void;
}) {
  const [name, setName] = useState("");
  const [body, setBody] = useState<Body | null>(null);
  const [location, setLocation] = useState<string | null>(null);
  const [folder, setFolder] = useState<string | null>(null);
  const folderName = folder ?? name;
  const target = location ? projectFolder(location, folderName) : null;
  const ready = !!name.trim() && !!body && !!target && !props.busy;

  return (
    <form
      className="start-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) props.onCreate({ path: target!, name: name.trim(), body: body! });
      }}
    >
      <label className="field">
        <span>Name</span>
        <input
          type="text"
          value={name}
          maxLength={80}
          placeholder="My sleeve"
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <div className="field">
        <span id="new-body-label">Body</span>
        <div className="segmented" role="group" aria-labelledby="new-body-label">
          {BODIES.map((b) => (
            <button key={b} type="button" aria-pressed={body === b} onClick={() => setBody(b)}>
              {BODY_LABELS[b]}
            </button>
          ))}
        </div>
        <p className="field-hint">
          The sample body the project starts from; your own measurements refine it.
        </p>
      </div>
      <div className="field">
        <span>Location</span>
        <div className="start-location">
          <code className="start-path">{location ?? "No folder chosen"}</code>
          <button
            type="button"
            onClick={() =>
              void props
                .pickFolder({ title: "Where should the project go?", purpose: "create" })
                .then((p) => p && setLocation(p))
            }
          >
            Choose…
          </button>
        </div>
      </div>
      <div className="field">
        <label htmlFor="new-folder-name">Folder name</label>
        <input
          id="new-folder-name"
          type="text"
          value={folderName}
          placeholder="(use the chosen folder itself)"
          onChange={(e) => setFolder(e.target.value)}
        />
        <p className="field-hint">
          {target ? (
            <>
              The project goes into <code>{target}</code>
            </>
          ) : (
            "A new folder inside the location, or leave empty to use an empty location folder itself."
          )}
        </p>
      </div>
      <div className="toolbar">
        <button type="submit" className="primary" disabled={!ready}>
          {props.busy ? "Creating…" : "Create project"}
        </button>
      </div>
    </form>
  );
}

/** Shown when the planner's server does not answer at all. */
export function NoServer({ message }: { message: string }) {
  return (
    <div className="empty">
      <h2>The planner's server does not answer</h2>
      <p>{message}. Restart the planner and reload this page.</p>
    </div>
  );
}
