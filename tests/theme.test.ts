import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import vm from "node:vm";
import { afterEach, describe, expect, it } from "vitest";
import { loadTheme, saveTheme, windowBackground } from "../desktop/themeFile.ts";
import {
  applyTheme,
  createThemeStore,
  parseTheme,
  readTheme,
  resolveTheme,
  THEME_BACKGROUND,
  THEME_KEY,
  writeTheme,
  type ResolvedTheme,
  type Theme,
} from "../src/ui/theme.ts";

function fakeRoot() {
  const classes = new Set<string>();
  return {
    classes,
    classList: {
      toggle: (name: string, force?: boolean) => {
        const on = force ?? !classes.has(name);
        if (on) classes.add(name);
        else classes.delete(name);
        return on;
      },
    },
    style: { colorScheme: "" },
  };
}

function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

const blockedStorage = {
  getItem: (): string | null => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("SecurityError");
  },
};

function fakeMedia(matches: boolean) {
  const listeners = new Set<() => void>();
  return {
    matches,
    addEventListener: (_: string, l: () => void) => void listeners.add(l),
    removeEventListener: (_: string, l: () => void) => void listeners.delete(l),
    /** The OS switches its appearance. */
    flip(next: boolean) {
      this.matches = next;
      for (const l of listeners) l();
    },
  };
}

function shown(root: ReturnType<typeof fakeRoot>): ResolvedTheme | "mixed" {
  const light = root.classes.has("light");
  const dark = root.classes.has("dark");
  if (light === dark) return "mixed";
  expect(root.style.colorScheme).toBe(light ? "light" : "dark");
  return light ? "light" : "dark";
}

describe("theme rules", () => {
  it("parses only the three themes, else follows the system", () => {
    expect(parseTheme("light")).toBe("light");
    expect(parseTheme("dark")).toBe("dark");
    expect(parseTheme("system")).toBe("system");
    for (const junk of [null, undefined, "", "Dark", 1, {}]) expect(parseTheme(junk)).toBe("system");
  });

  it("resolves system by the OS setting and keeps an explicit choice", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("reads and writes the choice, and survives blocked storage", () => {
    const s = fakeStorage();
    expect(readTheme(s)).toBe("system");
    writeTheme(s, "light");
    expect(s.data.get(THEME_KEY)).toBe("light");
    expect(readTheme(s)).toBe("light");
    expect(readTheme(fakeStorage({ [THEME_KEY]: "purple" }))).toBe("system");
    expect(readTheme(blockedStorage)).toBe("system");
    expect(() => writeTheme(blockedStorage, "dark")).not.toThrow();
    expect(readTheme(null)).toBe("system");
  });

  it("sets exactly one theme class on the root", () => {
    const root = fakeRoot();
    applyTheme(root, "light");
    expect(shown(root)).toBe("light");
    applyTheme(root, "dark");
    expect(shown(root)).toBe("dark");
  });
});

describe("theme store", () => {
  it("starts from storage, applies at once and follows the OS while on system", () => {
    const root = fakeRoot();
    const media = fakeMedia(true);
    const store = createThemeStore({ root, storage: fakeStorage(), media });
    expect(store.get()).toBe("system");
    expect(shown(root)).toBe("dark");
    let calls = 0;
    store.subscribe(() => calls++);
    media.flip(false);
    expect(shown(root)).toBe("light");
    expect(store.resolved()).toBe("light");
    expect(calls).toBe(1);
  });

  it("an explicit choice ignores the OS and is stored and reported", () => {
    const root = fakeRoot();
    const media = fakeMedia(false);
    const storage = fakeStorage();
    const changes: Theme[] = [];
    const store = createThemeStore({ root, storage, media, onChange: (t) => changes.push(t) });
    let calls = 0;
    const off = store.subscribe(() => calls++);
    store.set("dark");
    expect(shown(root)).toBe("dark");
    expect(storage.data.get(THEME_KEY)).toBe("dark");
    media.flip(true);
    media.flip(false);
    expect(shown(root)).toBe("dark");
    store.set("dark");
    expect(changes).toEqual(["dark"]);
    expect(calls).toBe(1);
    off();
    store.set("system");
    expect(shown(root)).toBe("light");
    expect(calls).toBe(1);
  });

  it("prefers the desktop shell's initial theme over storage", () => {
    const root = fakeRoot();
    const store = createThemeStore({
      root,
      storage: fakeStorage({ [THEME_KEY]: "dark" }),
      media: null,
      initial: "light",
    });
    expect(store.get()).toBe("light");
    expect(shown(root)).toBe("light");
  });

  it("without matchMedia, system means light", () => {
    const root = fakeRoot();
    createThemeStore({ root, storage: null, media: null });
    expect(shown(root)).toBe("light");
  });
});

describe("public/theme-init.js", () => {
  const script = readFileSync(path.join(import.meta.dirname, "..", "public", "theme-init.js"), "utf8");

  function run(opts: { stored?: string | null; systemDark: boolean; desktop?: Theme; blocked?: boolean }) {
    const root = fakeRoot();
    const storage = opts.blocked
      ? blockedStorage
      : fakeStorage(opts.stored ? { [THEME_KEY]: opts.stored } : {});
    const window = {
      localStorage: storage,
      matchMedia: (q: string) => ({ matches: q === "(prefers-color-scheme: dark)" && opts.systemDark }),
      tattooDesktop: opts.desktop ? { initialTheme: opts.desktop } : undefined,
    };
    vm.runInNewContext(script, { window, document: { documentElement: root } });
    return shown(root);
  }

  it("agrees with resolveTheme for every stored value and system setting", () => {
    for (const stored of ["light", "dark", "system", null, "junk"])
      for (const systemDark of [true, false])
        expect(run({ stored, systemDark })).toBe(resolveTheme(parseTheme(stored), systemDark));
  });

  it("uses the desktop shell's theme first and survives blocked storage", () => {
    expect(run({ stored: "dark", systemDark: true, desktop: "light" })).toBe("light");
    expect(run({ blocked: true, systemDark: true })).toBe("dark");
    expect(run({ blocked: true, systemDark: false })).toBe("light");
  });
});

describe("desktop theme file", () => {
  let dir = "";
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("stores the choice and reads it back; a missing or broken file means system", async () => {
    dir = mkdtempSync(path.join(tmpdir(), "theme-"));
    const file = path.join(dir, "theme.json");
    expect(await loadTheme(file)).toBe("system");
    await saveTheme(file, "light");
    expect(await loadTheme(file)).toBe("light");
    writeFileSync(file, "{not json");
    expect(await loadTheme(file)).toBe("system");
    writeFileSync(file, JSON.stringify({ theme: "sepia" }));
    expect(await loadTheme(file)).toBe("system");
  });

  it("paints the window in the page's background", () => {
    expect(windowBackground("dark", false)).toBe(THEME_BACKGROUND.dark);
    expect(windowBackground("system", true)).toBe(THEME_BACKGROUND.dark);
    expect(windowBackground("system", false)).toBe(THEME_BACKGROUND.light);
    const css = readFileSync(path.join(import.meta.dirname, "..", "src", "styles.css"), "utf8");
    const light = css.slice(css.indexOf(":root.light {"));
    expect(css).toContain(`--bg: ${THEME_BACKGROUND.dark};`);
    expect(light).toMatch(new RegExp(`^:root\\.light \\{[^}]*--bg: ${THEME_BACKGROUND.light};`));
  });
});
