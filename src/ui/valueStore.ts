// A tiny external store for values that change on every pointer move (the editor's cursor readout).
// Only the component that reads it re-renders, not the page that owns it:
//
//   const [cursor] = useState(() => createValueStore<UV | null>(null));
//   cursor.set(p);                     // in a pointer handler
//   const p = useValue(cursor);        // in the status bar
import { useSyncExternalStore } from "react";

export type ValueStore<T> = {
  get: () => T;
  set: (value: T) => void;
  subscribe: (listener: () => void) => () => void;
};

export function createValueStore<T>(initial: T): ValueStore<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: (next) => {
      if (Object.is(next, value)) return;
      value = next;
      for (const l of listeners) l();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function useValue<T>(store: ValueStore<T>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
