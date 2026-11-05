// Preload of the desktop window (docs/adr/0015-desktop-app.md). It runs sandboxed and isolated from
// the page and exposes exactly the calls of `TattooDesktop` (src/desktop/bridge.ts) as
// `window.tattooDesktop`; the page gets no Node, no ipcRenderer and never the OpenAI key.
// CommonJS (.cts → .cjs), because sandboxed preloads cannot be ES modules. The channel names repeat
// desktop/channels.ts, since a sandboxed preload can only require "electron". No import or export
// statements: the file stays a plain script, as the sandbox runs it.

// eslint-disable-next-line @typescript-eslint/no-require-imports -- a sandboxed preload is a CommonJS script
const { contextBridge, ipcRenderer } = require("electron") as typeof import("electron");

/** The main process answers `{ ok, value }` or `{ ok: false, message }`, so errors keep a clean text. */
type Reply = { ok: true; value: unknown } | { ok: false; message: string };

async function call<T>(channel: string, ...args: unknown[]): Promise<T> {
  const reply = (await ipcRenderer.invoke(channel, ...args)) as Reply;
  if (!reply.ok) throw new Error(reply.message);
  return reply.value as T;
}

const bridge: import("../src/desktop/bridge.ts").TattooDesktop = {
  pickFolder: (opts) => call("tattoo:pick-folder", opts),
  revealInFinder: (path) => call("tattoo:reveal-in-finder", path),
  openExternal: (url) => call("tattoo:open-external", url),
  getKeyStatus: () => call("tattoo:key-status"),
  setOpenAIKey: (key) => call("tattoo:set-openai-key", key),
  clearOpenAIKey: () => call("tattoo:clear-openai-key"),
};

contextBridge.exposeInMainWorld("tattooDesktop", bridge);
