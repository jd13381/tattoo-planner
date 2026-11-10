// Small per-viewer view preferences of the Layout tab (which panels are open), kept in localStorage.
// Storage can be missing or blocked (private windows, tests): every access falls back quietly.

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** A stored on/off preference; `fallback` when nothing (or nothing readable) is stored. */
export function readFlag(key: string, fallback: boolean, store: Storage | null = storage()): boolean {
  try {
    const v = store?.getItem(key);
    return v === "1" ? true : v === "0" ? false : fallback;
  } catch {
    return fallback;
  }
}

export function writeFlag(key: string, value: boolean, store: Storage | null = storage()): void {
  try {
    store?.setItem(key, value ? "1" : "0");
  } catch {
    // The preference then lasts for this visit only.
  }
}
