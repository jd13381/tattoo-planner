// Undo and redo over the whole projection workspace (docs/adr/0024-projection-workspace.md, "Undo"):
// every change of the draft is one step, a drag is one step however many moves it has (a gesture),
// and a run of changes with the same key (typing a number, moving a slider) is one step. Esc during a
// gesture puts back the state from before it. Generic and pure; the workspace keeps one of these.

export type History<T> = {
  past: T[];
  present: T;
  future: T[];
  /** The state when the gesture in progress began, or null when none is. */
  anchor: T | null;
  /** Key of the last change, so the next one with the same key joins it; null = none. */
  key: string | null;
};

/** Steps kept; older ones drop off. */
export const HISTORY_LIMIT = 200;

export function historyOf<T>(present: T): History<T> {
  return { past: [], present, future: [], anchor: null, key: null };
}

const withPast = <T>(past: T[], state: T): T[] => [...past, state].slice(-HISTORY_LIMIT);

/**
 * A change. Without `key` it is a step of its own; with one, it joins the previous change when that
 * had the same key (one step for a typed number or a slider drag). During a gesture it only moves the
 * present; the gesture's end makes the step.
 */
export function commit<T>(h: History<T>, next: T, key?: string): History<T> {
  if (Object.is(next, h.present)) return h;
  if (h.anchor !== null) return { ...h, present: next };
  if (key !== undefined && key === h.key) return { ...h, present: next, future: [] };
  return { past: withPast(h.past, h.present), present: next, future: [], anchor: null, key: key ?? null };
}

/** Starts a gesture (a drag): the changes until `endGesture` become one step. */
export function beginGesture<T>(h: History<T>): History<T> {
  return h.anchor !== null ? h : { ...h, anchor: h.present, key: null };
}

/** Ends the gesture: one step when it changed anything, none otherwise. */
export function endGesture<T>(h: History<T>): History<T> {
  if (h.anchor === null) return h;
  if (Object.is(h.anchor, h.present)) return { ...h, anchor: null };
  return { past: withPast(h.past, h.anchor), present: h.present, future: [], anchor: null, key: null };
}

/** Cancels the gesture (Esc): back to the state before it, no step. */
export function cancelGesture<T>(h: History<T>): History<T> {
  if (h.anchor === null) return h;
  return { ...h, present: h.anchor, anchor: null };
}

export const canUndo = <T>(h: History<T>) => h.past.length > 0 || h.anchor !== null;
export const canRedo = <T>(h: History<T>) => h.future.length > 0;

/** One step back (a gesture in progress is cancelled first and counts as the step). */
export function undo<T>(h: History<T>): History<T> {
  if (h.anchor !== null) return cancelGesture(h);
  const prev = h.past.at(-1);
  if (prev === undefined) return h;
  return {
    past: h.past.slice(0, -1),
    present: prev,
    future: [h.present, ...h.future],
    anchor: null,
    key: null,
  };
}

export function redo<T>(h: History<T>): History<T> {
  if (h.anchor !== null) return h;
  const next = h.future[0];
  if (next === undefined) return h;
  return {
    past: withPast(h.past, h.present),
    present: next,
    future: h.future.slice(1),
    anchor: null,
    key: null,
  };
}

/**
 * Applies `f` to every state, past and future too, without a step: for what is not the user's edit
 * but belongs to every state (after a save, the saved file the draft now edits).
 */
export function mapHistory<T>(h: History<T>, f: (state: T) => T): History<T> {
  return {
    past: h.past.map(f),
    present: f(h.present),
    future: h.future.map(f),
    anchor: h.anchor === null ? null : f(h.anchor),
    key: h.key,
  };
}
