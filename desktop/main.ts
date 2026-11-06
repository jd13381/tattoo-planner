// Electron main process of the desktop app (docs/adr/0015-desktop-app.md). It runs the same server as
// `npm run serve` (server/standalone.ts) on 127.0.0.1 with a free port, serving the built page from
// dist/, and shows it in one locked-down window. The OpenAI key stays here: it is stored encrypted
// with safeStorage (desktop/keyStore.ts) and handed to the server through a key provider.
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  safeStorage,
  session,
  shell,
  type IpcMainInvokeEvent,
  type MenuItemConstructorOptions,
  type OpenDialogOptions,
  type WebContents,
} from "electron";
import { existsSync } from "node:fs";
import path from "node:path";
import { createContext, readEnv } from "../server/context.ts";
import { startServer, staticFile } from "../server/standalone.ts";
import type { PickOptions } from "../src/desktop/bridge.ts";
import { isTheme, type Theme } from "../src/ui/theme.ts";
import { CHANNELS } from "./channels.ts";
import { KeyStore, type SafeStorageLike } from "./keyStore.ts";
import {
  ALLOWED_PERMISSIONS,
  CONTENT_SECURITY_POLICY,
  isAllowedRequest,
  isAppUrl,
  isExternalUrl,
} from "./navigation.ts";
import { loadTheme, saveTheme, THEME_ARG, windowBackground } from "./themeFile.ts";

const APP_NAME = "Tattoo Planner";
/** dist-desktop/desktop/ → the app folder (the checkout, or app.asar in the packaged app). */
const APP_ROOT = path.resolve(import.meta.dirname, "..", "..");
const PRELOAD = path.join(import.meta.dirname, "preload.cjs");

// The same settings folder for `npm run desktop` and the installed app:
// ~/Library/Application Support/Tattoo Planner on macOS.
app.setName(APP_NAME);
app.setPath("userData", path.join(app.getPath("appData"), APP_NAME));
// Every renderer sandboxed, also DevTools. `--no-sandbox` (needed to run as root, e.g. in a Linux
// container smoke test) turns the OS sandbox off, which enableSandbox() would refuse.
if (!app.commandLine.hasSwitch("no-sandbox")) app.enableSandbox();

let mainWindow: BrowserWindow | null = null;
let server: { url: string; close: () => Promise<void> } | null = null;
let origin = "";
let theme: Theme = "system";
let themeFile = "";

/** Follows the page's theme: native controls and menus via nativeTheme, and the window background. */
function applyNativeTheme(next: Theme) {
  theme = next;
  // Electron's themeSource uses the same names ("system" | "light" | "dark").
  nativeTheme.themeSource = next;
  mainWindow?.setBackgroundColor(windowBackground(next, nativeTheme.shouldUseDarkColors));
}

function backendName(): string {
  if (process.platform === "darwin") return "macOS Keychain";
  if (process.platform === "win32") return "Windows Data Protection";
  return `system keyring (${safeStorage.getSelectedStorageBackend()})`;
}

/** safeStorage, except that Linux's "basic_text" fallback (a fixed password) does not count as encryption. */
function systemSafeStorage(): SafeStorageLike {
  const weak = () =>
    process.platform === "linux" &&
    ["basic_text", "unknown"].includes(safeStorage.getSelectedStorageBackend());
  return {
    isAsyncEncryptionAvailable: async () => !weak() && (await safeStorage.isAsyncEncryptionAvailable()),
    encryptStringAsync: (plain) => safeStorage.encryptStringAsync(plain),
    decryptStringAsync: (encrypted) => safeStorage.decryptStringAsync(encrypted),
  };
}

/** Every IPC call: only from the planner's own page, answered as `{ ok, value }` / `{ ok: false, message }`. */
function handle(channel: string, fn: (...args: unknown[]) => unknown) {
  ipcMain.handle(channel, async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
    if (!isAppUrl(event.senderFrame?.url ?? "", origin)) return { ok: false, message: "not allowed" };
    try {
      return { ok: true, value: (await fn(...args)) ?? null };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : "failed" };
    }
  });
}

function registerIpc(keys: KeyStore) {
  handle(CHANNELS.pickFolder, async (raw) => {
    const opts = (raw ?? {}) as Partial<PickOptions>;
    const options: OpenDialogOptions = {
      title: typeof opts.title === "string" ? opts.title.slice(0, 200) : "Choose a folder",
      buttonLabel: opts.purpose === "create" ? "Choose location" : "Open",
      properties: ["openDirectory", "createDirectory"],
    };
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options);
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
  handle(CHANNELS.revealInFinder, (p) => {
    if (typeof p !== "string" || !path.isAbsolute(p) || !existsSync(p))
      throw new Error("no such file or folder");
    shell.showItemInFolder(p);
  });
  handle(CHANNELS.openExternal, async (url) => {
    if (typeof url !== "string" || !isExternalUrl(url))
      throw new Error("only https links open outside the app");
    await shell.openExternal(url);
  });
  handle(CHANNELS.getKeyStatus, () => keys.status());
  handle(CHANNELS.setOpenAIKey, (key) => keys.set(key));
  handle(CHANNELS.clearOpenAIKey, () => keys.clear());
  handle(CHANNELS.setTheme, async (next) => {
    if (!isTheme(next)) throw new Error("unknown theme");
    applyNativeTheme(next);
    await saveTheme(themeFile, next);
  });
}

/** Navigation rules for every window and frame: stay on the local server, https links go to the browser. */
function guard(contents: WebContents) {
  const leave = (event: { preventDefault: () => void }, url: string) => {
    if (isAppUrl(url, origin)) return;
    event.preventDefault();
    if (isExternalUrl(url)) void shell.openExternal(url);
  };
  contents.on("will-navigate", leave);
  contents.on("will-redirect", leave);
  contents.on("will-attach-webview", (event) => event.preventDefault());
  contents.setWindowOpenHandler(({ url }) => {
    if (isExternalUrl(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
}

function lockDownSession() {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((_wc, permission, callback) =>
    callback(ALLOWED_PERMISSIONS.has(permission)),
  );
  ses.setPermissionCheckHandler((_wc, permission) => ALLOWED_PERMISSIONS.has(permission));
  // No remote content: the page may load only from its own server (OpenAI is called by the server).
  ses.webRequest.onBeforeRequest({ urls: ["<all_urls>"] }, (details, callback) =>
    callback({ cancel: !isAllowedRequest(details.url, origin) }),
  );
  ses.webRequest.onHeadersReceived({ urls: [`${origin}/*`] }, (details, callback) =>
    callback({
      responseHeaders: { ...details.responseHeaders, "Content-Security-Policy": [CONTENT_SECURITY_POLICY] },
    }),
  );
}

function buildMenu() {
  const isMac = process.platform === "darwin";
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: "appMenu" } as const] : []),
    { role: "fileMenu" },
    // Standard roles, so copy, paste, undo and select all work in text fields.
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  if (!server) return;
  const win = new BrowserWindow({
    title: APP_NAME,
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    // The page's --bg, so neither theme flashes before the first paint.
    backgroundColor: windowBackground(theme, nativeTheme.shouldUseDarkColors),
    webPreferences: {
      preload: PRELOAD,
      // The stored theme for public/theme-init.js, via the preload (window.tattooDesktop.initialTheme).
      additionalArguments: [`${THEME_ARG}${theme}`],
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
      navigateOnDragDrop: false,
      spellcheck: false,
    },
  });
  win.once("ready-to-show", () => win.show());
  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });
  mainWindow = win;
  void win.loadURL(server.url);
}

async function main() {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  app.on("second-instance", () => {
    if (!mainWindow) return createWindow();
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
  app.on("web-contents-created", (_event, contents) => guard(contents));

  await app.whenReady();
  const userData = app.getPath("userData");
  themeFile = path.join(userData, "theme.json");
  applyNativeTheme(await loadTheme(themeFile));
  // "system" and the OS switches: repaint the window behind the page too.
  nativeTheme.on("updated", () =>
    mainWindow?.setBackgroundColor(windowBackground(theme, nativeTheme.shouldUseDarkColors)),
  );
  const keys = new KeyStore({
    file: path.join(userData, "openai-key.bin"),
    safeStorage: systemSafeStorage(),
    backend: backendName(),
  });
  await keys.load();
  // A checkout (`npm run desktop`) reads its .env like `npm run serve`; the installed app only the
  // environment it was started with.
  const env = app.isPackaged ? { ...process.env } : readEnv(APP_ROOT);
  const context = createContext({
    env,
    root: APP_ROOT,
    configFile: path.join(userData, "config.json"),
    openaiKey: () => keys.get(),
    // "Move to Trash" in the Assets tab: the system Trash, with Put Back.
    trashItem: (file) => shell.trashItem(file),
  });
  const dist = path.join(APP_ROOT, "dist");
  if (!(await staticFile(dist, "/"))) {
    dialog.showErrorBox(
      APP_NAME,
      "The planner's page is missing (dist/index.html). Run `npm run build` first.",
    );
    app.exit(1);
    return;
  }
  try {
    server = await startServer({ context, dist, port: 0 });
  } catch (e) {
    dialog.showErrorBox(
      APP_NAME,
      `The planner could not start: ${e instanceof Error ? e.message : String(e)}`,
    );
    app.exit(1);
    return;
  }
  origin = new URL(server.url).origin;
  lockDownSession();
  registerIpc(keys);
  buildMenu();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
  let closing = false;
  app.on("before-quit", (event) => {
    if (closing || !server) return;
    // Stop running edits and remove their working folders before the process ends.
    event.preventDefault();
    closing = true;
    void server.close().finally(() => app.quit());
  });
}

void main();
