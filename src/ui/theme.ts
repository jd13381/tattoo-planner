// The colour theme (docs/adr/0021-light-theme.md): "system" follows the OS, "light" and "dark" pin
// one. The choice is a per-viewer convenience in localStorage ("theme"); the desktop app also keeps
// it in its settings folder, because the page's origin (a free port) changes on every start.
// Applying a theme toggles the class `light` or `dark` on <html>; styles.css keys the light palette
// on `:root.light`, so dark stays the default when no script runs. public/theme-init.js repeats
// `resolveTheme` and `applyTheme` as a plain script, so the theme is set before the first paint.
// Framework-free: the environment (storage, media query, root element) is passed in.

export type Theme = "light" | "dark" | "system";
export type ResolvedTheme = Exclude<Theme, "system">;

export const THEMES: readonly Theme[] = ["light", "system", "dark"];
export const THEME_KEY = "theme";
export const DEFAULT_THEME: Theme = "system";
export const DARK_QUERY = "(prefers-color-scheme: dark)";

/** The window background before the page paints (desktop shell): --bg of each palette. */
export const THEME_BACKGROUND: Record<ResolvedTheme, string> = { dark: "#0a0a0d", light: "#f3f3f6" };

export function isTheme(v: unknown): v is Theme {
  return v === "light" || v === "dark" || v === "system";
}

/** A stored or passed-in value as a theme; anything else is the default. */
export function parseTheme(v: unknown): Theme {
  return isTheme(v) ? v : DEFAULT_THEME;
}

export function resolveTheme(theme: Theme, systemDark: boolean): ResolvedTheme {
  return theme === "system" ? (systemDark ? "dark" : "light") : theme;
}

type StorageLike = Pick<Storage, "getItem" | "setItem">;

/** The stored theme; the default when nothing (or garbage) is stored or storage is blocked. */
export function readTheme(storage: StorageLike | null | undefined): Theme {
  try {
    return parseTheme(storage?.getItem(THEME_KEY));
  } catch {
    return DEFAULT_THEME;
  }
}

export function writeTheme(storage: StorageLike | null | undefined, theme: Theme): void {
  try {
    storage?.setItem(THEME_KEY, theme);
  } catch {
    // Private window or blocked storage: the theme still applies for this page.
  }
}

type RootLike = { classList: Pick<DOMTokenList, "toggle">; style: { colorScheme: string } };

/** Sets the theme classes and the native colour scheme (form controls, scrollbars) on <html>. */
export function applyTheme(root: RootLike, resolved: ResolvedTheme): void {
  root.classList.toggle("light", resolved === "light");
  root.classList.toggle("dark", resolved === "dark");
  root.style.colorScheme = resolved;
}

type MediaLike = { matches: boolean; addEventListener(type: "change", listener: () => void): void };

export type ThemeEnv = {
  root: RootLike;
  storage: StorageLike | null;
  /** The (prefers-color-scheme: dark) query; null where matchMedia is missing (counts as light). */
  media: MediaLike | null;
  /** The theme the desktop shell started with; it wins over storage (see the module comment). */
  initial?: Theme | null;
  /** Called after every change of the choice (the desktop shell stores it and repaints its window). */
  onChange?: (theme: Theme) => void;
};

export type ThemeStore = {
  /** The chosen theme. */
  get: () => Theme;
  /** What is on screen now ("system" resolved). */
  resolved: () => ResolvedTheme;
  set: (theme: Theme) => void;
  subscribe: (listener: () => void) => () => void;
};

/**
 * The theme as an external store (for useSyncExternalStore). It applies the theme at once and, while
 * the choice is "system", follows OS changes.
 */
export function createThemeStore(env: ThemeEnv): ThemeStore {
  let theme: Theme = env.initial && isTheme(env.initial) ? env.initial : readTheme(env.storage);
  let resolved: ResolvedTheme = resolveTheme(theme, !!env.media?.matches);
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const l of listeners) l();
  };
  const refresh = () => {
    const next = resolveTheme(theme, !!env.media?.matches);
    applyTheme(env.root, next);
    if (next === resolved) return false;
    resolved = next;
    return true;
  };
  const onSystem = () => {
    if (theme === "system" && refresh()) notify();
  };
  applyTheme(env.root, resolved);
  env.media?.addEventListener("change", onSystem);
  return {
    get: () => theme,
    resolved: () => resolved,
    set: (next) => {
      if (!isTheme(next)) return;
      writeTheme(env.storage, next);
      if (next === theme) return;
      theme = next;
      refresh();
      env.onChange?.(next);
      notify();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
