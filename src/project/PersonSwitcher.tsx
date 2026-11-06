// Whose body the planner shows (docs/adr/0017-persons.md): avatars, the person menu in the top bar
// and the "Add person" form. Switching or adding a person reloads the page, because every tab shows
// that person's data; unsaved edits are named first, so nothing is lost silently.
import { useState, type CSSProperties } from "react";
import { Popover } from "../ui/Popover.tsx";
import { PlusIcon } from "../ui/icons.tsx";
import { addPerson, reloadDiscardingChanges, selectPerson } from "./api.ts";
import { initials, personHue, type PersonInfo } from "./persons.ts";
import { usePersons } from "./personsStore.ts";
import { projectStatus } from "./projectData.ts";
import { BODIES, BODY_LABELS, type Body } from "./schema.ts";

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

/** "Female body · 168 cm" */
export function bodyLine(p: PersonInfo): string {
  const body = p.body ? `${BODY_LABELS[p.body]} body` : "Sample body";
  return p.height_cm ? `${body} · ${p.height_cm} cm` : body;
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

/**
 * The person chip in the top bar: who is shown, a list to switch, "Add person" and a link to
 * managing people. `unsaved` names the tabs that would lose edits on a switch.
 */
export function PersonMenu({ unsaved, onManage }: { unsaved: boolean; onManage: () => void }) {
  const { persons, current } = usePersons();
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [pending, setPending] = useState<PersonInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!current) return null;
  const sample = projectStatus?.sample === true;
  const close = () => {
    setOpen(false);
    setAdding(false);
    setPending(null);
    setError(null);
  };
  const go = (p: PersonInfo) => {
    if (p.id === current.id) return close();
    if (unsaved && pending?.id !== p.id) return setPending(p);
    switchPerson(p.id).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  };
  return (
    <span className="popover-anchor">
      <button
        type="button"
        className="person-chip"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => (open ? close() : setOpen(true))}
        title={`Showing ${current.name}'s body, layouts and measurements`}
      >
        <PersonAvatar person={current} size="sm" />
        <span className="person-chip-name">{current.name}</span>
        <span className="person-chip-caret" aria-hidden="true" />
      </button>
      <Popover open={open} onClose={close} label="People" align="end" className="person-popover">
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
            <p className="popover-title">People in this project</p>
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
                    {p.id === current.id && <span className="chip ok plain">shown</span>}
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
              <button
                type="button"
                className="link"
                onClick={() => {
                  close();
                  onManage();
                }}
              >
                Manage people
              </button>
            </div>
          </>
        )}
      </Popover>
    </span>
  );
}
