# ADR 0015: Desktop app and key storage

- Status: accepted (2026-11-05, decided by Claude under Jan's autonomy rule, see docs/claude-decisions.md); roadmap Phase C step 7. Signing stays open (roadmap §7, open point 1): the build is unsigned until Jan decides, and signs itself once the secrets exist.
- Context: `docs/product/roadmap.md` §2 (local-first, same code path for git and DMG) and §4.3. The market scan chose Electron because the Node backend moves over unchanged and the bundled Chromium avoids Safari's WebGL issues. ADR 0012 moved every request handler into `server/` and added `startServer()` for exactly this.

## Decision

### Shell

- **Electron 45** (`desktop/main.ts`). The main process builds the same API context as `npm run serve` (`createContext()`), starts `startServer()` on `127.0.0.1` with port `0`, serves the built `dist/` and opens one `BrowserWindow` on that URL. The browser code is unchanged: it keeps calling `/api/...` relative to its origin.
- **Project choice** in Electron's `userData` folder (`~/Library/Application Support/Tattoo Planner/config.json`), passed as `configFile`; `npm run desktop` and the installed app share it. A checkout started with `npm run desktop` still reads its `.env` (so `TATTOO_DATA_DIR` locks the project as in the browser); the packaged app reads only its environment.
- **Window security:** `contextIsolation`, `sandbox` (also `app.enableSandbox()` for every renderer), no `nodeIntegration`, no `webview`, no navigation on drag and drop. Navigation and redirects are allowed only to the local origin; `https` links (and `target=_blank`) open in the system browser, every other scheme is dropped (`desktop/navigation.ts`). Requests from the page to anything but its own server, `data:` and `blob:` are cancelled, and responses carry a Content-Security-Policy (`'self'` only, inline styles allowed). Every permission request except `clipboard-sanitized-write` is denied. Single-instance lock; the standard macOS menu with the Edit roles, so copy and paste work in text fields.
- **Preload bridge** (`desktop/preload.cts`, CommonJS because sandboxed preloads cannot be ES modules) exposes `window.tattooDesktop` with `pickFolder`, `revealInFinder`, `openExternal` (https only), `getKeyStatus`, `setOpenAIKey`, `clearOpenAIKey` (types in `src/desktop/bridge.ts`). The main process answers only calls from the local origin, validates every argument and returns `{ ok, value }` / `{ ok: false, message }`, so errors reach the page as plain text.
- **Electron fuses:** `runAsNode`, `NODE_OPTIONS` and `--inspect` off, `onlyLoadAppFromAsar` and cookie encryption on. Embedded asar integrity stays off until the app is signed with a Developer ID.

### Key storage (BYOK)

- The OpenAI key is encrypted with Electron `safeStorage` (async API; on macOS its encryption key is kept in the Keychain as "Tattoo Planner Safe Storage") and written to `userData/openai-key.bin` (mode 0600, replaced atomically) by `desktop/keyStore.ts`. It is decrypted once at start into the main process's memory. The page sends a new key once and never reads one back; status calls return only `{ stored, encryptionAvailable, backend }`. The key is never logged.
- `server/settings.ts` takes a **key provider**: `settingsFromEnv(env, () => keys.get())`. The provider's key wins over `TATTOO_OPENAI_API_KEY`; model and options still come from the environment. The settings object is read on every use (`get openai()`), so saving or removing a key works without a restart; a running GPT Image job keeps the settings it started with.
- On Linux, `safeStorage`'s `basic_text` fallback (a fixed password) does not count as encryption: no key can be stored there.
- Settings → Image generation shows a password field with Save / Remove and the status in the desktop app; in the browser the `.env` steps stay.

### Build and release

- **tsc, no bundler:** `tsconfig.desktop.json` compiles `desktop/` and the server modules it imports into `dist-desktop/` with `rewriteRelativeImportExtensions` (the server keeps its `.ts` imports for Node's type stripping). Runtime dependencies of the packed app are only `yaml` and `zod`; the page's libraries are already bundled by Vite and are filtered out of the package.
- **electron-builder 26** (`desktop/electron-builder.config.mjs`): `npm run dist:mac` builds one DMG each for arm64 and x64 (`Tattoo-Planner-<version>-<arch>.dmg`), app id `dev.tattooplanner.app`, category graphics-design. **Signing switches itself on:** with `CSC_LINK` or `CSC_NAME` the app is signed with the hardened runtime, with `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` also notarised; otherwise it is ad-hoc signed (`identity: "-"`), which Apple Silicon needs to start an app at all.
- **Icon** drawn at build time by `scripts/desktop-icon.mjs` (1024 px PNG, plain Node and zlib); electron-builder makes the `.icns`. No image is committed.
- **CI** (`.github/workflows/desktop.yml`, macos-latest): on tags `v*` and manual runs, `npm ci`, `npm run check`, `npm run dist:mac`; the DMGs become a workflow artifact and, for tags, are attached to a draft GitHub Release with `gh`. Empty secrets are unset before the build, and `CSC_IDENTITY_AUTO_DISCOVERY=false` without a certificate.
- **Install scripts:** Electron 45 has no postinstall; it downloads its binary on the first `electron` launch (or `npx install-electron`), so `.npmrc`'s `ignore-scripts=true` needs no exception. electron-builder downloads the Electron builds it packs by itself.

## Alternatives

- **Electron Forge** instead of electron-builder: official, but DMG, notarisation and "sign only when secrets exist" need more plugins and config; the roadmap already named electron-builder. Rejected.
- **esbuild or Vite for the main process:** one more build path; tsc with `rewriteRelativeImportExtensions` is enough because the server is already plain ESM TypeScript. Node's type stripping inside Electron would also work in a checkout, but not reliably from inside `app.asar`. Rejected.
- **Universal binary** instead of two DMGs: twice the download for everyone. Two DMGs; switch `arch` to `universal` if users find the choice confusing.
- **Key in a plain file or in the page (localStorage):** readable by any process or by the page. **`keytar`:** archived, native module. Rejected.
- **Tauri:** smaller app, but the Node server would need a sidecar or a rewrite in Rust, and WebKit brings back the Safari WebGL issues. Rejected in the market scan.

## Consequences

- The installed app keeps its project choice separate from `npm run dev` (`~/.config/tattoo-planner/`); the same folders open in both.
- Unsigned releases show macOS's "cannot be opened" warning once (README, "Start"); auto-update is not possible until the app is signed.
- An ad-hoc signed new version may ask once for Keychain access to the stored key.
- Not verified on a Mac in this step (the work ran in a Linux container): the DMG build, the `.icns` conversion, the Keychain, the native folder dialog and Finder. The Linux build of the same configuration was packed and started (window, API, project creation, WebGL, CSP, IPC, blocked remote requests).
