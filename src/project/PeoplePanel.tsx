// Settings → Project → People (docs/adr/0017-persons.md): who is in the project and who is being
// viewed; switch to someone, rename them or change their starting body, remove them (their folder
// goes to the system trash) or add someone.
import { useState } from "react";
import { Popover } from "../ui/Popover.tsx";
import { removePerson, reloadDiscardingChanges } from "./api.ts";
import { AddPersonForm, bodyLine, PersonAvatar, switchPerson } from "./PersonSwitcher.tsx";
import type { PersonInfo } from "./persons.ts";
import { editPerson, takePersons, usePersons } from "./personsStore.ts";
import { BODIES, BODY_LABELS, type Body } from "./schema.ts";

export function PeoplePanel({ readOnly }: { readOnly: boolean }) {
  const { persons, current } = usePersons();
  const [adding, setAdding] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  if (persons.length === 0 || !current) return null;
  return (
    <section className="df-panel people-panel" aria-labelledby="pp-title">
      <div className="df-panel-head">
        <h2 className="float-title" id="pp-title">
          People
        </h2>
        <span className="pp-count faint">{persons.length}</span>
      </div>
      <p className="pp-intro">
        Each person has their own body, measurements and layouts. Images are shared by everyone.
      </p>
      <ul className="people-list" role="list">
        {persons.map((p) => (
          <PersonRow
            key={p.id}
            person={p}
            current={p.id === current.id}
            readOnly={readOnly}
            onNote={setNote}
          />
        ))}
      </ul>
      {note && (
        <p className="notice ok" role="status">
          {note}
        </p>
      )}
      {!readOnly &&
        (adding ? (
          <div className="people-add">
            <AddPersonForm onCancel={() => setAdding(false)} />
          </div>
        ) : (
          <button type="button" className="pp-add" onClick={() => setAdding(true)}>
            <span aria-hidden="true">+</span> Add person
          </button>
        ))}
    </section>
  );
}

function PersonRow(props: {
  person: PersonInfo;
  current: boolean;
  readOnly: boolean;
  onNote: (s: string | null) => void;
}) {
  const { person: p, current, readOnly } = props;
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(p.name);
  const [body, setBody] = useState<Body | null>(p.body);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const patch: { name?: string; body?: Body } = {};
  if (name.trim() && name.trim() !== p.name) patch.name = name.trim();
  if (body && body !== p.body) patch.body = body;
  const changed = Object.keys(patch).length > 0;

  const run = async (fn: () => Promise<void>) => {
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

  const cancelEdit = () => {
    setEditing(false);
    setName(p.name);
    setBody(p.body);
    setError(null);
  };

  return (
    <li className={`people-row-item${current ? " current" : ""}`}>
      <PersonAvatar person={p} />
      {editing ? (
        <form
          className="people-fields"
          aria-label={`Edit ${p.name}`}
          onSubmit={(e) => {
            e.preventDefault();
            if (!changed) return cancelEdit();
            void run(async () => {
              await editPerson(p.id, patch);
              setEditing(false);
              // The shown person's body is built when the page loads.
              if (current && patch.body) reloadDiscardingChanges();
            });
          }}
        >
          <label className="pj-field">
            <span>Name</span>
            <input
              type="text"
              value={name}
              maxLength={60}
              autoFocus
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && cancelEdit()}
            />
          </label>
          <div className="pj-field">
            <span id={`body-${p.id}`}>Body</span>
            <div className="segmented" role="group" aria-labelledby={`body-${p.id}`}>
              {BODIES.map((b) => (
                <button key={b} type="button" aria-pressed={body === b} onClick={() => setBody(b)}>
                  {BODY_LABELS[b]}
                </button>
              ))}
            </div>
          </div>
          <div className="people-actions">
            <button type="button" className="ghost" onClick={cancelEdit} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="primary" disabled={busy || !name.trim()}>
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      ) : (
        <div className="pp-row">
          <div className="pp-who">
            <span className="pp-name">
              {p.name}
              {p.root && (
                <span className="pp-tag" title="Their data is in the project folder itself">
                  Main person
                </span>
              )}
            </span>
            <span className="pp-body">{bodyLine(p)}</span>
          </div>
          <div className="people-actions">
            {current ? (
              <span className="pp-viewing">
                <span className="pp-viewing-dot" aria-hidden="true" />
                Viewing
              </span>
            ) : (
              <button type="button" disabled={busy} onClick={() => void run(() => switchPerson(p.id))}>
                {busy ? "Switching…" : `Switch to ${p.name}`}
              </button>
            )}
            {!readOnly && (
              <button
                type="button"
                className="ghost"
                onClick={() => setEditing(true)}
                disabled={busy}
                aria-label={`Edit ${p.name}`}
              >
                Edit
              </button>
            )}
            {!p.root && !readOnly && (
              <span className="popover-anchor">
                <button
                  type="button"
                  className="ghost danger-text"
                  disabled={busy}
                  aria-expanded={confirming}
                  aria-label={`Remove ${p.name}…`}
                  onClick={() => setConfirming((c) => !c)}
                >
                  Remove…
                </button>
                <Popover
                  open={confirming}
                  onClose={() => setConfirming(false)}
                  label={`Remove ${p.name}`}
                  align="end"
                >
                  <p className="popover-title">Remove {p.name}?</p>
                  <p className="muted small">
                    {p.name}&apos;s folder <code>{p.folder}/</code> with their layouts, measurements,
                    projections and photos moves to the system trash, where you can restore it. Shared images
                    stay in the project.
                  </p>
                  <div className="toolbar">
                    <button
                      type="button"
                      className="danger"
                      onClick={() =>
                        void run(async () => {
                          setConfirming(false);
                          const r = await removePerson(p.id);
                          props.onNote(
                            r.movedTo
                              ? `${p.name}'s folder is in the trash: ${r.movedTo}`
                              : `${p.name} removed.`,
                          );
                          // The shown person goes back to the first one: every tab reloads.
                          if (current) reloadDiscardingChanges();
                          else takePersons(r.project);
                        })
                      }
                    >
                      Move to trash
                    </button>
                    <button type="button" className="ghost" onClick={() => setConfirming(false)}>
                      Cancel
                    </button>
                  </div>
                </Popover>
              </span>
            )}
          </div>
        </div>
      )}
      {error && <p className="field-hint error">{error}</p>}
    </li>
  );
}
