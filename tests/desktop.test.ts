// The desktop shell's framework-free parts (docs/adr/0015-desktop-app.md): key file, URL rules, IPC
// channel names, the settings key provider and the build-time icon. Electron itself is not loaded.
import { existsSync, readFileSync, statSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CHANNELS } from "../desktop/channels.ts";
import { keyProblem, KeyStore, type SafeStorageLike } from "../desktop/keyStore.ts";
import { isAllowedRequest, isAppUrl, isExternalUrl } from "../desktop/navigation.ts";
import { EditManager } from "../server/editsApi.ts";
import { settingsFromEnv } from "../server/settings.ts";
// @ts-expect-error: plain ESM script without type declarations
import { drawIcon } from "../scripts/desktop-icon.mjs";

const KEY = "sk-proj-abcdefghijklmnop1234";

/** Reversible "encryption" that never contains the plain text, so the file content can be checked. */
function fakeSafeStorage(opts: { available?: boolean; reEncrypt?: boolean } = {}) {
  const calls = { encrypt: 0 };
  const safe: SafeStorageLike = {
    isAsyncEncryptionAvailable: async () => opts.available ?? true,
    encryptStringAsync: async (plain) => {
      calls.encrypt++;
      return Buffer.from(`enc:${Buffer.from(plain).reverse().toString("base64")}`);
    },
    decryptStringAsync: async (buf) => {
      const s = buf.toString();
      if (!s.startsWith("enc:")) throw new Error("bad data");
      return {
        result: Buffer.from(s.slice(4), "base64").reverse().toString(),
        shouldReEncrypt: opts.reEncrypt ?? false,
      };
    },
  };
  return { safe, calls };
}

describe("KeyStore", () => {
  let dir: string;
  let file: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "tattoo-keys-"));
    file = path.join(dir, "openai-key.bin");
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("stores the key encrypted, owner-only, and reads it back after a restart", async () => {
    const { safe } = fakeSafeStorage();
    const store = new KeyStore({ file, safeStorage: safe, backend: "macOS Keychain" });
    await store.load();
    expect(await store.status()).toEqual({
      stored: false,
      encryptionAvailable: true,
      backend: "macOS Keychain",
    });

    expect((await store.set(`  ${KEY}\n`)).stored).toBe(true);
    expect(store.get()).toBe(KEY);
    const raw = await readFile(file, "utf8");
    expect(raw).not.toContain(KEY);
    expect(raw).not.toContain("abcdefghijklmnop");
    if (process.platform !== "win32") expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(existsSync(`${file}.tmp`)).toBe(false);

    const again = new KeyStore({ file, safeStorage: safe, backend: "macOS Keychain" });
    expect(again.get()).toBeNull();
    await again.load();
    expect(again.get()).toBe(KEY);
  });

  it("removes the key", async () => {
    const { safe } = fakeSafeStorage();
    const store = new KeyStore({ file, safeStorage: safe, backend: "macOS Keychain" });
    await store.set(KEY);
    expect((await store.clear()).stored).toBe(false);
    expect(store.get()).toBeNull();
    expect(existsSync(file)).toBe(false);
    await store.clear(); // no file: still fine
  });

  it("refuses to store without encryption and treats an unreadable file as no key", async () => {
    const off = new KeyStore({
      file,
      safeStorage: fakeSafeStorage({ available: false }).safe,
      backend: "Keychain",
    });
    await expect(off.set(KEY)).rejects.toThrow(/cannot be stored safely/);
    expect(existsSync(file)).toBe(false);

    await writeFile(file, "garbage");
    const store = new KeyStore({ file, safeStorage: fakeSafeStorage().safe, backend: "Keychain" });
    await store.load();
    expect(store.get()).toBeNull();
    expect(existsSync(file)).toBe(true);
  });

  it("re-encrypts when safeStorage asks for it", async () => {
    const { safe, calls } = fakeSafeStorage({ reEncrypt: true });
    await new KeyStore({ file, safeStorage: safe, backend: "Keychain" }).set(KEY);
    const store = new KeyStore({ file, safeStorage: safe, backend: "Keychain" });
    await store.load();
    expect(store.get()).toBe(KEY);
    expect(calls.encrypt).toBe(2);
  });

  it("validates keys without echoing them", async () => {
    expect(keyProblem(KEY)).toBeNull();
    expect(keyProblem("")).toMatch(/Paste/);
    expect(keyProblem(42)).toMatch(/text/);
    expect(keyProblem("sk-abc def")).toMatch(/spaces/);
    expect(keyProblem("hunter2-secret")).toMatch(/sk-/);
    expect(keyProblem("hunter2-secret")).not.toContain("hunter2");
    expect(keyProblem(`sk-${"x".repeat(600)}`)).toMatch(/too long/);
    const store = new KeyStore({ file, safeStorage: fakeSafeStorage().safe, backend: "Keychain" });
    await expect(store.set("not a key")).rejects.toThrow();
    expect(existsSync(file)).toBe(false);
  });
});

describe("navigation rules", () => {
  const origin = "http://127.0.0.1:43210";

  it("keeps the window on its own server", () => {
    expect(isAppUrl(`${origin}/`, origin)).toBe(true);
    expect(isAppUrl(`${origin}/#settings/project`, origin)).toBe(true);
    expect(isAppUrl("http://127.0.0.1:43211/", origin)).toBe(false);
    expect(isAppUrl("http://localhost:43210/", origin)).toBe(false);
    expect(isAppUrl("https://127.0.0.1:43210/", origin)).toBe(false);
    expect(isAppUrl("http://user:pw@127.0.0.1:43210/", origin)).toBe(false);
    expect(isAppUrl("file:///etc/passwd", origin)).toBe(false);
    expect(isAppUrl("not a url", origin)).toBe(false);
    expect(isAppUrl("", "")).toBe(false);
  });

  it("opens only https links outside", () => {
    expect(isExternalUrl("https://platform.openai.com/api-keys")).toBe(true);
    expect(isExternalUrl("http://example.com/")).toBe(false);
    expect(isExternalUrl("file:///Applications/Calculator.app")).toBe(false);
    expect(isExternalUrl("javascript:alert(1)")).toBe(false);
    expect(isExternalUrl("smb://server/share")).toBe(false);
    expect(isExternalUrl("https://user:pw@example.com/")).toBe(false);
    expect(isExternalUrl("garbage")).toBe(false);
  });

  it("allows requests to the own server and in-page URLs only", () => {
    expect(isAllowedRequest(`${origin}/api/project`, origin)).toBe(true);
    expect(isAllowedRequest("data:image/png;base64,AAAA", origin)).toBe(true);
    expect(isAllowedRequest(`blob:${origin}/1234`, origin)).toBe(true);
    expect(isAllowedRequest("https://fonts.googleapis.com/css", origin)).toBe(false);
    expect(isAllowedRequest("https://api.openai.com/v1/images/edits", origin)).toBe(false);
    expect(isAllowedRequest("ws://127.0.0.1:9999/", origin)).toBe(false);
  });
});

describe("IPC channels", () => {
  it("are the same in the main process and the preload", () => {
    const preload = readFileSync(path.join(import.meta.dirname, "..", "desktop", "preload.cts"), "utf8");
    const used = [...preload.matchAll(/call\("([^"]+)"/g)].map((m) => m[1]);
    expect(used.sort()).toEqual(Object.values(CHANNELS).sort());
  });
});

describe("settings key provider", () => {
  it("prefers the provided key, falls back to the environment, and follows changes", () => {
    let stored: string | null = null;
    const settings = settingsFromEnv(
      { TATTOO_OPENAI_API_KEY: "sk-env", TATTOO_OPENAI_MODEL: "m1" },
      () => stored,
    );
    expect(settings.openai?.apiKey).toBe("sk-env");
    stored = "sk-keychain";
    expect(settings.openai).toMatchObject({ apiKey: "sk-keychain", model: "m1" });
    stored = null;
    expect(settings.openai?.apiKey).toBe("sk-env");
  });

  it("is off without any key, and env-only settings stay a plain value", () => {
    let stored: string | null = null;
    const settings = settingsFromEnv({}, () => stored);
    expect(settings.openai).toBeNull();
    stored = "sk-new";
    expect(settings.openai?.apiKey).toBe("sk-new");
    expect(settingsFromEnv({ OPENAI_API_KEY: "sk-x" }).openai?.apiKey).toBe("sk-x");
  });

  it("reaches the Image studio without a restart", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "tattoo-live-key-"));
    try {
      let stored: string | null = null;
      const manager = new EditManager(
        dir,
        settingsFromEnv({}, () => stored),
      );
      expect((await manager.generativeAvailability()).enabled).toBe(false);
      stored = KEY;
      expect(await manager.generativeAvailability()).toMatchObject({ enabled: true });
      await manager.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("desktop icon", () => {
  it("draws a valid PNG", () => {
    const png = drawIcon(64) as Buffer;
    expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    expect(png.readUInt32BE(16)).toBe(64);
    expect(png.readUInt32BE(20)).toBe(64);
    expect(png.subarray(-8, -4).toString("ascii")).toBe("IEND");
  });
});
