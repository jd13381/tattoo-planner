// Undo/redo history of editor snapshots (e.g. Layout values). Pure: every operation returns a new
// history and never mutates its input, so it fits React state directly.
//
// Coalescing: consecutive pushes with the same coalesceKey replace the newest entry instead of
// adding one, so a whole drag (many onChange calls) becomes one undo step. Give each drag its own
// key (e.g. `drag-${n}`) and call `seal` on pointer-up so the next drag on the same key starts a new step.

export const DEFAULT_HISTORY_CAP = 100;

export type History<T> = {
  /** Older snapshots, oldest first. */
  readonly past: readonly T[];
  readonly present: T;
  /** Undone snapshots, the next one to redo first. */
  readonly future: readonly T[];
  /** Key of the push that produced `present`, while further pushes with it may coalesce. */
  readonly coalesceKey: string | null;
  /** Maximum number of undo steps kept. */
  readonly cap: number;
};

export type PushOptions = { coalesceKey?: string };

export function createHistory<T>(initial: T, cap = DEFAULT_HISTORY_CAP): History<T> {
  return { past: [], present: initial, future: [], coalesceKey: null, cap: Math.max(1, Math.floor(cap)) };
}

/** Records a new present. A push of the identical value is a no-op; any push clears the redo stack. */
export function push<T>(h: History<T>, state: T, opts: PushOptions = {}): History<T> {
  if (Object.is(state, h.present)) return h;
  const key = opts.coalesceKey ?? null;
  if (key !== null && key === h.coalesceKey) {
    return { ...h, present: state, future: [] };
  }
  const past = [...h.past, h.present];
  return {
    ...h,
    past: past.length > h.cap ? past.slice(past.length - h.cap) : past,
    present: state,
    future: [],
    coalesceKey: key,
  };
}

/** Ends coalescing, so the next push always starts a new undo step (call on pointer-up). */
export function seal<T>(h: History<T>): History<T> {
  return h.coalesceKey === null ? h : { ...h, coalesceKey: null };
}

export function canUndo<T>(h: History<T>): boolean {
  return h.past.length > 0;
}

export function canRedo<T>(h: History<T>): boolean {
  return h.future.length > 0;
}

export function undo<T>(h: History<T>): History<T> {
  if (h.past.length === 0) return h;
  return {
    ...h,
    past: h.past.slice(0, -1),
    present: h.past[h.past.length - 1]!,
    future: [h.present, ...h.future],
    coalesceKey: null,
  };
}

export function redo<T>(h: History<T>): History<T> {
  if (h.future.length === 0) return h;
  return {
    ...h,
    past: [...h.past, h.present],
    present: h.future[0]!,
    future: h.future.slice(1),
    coalesceKey: null,
  };
}

/** Starts over from `state` with empty undo and redo stacks (a variant was loaded or saved). */
export function reset<T>(h: History<T>, state: T): History<T> {
  return createHistory(state, h.cap);
}
