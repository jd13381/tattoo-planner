// IPC channel names between desktop/main.ts and desktop/preload.cts. The sandboxed preload cannot
// import this module, so it repeats the names; tests/desktop.test.ts checks that both agree.
export const CHANNELS = {
  pickFolder: "tattoo:pick-folder",
  revealInFinder: "tattoo:reveal-in-finder",
  openExternal: "tattoo:open-external",
  getKeyStatus: "tattoo:key-status",
  setOpenAIKey: "tattoo:set-openai-key",
  clearOpenAIKey: "tattoo:clear-openai-key",
} as const;
