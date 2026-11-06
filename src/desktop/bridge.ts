// The desktop shell's preload bridge (desktop/preload.cts), as the page sees it: `window.tattooDesktop`
// exists only in the desktop app. Types only plus one accessor, so the page and the preload agree.
import type { Theme } from "../ui/theme.ts";

export type PickPurpose = "open" | "create";
export type PickOptions = { title: string; purpose: PickPurpose };

/** Where the OpenAI key is kept. The key itself never reaches the page. */
export type KeyStatus = {
  /** A key is stored (encrypted) in the app's settings folder. */
  stored: boolean;
  /** The system can encrypt (macOS: the Keychain is reachable); without it no key can be saved. */
  encryptionAvailable: boolean;
  /** Human-readable name of the encryption backend, e.g. "macOS Keychain". */
  backend: string;
};

export type TattooDesktop = {
  /** A native folder dialog; null when cancelled. */
  pickFolder: (opts: PickOptions) => Promise<string | null>;
  /** Shows a file or folder in Finder. */
  revealInFinder: (path: string) => Promise<void>;
  /** Opens an https link in the system browser; other schemes are refused. */
  openExternal: (url: string) => Promise<void>;
  getKeyStatus: () => Promise<KeyStatus>;
  /** Encrypts and stores the key; rejects with a readable message when it cannot. */
  setOpenAIKey: (key: string) => Promise<KeyStatus>;
  clearOpenAIKey: () => Promise<KeyStatus>;
  /** The theme the window was opened with (kept in the app's settings folder). */
  initialTheme?: Theme;
  /** Stores the theme choice and repaints the native window background to match. */
  setTheme?: (theme: Theme) => Promise<void>;
};

declare global {
  interface Window {
    /** Set by the desktop shell's preload script; absent in a browser. */
    tattooDesktop?: TattooDesktop;
  }
}

/** The bridge when the page runs in the desktop app, else null. */
export function desktopBridge(): TattooDesktop | null {
  return typeof window !== "undefined" && window.tattooDesktop ? window.tattooDesktop : null;
}
