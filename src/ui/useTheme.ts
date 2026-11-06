// The page's theme store (src/ui/theme.ts) wired to the browser, and its React hook.
import { useSyncExternalStore } from "react";
import { desktopBridge } from "../desktop/bridge.ts";
import { createThemeStore, DARK_QUERY, type ResolvedTheme, type Theme, type ThemeStore } from "./theme.ts";

function browserStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

let store: ThemeStore | null = null;

/** The one store of the page, created on first use (theme-init.js has already applied the theme). */
export function themeStore(): ThemeStore {
  if (store) return store;
  const desktop = desktopBridge();
  store = createThemeStore({
    root: document.documentElement,
    storage: browserStorage(),
    media: typeof window.matchMedia === "function" ? window.matchMedia(DARK_QUERY) : null,
    initial: desktop?.initialTheme ?? null,
    onChange: (theme) => void desktop?.setTheme?.(theme).catch(() => undefined),
  });
  return store;
}

/** The chosen theme and a setter. */
export function useTheme(): [Theme, (theme: Theme) => void] {
  const s = themeStore();
  const theme = useSyncExternalStore(s.subscribe, s.get, s.get);
  return [theme, s.set];
}

/** The theme on screen ("system" resolved), for parts that pick a default by it. */
export function useResolvedTheme(): ResolvedTheme {
  const s = themeStore();
  return useSyncExternalStore(s.subscribe, s.resolved, s.resolved);
}
