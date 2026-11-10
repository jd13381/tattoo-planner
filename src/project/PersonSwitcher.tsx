// Whose body the planner shows (docs/adr/0017-persons.md): avatars, the people and project menu in
// the top bar and the "Add person" form. Switching or adding a person reloads the page, because every tab shows
// that person's data; unsaved edits are named first, so nothing is lost silently.
import { useState, type CSSProperties } from "react";
import { Popover } from "../ui/Popover.tsx";
import { CheckIcon, FolderIcon, PlusIcon } from "../ui/icons.tsx";
import { tip } from "../ui/Tooltip.tsx";
import { addPerson, closeProject, reloadDiscardingChanges, reloadForProject, selectPerson } from "./api.ts";
import { initials, personHue, type PersonInfo } from "./persons.ts";
import { usePersons } from "./personsStore.ts";
import { BODIES, BODY_LABELS, type Body, type ProjectStatus } from "./schema.ts";

/** Round initials in the person's own hue (the hue is data; lightness comes from the theme). */
export function PersonAvatar({ person, size = "md" }: { person: PersonInfo; size?: "sm" | "md" | "lg" }) {
  return (
    <span
      className={`person-avatar ${size}`}
      style={{ "--person-hue": personHue(person.id) } as CSSProperties}
      aria-hidden="true"
    >
      {initials(person.name)}
    </span>
  );
}

/** "Female body · 168 cm" (without the height where room is short). */
export function bodyLine(p: PersonInfo, withHeight = true): string {
  const body = p.body ? `${BODY_LABELS[p.body]} body` : "Sample body";
  return withHeight && p.height_cm ? `${body} · ${p.height_cm} cm` : body;
}

/** Shows another person; with unsaved edits only after `confirmed`. */
export async function switchPerson(id: string): Promise<void> {
  await selectPerson(id);
  reloadDiscardingChanges();
}

export function AddPersonForm({ onCancel }: { onCancel?: () => void }) {
  const [name, setName] = useState("");
  const [body, setBody] = useState<Body | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = !!name.trim() && !!body && !busy;
  return (
    <form
      className="person-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!ready) return;
        setBusy(true);
        setError(null);
        addPerson({ name: name.trim(), body: body! })
          .then(() => reloadDiscardingChanges())
          .catch((err: unknown) => {
            setBusy(false);
            setError(err instanceof Error ? err.message : String(err));
          });
      }}
    >
      <label className="field">
        <span>Name</span>
        <input
          type="text"
          data-autofocus
          value={name}
          maxLength={60}
          placeholder="Xenia"
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <div className="field">
        <span id="person-body-label">Body</span>
        <div className="segmented" role="group" aria-labelledby="person-body-label">
          {BODIES.map((b) => (
            <button key={b} type="button" aria-pressed={body === b} onClick={() => setBody(b)}>
              {BODY_LABELS[b]}
            </button>
          ))}
        </div>
        <p className="field-hint">Their own measurements refine it later (Settings → Body).</p>
      </div>
      {error && <p className="field-hint error">{error}</p>}
      <div className="toolbar">
        <button type="submit" className="primary" disabled={!ready}>
          {busy ? "Adding…" : "Add person"}
        </button>
        {onCancel && (
          <button type="button" className="ghost" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

/** Why the project needs a look, as the tone of the dot on the chip; null when all is well. */
function projectTone(project: ProjectStatus): "error" | "warn" | null {
  return project.problem ? "error" : project.status === "legacy" ? "warn" : null;
}

/**
 * The one context control of the top bar: whose body is shown and in which project. Its panel names
 * the project (the sample says calmly that it is read-only), lists the people to switch to, and has
 * "Add person", "Manage people" and the way into the project's settings. `unsaved` names that edits
 * would be lost on a switch.
 */
export function PersonMenu(props: {
  project: ProjectStatus;
  unsaved: boolean;
  onManage: () => void;
  onOpenProject: () => void;
  /** Controlled from outside too: the command palette opens the panel. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { project, unsaved, onManage, onOpenProject, open, onOpenChange } = props;
  const { persons, current } = usePersons();
  const [adding, setAdding] = useState(false);
  const [pending, setPending] = useState<PersonInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!current) return null;
  const sample = project.sample;
  const tone = projectTone(project);
  const projectName = project.name ?? (sample ? "Sample project" : "Project");
  const close = () => {
    onOpenChange(false);
    setAdding(false);
    setPending(null);
    setError(null);
  };
  const fail = (e: unknown) => setError(e instanceof Error ? e.message : String(e));
  const go = (p: PersonInfo) => {
    if (p.id === current.id) return close();
    if (unsaved && pending?.id !== p.id) return setPending(p);
    switchPerson(p.id).catch(fail);
  };
  const leave = (then: () => void) => {
    close();
    then();
  };
  return (
    <span className="popover-anchor">
      <button
        type="button"
        className="person-chip ctx-chip"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`${current.name}, ${projectName}${sample ? " (read-only)" : ""}: people and project`}
        onClick={() => (open ? close() : onOpenChange(true))}
        {...(open ? {} : tip(`${current.name} · ${projectName}`))}
      >
        <PersonAvatar person={current} size="sm" />
        <span className="person-chip-name">{current.name}</span>
        <span className={`ctx-chip-project${tone ? ` ${tone}` : ""}`}>{sample ? "Sample" : projectName}</span>
        <span className="person-chip-caret" aria-hidden="true" />
      </button>
      <Popover open={open} onClose={close} label="People and project" align="end" className="person-popover">
        {adding ? (
          <>
            <p className="popover-title">Add a person</p>
            <p className="muted small">
              They get their own body, measurements and layouts; the image library stays shared.
            </p>
            <AddPersonForm onCancel={() => setAdding(false)} />
          </>
        ) : (
          <>
            <div className="ctx-project">
              <span className="ctx-project-icon" aria-hidden="true">
                <FolderIcon />
              </span>
              <span className="ctx-project-text">
                <span className="ctx-project-name">{projectName}</span>
                <span className="ctx-project-meta">
                  {sample
                    ? "Read-only. Nothing you change here is saved."
                    : (project.problem ??
                      (project.status === "legacy"
                        ? "Older data folder. Open the settings to move it into a project."
                        : (project.path ?? "")))}
                </span>
              </span>
              <button
                type="button"
                className="ghost small-button"
                onClick={() => leave(onOpenProject)}
                {...tip("Project settings")}
              >
                Settings
              </button>
            </div>
            {sample && (
              <div className="ctx-sample-actions">
                <button type="button" className="small-button" onClick={() => leave(onOpenProject)}>
                  Save as my project…
                </button>
                <button
                  type="button"
                  className="ghost small-button"
                  onClick={() => void closeProject().then(reloadForProject).catch(fail)}
                >
                  Leave the sample
                </button>
              </div>
            )}
            <p className="section-label ctx-section">People</p>
            <ul className="person-list" role="list">
              {persons.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    className={`person-row${p.id === current.id ? " current" : ""}`}
                    aria-current={p.id === current.id ? "true" : undefined}
                    data-autofocus={p.id === current.id ? true : undefined}
                    onClick={() => go(p)}
                  >
                    <PersonAvatar person={p} />
                    <span className="person-row-text">
                      <span className="person-row-name">{p.name}</span>
                      <span className="faint small">{bodyLine(p)}</span>
                    </span>
                    {p.id === current.id && (
                      <span className="ctx-current" role="img" aria-label="shown now">
                        <CheckIcon />
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
            {pending && (
              <div className="notice warn person-pending" role="alert">
                <p>Unsaved changes will be lost when you switch to {pending.name}.</p>
                <div className="toolbar">
                  <button type="button" className="danger" onClick={() => go(pending)}>
                    Discard and switch
                  </button>
                  <button type="button" className="ghost" onClick={() => setPending(null)}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
            {error && <p className="field-hint error">{error}</p>}
            <div className="person-menu-actions">
              <button
                type="button"
                className="ghost"
                onClick={() => setAdding(true)}
                disabled={sample}
                title={sample ? "The sample is read-only" : undefined}
              >
                <PlusIcon /> Add person
              </button>
              <button type="button" className="link" onClick={() => leave(onManage)}>
                Manage people
              </button>
            </div>
          </>
        )}
      </Popover>
    </span>
  );
}
