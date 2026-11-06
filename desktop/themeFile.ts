// The desktop app's theme choice (docs/adr/0021-light-theme.md), kept in the settings folder as
// theme.json: the page's localStorage does not survive a restart there, because the local server
// gets a free port (a new origin) every time. The main process reads it before it opens the window,
// so the window background and nativeTheme match the page from the first frame.
import { readFile, writeFile } from "node:fs/promises";
import { parseTheme, resolveTheme, THEME_BACKGROUND, type Theme } from "../src/ui/theme.ts";

/** The stored theme; "system" when the file is missing or unreadable. */
export async function loadTheme(file: string): Promise<Theme> {
  try {
    const parsed = JSON.parse(await readFile(file, "utf8")) as { theme?: unknown };
    return parseTheme(parsed?.theme);
  } catch {
    return parseTheme(undefined);
  }
}

export async function saveTheme(file: string, theme: Theme): Promise<void> {
  await writeFile(file, `${JSON.stringify({ theme })}\n`, "utf8");
}

/** The window background for a theme, given whether the OS (or nativeTheme) is dark. */
export function windowBackground(theme: Theme, systemDark: boolean): string {
  return THEME_BACKGROUND[resolveTheme(theme, systemDark)];
}

/** The command-line switch that hands the theme to the preload (desktop/preload.cts). */
export const THEME_ARG = "--tattoo-theme=";
