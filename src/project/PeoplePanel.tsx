// Settings → Project → People (docs/adr/0017-persons.md): rename a person, change their sample body,
// show them, remove them (their folder goes to the system trash) or add someone.
import { useState } from "react";
import { Popover } from "../ui/Popover.tsx";
import { removePerson, reloadDiscardingChanges } from "./api.ts";
import { AddPersonForm, PersonAvatar, switchPerson } from "./PersonSwitcher.tsx";
import type { PersonInfo } from "./persons.ts";
import { editPerson, takePersons, usePersons } from "./personsStore.ts";
import { BODIES, BODY_LABELS, type Body } from "./schema.ts";

export function PeoplePanel({ readOnly }: { readOnly: boolean }) {
  const { persons, current } = usePersons();
  const [adding, setAdding] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  if (persons.length === 0 || !current) return null;
  return (
    <section className="df-panel people-panel" aria-label="People">
      <div className="df-panel-head">
        <h2 className="float-title">People</h2>
        <span className="faint small">Each with own body, measurements and layouts; images are shared</span>
      </div>
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
          <button type="button" onClick={() => setAdding(true)}>
            Add person…
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

  return (
    <li className={`people-row-item${current ? " current" : ""}`}>
      <PersonAvatar person={p} />
      <form
        className="people-fields"
        onSubmit={(e) => {
          e.preventDefault();
          if (!changed) return;
          void run(async () => {
            await editPerson(p.id, patch);
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
            disabled={readOnly}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <div className="pj-field">
          <span id={`body-${p.id}`}>Body</span>
          <div className="segmented" role="group" aria-labelledby={`body-${p.id}`}>
            {BODIES.map((b) => (
              <button
                key={b}
                type="button"
                aria-pressed={body === b}
                disabled={readOnly}
                onClick={() => setBody(b)}
              >
                {BODY_LABELS[b]}
              </button>
            ))}
          </div>
        </div>
        <div className="people-actions">
          {changed && (
            <button type="submit" className="primary" disabled={busy}>
              Save
            </button>
          )}
          {current ? (
            <span className="chip ok">shown</span>
          ) : (
            <button type="button" disabled={busy} onClick={() => void run(() => switchPerson(p.id))}>
              Show
            </button>
          )}
          {!p.root && !readOnly && (
            <span className="popover-anchor">
              <button
                type="button"
                className="ghost danger-text"
                disabled={busy}
                aria-expanded={confirming}
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
                  Their folder <code>{p.folder}/</code> (layouts, measurements, projections, photos) moves to
                  the trash, where you can restore it. The shared images stay.
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
      </form>
      {p.root && <p className="faint small people-root-note">Data in the project folder itself</p>}
      {error && <p className="field-hint error">{error}</p>}
    </li>
  );
}
