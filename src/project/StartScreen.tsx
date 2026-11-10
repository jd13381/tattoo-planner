// The start screen when no project is open (docs/adr/0012-project-folder.md): a welcome with three
// ways in (the sample, a new project, an existing one) and the recent projects. Opening or creating
// reloads the page. Also the "New project" dialog, which Settings → Project reuses for "Save as new
// project".
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { browseFolders, createProject, openProject, openSample, reloadForProject } from "./api.ts";
import { FolderGlyph, Modal, useFolderPicker } from "./FolderPicker.tsx";
import { baseName, folderNameFor, projectFolder } from "./folders.ts";
import { BODIES, BODY_LABELS, type Body, type BrowseListing, type ProjectStatus } from "./schema.ts";
import {
  DEFAULT_PROJECT_NAME,
  defaultLocation,
  folderClash,
  missingForCreate,
  parentPath,
  shortPath,
} from "./startForm.ts";

type Busy = "sample" | "new" | "open" | string | null;

export function StartScreen({ status }: { status: ProjectStatus | null }) {
  const { pickFolder, dialog } = useFolderPicker();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [creating, setCreating] = useState(false);
  const [home, setHome] = useState<string | null>(null);

  // The home folder, to show recent projects as ~/… paths.
  useEffect(() => {
    if (!status?.recent.length || status.locked) return;
    let live = true;
    browseFolders().then(
      (l) => live && setHome(l.home),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [status]);

  const run = async (key: Busy, action: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await action();
      reloadForProject();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  };

  const openPicked = async () => {
    const path = await pickFolder({ title: "Open a project", purpose: "open" });
    if (path) await run("open", () => openProject(path));
  };

  const recent = status?.recent ?? [];
  // A planner started with a fixed folder (TATTOO_DATA_DIR) cannot open or create another one.
  const locked = status?.locked ?? false;
  const sampleOk = status?.sampleAvailable ?? false;
  const firstRun = recent.length === 0;
  const anyBusy = busy !== null;

  return (
    <div className="ws-page">
      <section className="ws-hero" aria-labelledby="ws-title">
        <div className="ws-intro">
          <p className="ws-eyebrow">
            <LockGlyph />
            Local and private: your projects stay on this computer
          </p>
          <h2 id="ws-title" className="ws-title">
            Plan your tattoo on a 3D body
          </h2>
          <p className="ws-lead">
            Sketch ideas on a flat sheet, watch them wrap around the body as you draw, and take a clear brief
            to your tattoo artist.
          </p>

          {(status?.problem || locked || (error && !creating)) && (
            <div className="ws-notices">
              {status?.problem && <p className="notice warn">{status.problem}</p>}
              {locked && (
                <p className="notice">
                  This planner is set up to always open one folder, so other projects cannot be opened here.
                </p>
              )}
              {error && !creating && (
                <p className="notice error" role="alert">
                  {error}
                </p>
              )}
            </div>
          )}

          <ul className="ws-actions" aria-label="Get started">
            <li>
              <ActionRow
                featured={firstRun && sampleOk}
                badge={firstRun && sampleOk ? "Start here" : undefined}
                icon={<SparkGlyph />}
                title="Explore the sample"
                text={
                  sampleOk
                    ? "Two people with placeholder motifs, ready to try out."
                    : "The sample is not part of this installation."
                }
                busyText={busy === "sample" ? "Opening the sample…" : null}
                disabled={anyBusy || !sampleOk}
                onClick={() => void run("sample", openSample)}
              />
            </li>
            <li>
              <ActionRow
                icon={<PlusGlyph />}
                title="New project"
                text="Start from an empty project for one person's body."
                disabled={anyBusy || locked}
                onClick={() => {
                  setError(null);
                  setCreating(true);
                }}
              />
            </li>
            <li>
              <ActionRow
                icon={<FolderGlyph />}
                title="Open a project…"
                text="Choose a project folder you made before."
                busyText={busy === "open" ? "Opening…" : null}
                disabled={anyBusy || locked}
                onClick={() => void openPicked()}
              />
            </li>
          </ul>

          {recent.length > 0 && (
            <section className="ws-recent" aria-labelledby="ws-recent-title">
              <h2 id="ws-recent-title" className="ws-section-title">
                Recent projects
              </h2>
              <ul className="ws-recent-list">
                {recent.map((r) => {
                  const name = r.name ?? baseName(r.path);
                  const key = `recent:${r.path}`;
                  return (
                    <li key={r.path}>
                      <button
                        type="button"
                        className={`ws-recent-row${r.available ? "" : " missing"}`}
                        disabled={anyBusy || locked || !r.available}
                        title={r.available ? r.path : `Not found: ${r.path}`}
                        onClick={() => void run(key, () => openProject(r.path))}
                      >
                        <span className="ws-recent-tile" aria-hidden="true">
                          {initialOf(name)}
                        </span>
                        <span className="ws-recent-text">
                          <span className="ws-recent-name">{name}</span>
                          <span className="ws-recent-path">{shortPath(parentPath(r.path), home)}</span>
                        </span>
                        {busy === key ? (
                          <span className="ws-recent-state">Opening…</span>
                        ) : r.available ? (
                          <span className="ws-recent-go" aria-hidden="true">
                            Open
                            <ArrowGlyph />
                          </span>
                        ) : (
                          <span className="chip warn">Not found</span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </div>
        <div className="ws-visual" aria-hidden="true">
          <StartIllustration />
        </div>
      </section>

      {creating && (
        <NewProjectDialog
          title="New project"
          subtitle="A project is one folder with your layouts, measurements, images and exports."
          busy={busy === "new"}
          error={error}
          pickFolder={pickFolder}
          onClose={() => {
            setCreating(false);
            setError(null);
          }}
          onCreate={(fields) => void run("new", () => createProject(fields))}
        />
      )}
      {dialog}
    </div>
  );
}

function ActionRow(props: {
  icon: ReactNode;
  title: string;
  text: string;
  onClick: () => void;
  disabled?: boolean;
  featured?: boolean;
  badge?: string;
  busyText?: string | null;
}) {
  return (
    <button
      type="button"
      className={`ws-action${props.featured ? " featured" : ""}`}
      disabled={props.disabled}
      onClick={props.onClick}
      aria-busy={props.busyText ? true : undefined}
    >
      <span className="ws-action-icon" aria-hidden="true">
        {props.icon}
      </span>
      <span className="ws-action-text">
        <span className="ws-action-title">
          {props.title}
          {props.badge && <span className="ws-badge">{props.badge}</span>}
        </span>
        <span className="ws-action-sub">{props.busyText ?? props.text}</span>
      </span>
      <span className="ws-action-go" aria-hidden="true">
        <ArrowGlyph />
      </span>
    </button>
  );
}

type NewFields = { path: string; name: string; body: Body };

type FormProps = {
  busy: boolean;
  disabled?: boolean;
  pickFolder: ReturnType<typeof useFolderPicker>["pickFolder"];
  onCreate: (fields: NewFields) => void;
  onCancel?: () => void;
  /** Start values, e.g. when saving the sample as a new project. */
  initialName?: string;
  initialBody?: Body | null;
  submitLabel?: string;
  busyLabel?: string;
  /** The server's answer to the last attempt. */
  error?: string | null;
};

/** The new-project form in a dialog (start screen: New project; Settings: Save as new project). */
export function NewProjectDialog(
  props: FormProps & { title: string; subtitle?: ReactNode; onClose: () => void },
) {
  const { title, subtitle, onClose, ...form } = props;
  return (
    <Modal title={title} subtitle={subtitle} onClose={onClose} className="np-dialog" busy={props.busy}>
      <NewProjectForm {...form} onCancel={onClose} />
    </Modal>
  );
}

export function NewProjectForm(props: FormProps) {
  const [name, setName] = useState(props.initialName ?? DEFAULT_PROJECT_NAME);
  const [body, setBody] = useState<Body | null>(props.initialBody ?? null);
  const [location, setLocation] = useState<string | null>(null);
  const [home, setHome] = useState<string | null>(null);
  const [inLocation, setInLocation] = useState<BrowseListing | null>(null);
  const [folder, setFolder] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const statusId = useId();
  const bodyLabel = useId();
  const folderId = useId();

  // A sensible place to start: Documents in the home folder (the server lists only the home folder).
  useEffect(() => {
    nameRef.current?.select();
    if (props.disabled) return;
    let live = true;
    browseFolders().then(
      (l) => {
        if (!live) return;
        setHome(l.home);
        setLocation((cur) => cur ?? defaultLocation(l));
      },
      () => {
        // No listing: the user chooses the location by hand.
      },
    );
    return () => {
      live = false;
    };
  }, [props.disabled]);

  // What is in the location already, to warn before the server refuses a taken folder.
  useEffect(() => {
    if (!location) return;
    let live = true;
    browseFolders(location).then(
      (l) => live && setInLocation(l),
      () => live && setInLocation(null),
    );
    return () => {
      live = false;
    };
  }, [location]);

  const folderName = folder ?? folderNameFor(name);
  const target = location ? projectFolder(location, folderName) : null;
  const clash = inLocation?.path === location ? folderClash(inLocation, folderName) : null;
  const missing = missingForCreate({ name, body, location, clash });
  const ready = !missing && !props.busy && !props.disabled;
  const usesLocationItself = !!location && !folderNameFor(folderName);
  // Without a name there is nothing to preview, unless the folder name was edited on purpose.
  const showPreview = !!location && (folder !== null || !!folderNameFor(name));

  const chooseLocation = () =>
    void props
      .pickFolder({ title: "Where should the project go?", purpose: "create" }, location)
      .then((p) => p && setLocation(p));

  return (
    <form
      className="np-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) props.onCreate({ path: target!, name: name.trim(), body: body! });
      }}
    >
      <div className="np-fields">
        <label className="np-field">
          <span className="np-label">Name</span>
          <input
            ref={nameRef}
            type="text"
            value={name}
            maxLength={80}
            placeholder={DEFAULT_PROJECT_NAME}
            data-autofocus
            onChange={(e) => setName(e.target.value)}
          />
        </label>

        <div className="np-field">
          <span className="np-label" id={bodyLabel}>
            Body
          </span>
          <div className="segmented np-seg" role="group" aria-labelledby={bodyLabel}>
            {BODIES.map((b) => (
              <button key={b} type="button" aria-pressed={body === b} onClick={() => setBody(b)}>
                {BODY_LABELS[b]}
              </button>
            ))}
          </div>
          <p className="np-hint">The starting shape. Your own measurements refine it later.</p>
        </div>

        <div className="np-field">
          <span className="np-label">Location</span>
          <button
            type="button"
            className="np-location"
            onClick={chooseLocation}
            disabled={props.disabled}
            aria-label={location ? `Location: ${shortPath(location, home)}. Change…` : "Choose a location"}
            title={location ?? undefined}
          >
            <span className="np-location-icon" aria-hidden="true">
              <FolderGlyph />
            </span>
            <span className={`np-location-path${location ? "" : " empty"}`}>
              {location ? shortPath(location, home) : "Choose a folder"}
            </span>
            <span className="np-location-action">{location ? "Change…" : "Choose…"}</span>
          </button>
        </div>

        {location && showPreview && (
          <div className="np-preview">
            {renaming ? (
              <label className="np-field">
                <span className="np-label" id={folderId}>
                  Folder name
                </span>
                <input
                  type="text"
                  value={folderName}
                  aria-labelledby={folderId}
                  placeholder="Leave empty to use the location itself"
                  onChange={(e) => setFolder(e.target.value)}
                />
              </label>
            ) : null}
            <p className="np-target">
              {usesLocationItself ? (
                <>
                  Uses <code>{shortPath(location, home)}</code> itself; it must be empty.
                </>
              ) : (
                <>
                  Will be created at{" "}
                  <code title={target ?? undefined}>{shortPath(target ?? location, home)}</code>
                </>
              )}
              {!renaming && (
                <button type="button" className="link np-rename" onClick={() => setRenaming(true)}>
                  Rename folder
                </button>
              )}
            </p>
            {clash && (
              <p className={`np-clash${clash.blocking ? " blocking" : ""}`} role="status">
                {clash.message}
              </p>
            )}
          </div>
        )}
      </div>

      {props.error && (
        <p className="notice error np-error" role="alert">
          {props.error}
        </p>
      )}

      <div className="md-foot np-foot">
        <span className="np-status" id={statusId} aria-live="polite">
          {props.busy ? "" : missing && !clash?.blocking ? missing : ""}
        </span>
        {props.onCancel && (
          <button type="button" className="ghost" onClick={props.onCancel} disabled={props.busy}>
            Cancel
          </button>
        )}
        <button
          type="submit"
          className="primary"
          disabled={!ready}
          aria-describedby={missing ? statusId : undefined}
        >
          {props.busy ? (props.busyLabel ?? "Creating…") : (props.submitLabel ?? "Create project")}
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

function initialOf(name: string): string {
  return (name.trim()[0] ?? "?").toUpperCase();
}

/**
 * The welcome visual: a flat unwrap sheet with two motifs and the red line, mapped onto the arm of
 * a simple body, drawn with the canvas tokens (skin, figure, red) so it follows the theme.
 */
function StartIllustration() {
  return (
    <svg className="ws-art" viewBox="0 0 440 400" role="presentation" focusable="false">
      <ellipse className="ws-art-floor" cx="150" cy="372" rx="78" ry="10" />
      <g className="ws-art-body">
        <ellipse cx="150" cy="58" rx="19" ry="23" />
        <rect x="141" y="76" width="18" height="20" rx="7" />
        <path d="M116 100 Q150 90 184 100 Q194 104 192 122 L178 196 Q175 214 182 238 L118 238 Q125 214 122 196 L108 122 Q106 104 116 100 Z" />
        <polyline className="ws-art-limb" points="111,110 96,188" strokeWidth="19" />
        <polyline className="ws-art-limb" points="96,188 88,262" strokeWidth="15" />
        <circle cx="87" cy="274" r="8.5" />
        <polyline className="ws-art-limb" points="189,110 204,188" strokeWidth="19" />
        <polyline className="ws-art-limb" points="204,188 212,262" strokeWidth="15" />
        <circle cx="213" cy="274" r="8.5" />
        <polyline className="ws-art-limb" points="136,232 132,300 131,358" strokeWidth="25" />
        <polyline className="ws-art-limb" points="164,232 168,300 169,358" strokeWidth="25" />
      </g>
      <g className="ws-art-motif">
        <ellipse cx="198" cy="150" rx="4.6" ry="13" transform="rotate(-11 198 150)" />
        <ellipse cx="209" cy="228" rx="4" ry="14" transform="rotate(-6 209 228)" />
      </g>
      <polyline className="ws-art-red" points="194,116 208,188 216,256" />

      <path className="ws-art-link" d="M272 206 C 252 206, 246 222, 226 224" />
      <circle className="ws-art-link-dot" cx="224" cy="224" r="3" />

      <g className="ws-art-sheet" transform="rotate(-4 345 205)">
        <rect className="ws-art-paper" x="272" y="96" width="146" height="218" rx="8" />
        <g className="ws-art-grid">
          <path d="M272 140 H418 M272 184 H418 M272 228 H418 M272 272 H418" />
          <path d="M308 96 V314 M345 96 V314 M382 96 V314" />
        </g>
        <g className="ws-art-motif">
          <ellipse cx="322" cy="152" rx="15" ry="30" />
          <ellipse cx="364" cy="246" rx="13" ry="34" />
          <circle cx="388" cy="140" r="7" />
        </g>
        <path className="ws-art-red" d="M345 102 C 340 160, 352 220, 345 308" />
      </g>
      <text className="ws-art-label" x="150" y="398" textAnchor="middle">
        3D body
      </text>
      <text className="ws-art-label" x="345" y="338" textAnchor="middle">
        Unwrap sheet
      </text>
    </svg>
  );
}

const glyph = {
  width: 18,
  height: 18,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  focusable: false,
};

function SparkGlyph() {
  return (
    <svg {...glyph}>
      <path d="M12 3.5l1.9 5.2 5.1 1.9-5.1 1.9L12 17.7l-1.9-5.2L5 10.6l5.1-1.9z" />
      <path d="M18.5 16.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" />
    </svg>
  );
}

function PlusGlyph() {
  return (
    <svg {...glyph}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function ArrowGlyph() {
  return (
    <svg {...glyph} width={14} height={14}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

function LockGlyph() {
  return (
    <svg {...glyph} width={13} height={13}>
      <rect x="5" y="10.5" width="14" height="10" rx="2" />
      <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
    </svg>
  );
}
