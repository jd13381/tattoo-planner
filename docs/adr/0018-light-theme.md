# ADR 0018: Light theme (system / light / dark)

- Status: accepted (2026-11-06, decided by Claude on Jan's request: "Dark und Bright Mode, der sich an den OS-Einstellungen orientiert oder direkt eingestellt werden kann. So wie bei Job Radar. Das Dark Design sollten wir vorerst nicht mehr ändern.")
- Context: the planner was dark only (`docs/claude-decisions.md`, 2026-11-04). All chrome colours already were tokens at the top of `src/styles.css`, except about fifty literals further down. The desktop shell's page is served from `127.0.0.1` on a free port, so its origin (and localStorage) changes on every start. The desktop CSP allows scripts from the own origin only.

## Decision

- **Three choices, like Job Radar:** `type Theme = "light" | "dark" | "system"`, default `system`, stored in localStorage under `theme`. `src/ui/theme.ts` (framework-free, tested) resolves `system` with `matchMedia("(prefers-color-scheme: dark)")`, toggles the classes `light` / `dark` on `<html>`, sets `color-scheme`, and follows OS changes while the choice is `system`. `src/ui/useTheme.ts` wraps it for React (`useSyncExternalStore`).
- **Dark stays the default palette.** `:root` keeps every dark value unchanged; the light palette is `:root.light` and only overrides colour tokens. Hard-coded chrome colours below the tokens became tokens with the old value, so dark mode renders as before (before/after screenshots of every tab: identical apart from a few anti-aliased border pixels and the new Settings entry). Without JavaScript the page is dark, as before.
- **Before the first paint:** `public/theme-init.js`, a classic render-blocking script in `<head>`, applies the theme. An external file instead of Job Radar's inline script, because an inline script would need a hash or `'unsafe-inline'` in the desktop CSP; `'self'` already covers the file. It repeats the two rules of `theme.ts`; a test runs it in a VM against `resolveTheme` for every stored value.
- **Desktop:** the main process keeps the choice in `userData/theme.json` (`desktop/themeFile.ts`), sets `nativeTheme.themeSource` (so `prefers-color-scheme`, native controls and menus follow) and the window's `backgroundColor` to the page's `--bg` before the window opens, and repaints it on `nativeTheme` updates. The preload gets the stored theme through `additionalArguments` and exposes it as `window.tattooDesktop.initialTheme`, which `theme-init.js` and the store prefer over localStorage; `setTheme` (IPC `tattoo:set-theme`) stores a change.
- **What stays the same in both themes:** content colours (`--skin`, `--figure`, `--filler`, `--red`), the drawn 2D canvases (blockout, reference, cm grid), the 3D skin and lights, the projection wizard's markers, and the handout/PDF export (`EXPORT_BACKGROUND`). What follows the theme: chrome, popovers, toasts, forms, focus rings, scrollbars, the 2D workspace around the sheet, the 3D stage gradient (the WebGL canvas is transparent), the viewer's PNG screenshot background, checkerboards of asset thumbnails and empty artboards, and the Image studio's backdrop until the user picks one.
- **Control:** Settings → Appearance, a segmented radio group (Sun / Monitor / Moon with labels). Not in the top bar: the Layout tab already fills it with notices, pickers, undo and save.

## Alternatives

- `html:not(.dark)` as the light selector: light would be the fallback without JavaScript, which changes today's default look.
- An inline script with a CSP hash: works, but the hash must be kept in step with the script and the dev server.
- Keeping the desktop choice only in localStorage: lost on every start, because the origin's port changes.
