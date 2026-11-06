import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KeyOverview } from "../src/edits/keyCheck.ts";
import { createContext } from "../server/context.ts";
import { openaiKeyHandler } from "../server/openaiKeyApi.ts";
import { OpenAIKeys, SAVED_KEY_FILE, settingsFromEnv, type Env } from "../server/settings.ts";

const ENV_KEY = "sk-env-key-0000aaaa";
const UI_KEY = "sk-ui-key-1111bbbb";
const BAD_KEY = "sk-bad-key-2222cccc";

/** A fake OpenAI: 200 for good keys, 401 for BAD_KEY, or a network error when offline. */
function fakeOpenAI() {
  const state = { offline: false, calls: [] as { url: string; auth: string | undefined }[] };
  const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
    const auth = (init.headers as Record<string, string>).Authorization;
    state.calls.push({ url, auth });
    if (state.offline) throw new TypeError("fetch failed");
    if (auth === `Bearer ${BAD_KEY}`)
      return new Response(
        JSON.stringify({ error: { message: "Incorrect API key", code: "invalid_api_key" } }),
        {
          status: 401,
        },
      );
    return new Response(JSON.stringify({ id: "m" }), { status: 200 });
  });
  return { state, fetchImpl: fetchImpl as unknown as typeof fetch };
}

describe("openai key API", () => {
  let dir: string;
  let server: Server;
  let base: string;
  let keys: OpenAIKeys;
  let openai: ReturnType<typeof fakeOpenAI>;
  const configFile = () => path.join(dir, "config.json");
  const keyFile = () => path.join(dir, SAVED_KEY_FILE);

  async function start(env: Env, shell: Env = {}) {
    keys = new OpenAIKeys({ env, shell, file: keyFile(), configFile: configFile() });
    openai = fakeOpenAI();
    const handler = openaiKeyHandler(keys, { fetchImpl: openai.fetchImpl });
    server = createServer((req, res) => void handler(req, res, req.url ?? "/"));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  const api = async (p: string, method = "GET", body?: unknown, headers: Record<string, string> = {}) => {
    const res = await fetch(`${base}${p}`, {
      method,
      headers: body !== undefined ? { "Content-Type": "application/json", ...headers } : headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return { status: res.status, json: (await res.json()) as Record<string, unknown> };
  };

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "tattoo-key-"));
  });

  afterEach(async () => {
    await new Promise((r) => server.close(r));
    await rm(dir, { recursive: true, force: true });
  });

  it("reports the .env key with a masked hint, never the key", async () => {
    await start({ TATTOO_OPENAI_API_KEY: ENV_KEY });
    const { json } = await api("/");
    const o = json as unknown as KeyOverview;
    expect(o.active).toEqual({ source: "env-file", hint: "…aaaa" });
    expect(o).toMatchObject({ canSave: true, saved: false, startupCheck: true, lastCheck: null });
    expect(JSON.stringify(json)).not.toContain(ENV_KEY);
  });

  it("tells a shell variable from .env", async () => {
    await start({ TATTOO_OPENAI_API_KEY: ENV_KEY }, { TATTOO_OPENAI_API_KEY: ENV_KEY });
    expect(((await api("/")).json as unknown as KeyOverview).active?.source).toBe("environment");
  });

  it("checks the key once per run at startup and caches the result", async () => {
    await start({ TATTOO_OPENAI_API_KEY: ENV_KEY });
    const [a, b] = await Promise.all([api("/startup"), api("/startup")]);
    expect(a.json).toMatchObject({ enabled: true, result: { status: "valid" } });
    expect(b.json).toEqual(a.json);
    await api("/startup");
    expect(openai.state.calls).toHaveLength(1);
    expect(openai.state.calls[0]!.url).toMatch(/^https:\/\/api\.openai\.com\/v1\/models\//);
    expect(((await api("/")).json as unknown as KeyOverview).lastCheck?.status).toBe("valid");
  });

  it("makes no request without a key or with the check off, and keeps the switch", async () => {
    await start({});
    expect((await api("/startup")).json).toEqual({ enabled: true, result: null });
    expect((await api("/settings", "PUT", { startupCheck: false })).json).toMatchObject({
      startupCheck: false,
    });
    const config = JSON.parse(await readFile(configFile(), "utf8")) as Record<string, unknown>;
    expect(config.openaiStartupCheck).toBe(false);
    await keys.save(UI_KEY);
    expect((await api("/startup")).json).toEqual({ enabled: false, result: null });
    expect(openai.state.calls).toHaveLength(0);
  });

  it("keeps other user-config keys when switching", async () => {
    await writeFile(configFile(), JSON.stringify({ project: "/p", recent: ["/p"], extra: 1 }));
    await start({});
    await api("/settings", "PUT", { startupCheck: false });
    const config = JSON.parse(await readFile(configFile(), "utf8")) as Record<string, unknown>;
    expect(config).toMatchObject({ project: "/p", recent: ["/p"], extra: 1, openaiStartupCheck: false });
  });

  it("reports offline as network, not as a broken key", async () => {
    await start({ TATTOO_OPENAI_API_KEY: ENV_KEY });
    openai.state.offline = true;
    expect((await api("/startup")).json).toMatchObject({ result: { status: "network" } });
  });

  it("saves a valid key in a 0600 file that wins over .env, and never touches .env", async () => {
    const envFile = path.join(dir, ".env");
    await writeFile(envFile, `TATTOO_OPENAI_API_KEY=${ENV_KEY}\n`);
    await start({ TATTOO_OPENAI_API_KEY: ENV_KEY });
    const { status, json } = await api("/", "PUT", { key: ` ${UI_KEY} ` });
    expect(status).toBe(200);
    expect(json).toMatchObject({
      result: { status: "valid" },
      overview: {
        active: { source: "saved", hint: "…bbbb" },
        env: { source: "env-file", hint: "…aaaa" },
        saved: true,
      },
    });
    expect(JSON.stringify(json)).not.toContain(UI_KEY);
    expect(await readFile(keyFile(), "utf8")).toBe(`${UI_KEY}\n`);
    expect((await stat(keyFile())).mode & 0o777).toBe(0o600);
    expect(keys.settings()?.apiKey).toBe(UI_KEY);
    expect(await readFile(envFile, "utf8")).toBe(`TATTOO_OPENAI_API_KEY=${ENV_KEY}\n`);

    // Remove: the .env key is in use again.
    const removed = (await api("/", "DELETE")).json as unknown as KeyOverview;
    expect(removed.active).toEqual({ source: "env-file", hint: "…aaaa" });
    expect(keys.settings()?.apiKey).toBe(ENV_KEY);
    expect(await readFile(envFile, "utf8")).toBe(`TATTOO_OPENAI_API_KEY=${ENV_KEY}\n`);
  });

  it("does not save a key OpenAI rejects", async () => {
    await start({ TATTOO_OPENAI_API_KEY: ENV_KEY });
    const { status, json } = await api("/", "PUT", { key: BAD_KEY });
    expect(status).toBe(422);
    expect(json).toMatchObject({ result: { status: "invalid" } });
    expect(keys.current()?.key).toBe(ENV_KEY);
    await expect(stat(keyFile())).rejects.toThrow();
  });

  it("saves while offline (offline is not a broken key)", async () => {
    await start({});
    openai.state.offline = true;
    const { status, json } = await api("/", "PUT", { key: UI_KEY });
    expect(status).toBe(200);
    expect(json).toMatchObject({ result: { status: "network" } });
    expect(keys.current()).toEqual({ key: UI_KEY, source: "saved" });
  });

  it("refuses malformed keys before any request", async () => {
    await start({});
    expect((await api("/", "PUT", { key: "hunter2" })).status).toBe(400);
    expect((await api("/test", "POST", { key: "sk-a b" })).status).toBe(400);
    expect(openai.state.calls).toHaveLength(0);
  });

  it("tests a given key or the key in use, fresh every time", async () => {
    await start({ TATTOO_OPENAI_API_KEY: ENV_KEY });
    expect((await api("/test", "POST", { key: BAD_KEY })).json).toMatchObject({
      result: { status: "invalid" },
    });
    expect((await api("/test", "POST", {})).json).toMatchObject({ result: { status: "valid" } });
    expect((await api("/test", "POST", {})).json).toMatchObject({ result: { status: "valid" } });
    expect(openai.state.calls.map((c) => c.auth)).toEqual([
      `Bearer ${BAD_KEY}`,
      `Bearer ${ENV_KEY}`,
      `Bearer ${ENV_KEY}`,
    ]);
  });

  it("answers 409 for Test key without a key", async () => {
    await start({});
    expect((await api("/test", "POST", {})).status).toBe(409);
  });

  it("refuses cross-site writes", async () => {
    await start({});
    const r = await api("/", "PUT", { key: UI_KEY }, { "Sec-Fetch-Site": "cross-site" });
    expect(r.status).toBe(403);
    expect(keys.current()).toBeNull();
  });
});

describe("key sources", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "tattoo-keysrc-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("orders desktop Keychain > saved file > environment", async () => {
    const file = path.join(dir, SAVED_KEY_FILE);
    await writeFile(file, `${UI_KEY}\n`, { mode: 0o600 });
    const fromFile = new OpenAIKeys({ env: { TATTOO_OPENAI_API_KEY: ENV_KEY }, shell: {}, file });
    expect(fromFile.current()).toEqual({ key: UI_KEY, source: "saved" });
    let stored: string | null = "sk-keychain-3333";
    const desktop = new OpenAIKeys({ env: { TATTOO_OPENAI_API_KEY: ENV_KEY }, desktop: () => stored, file });
    expect(desktop.current()?.source).toBe("desktop");
    // The desktop app never uses or writes the server's key file.
    expect(desktop.canSave).toBe(false);
    stored = null;
    expect(desktop.current()).toEqual({ key: ENV_KEY, source: "env-file" });
  });

  it("is wired by createContext next to the user config, and not in the desktop app", async () => {
    const configFile = path.join(dir, "cfg", "config.json");
    const ctx = createContext({ env: {}, root: dir, home: dir, configFile, sampleDir: null });
    expect(ctx.settings.keys.file).toBe(path.join(dir, "cfg", SAVED_KEY_FILE));
    await ctx.settings.keys.save(UI_KEY);
    expect(ctx.settings.openai?.apiKey).toBe(UI_KEY);
    const desktop = createContext({
      env: {},
      root: dir,
      home: dir,
      configFile,
      sampleDir: null,
      openaiKey: () => null,
    });
    expect(desktop.settings.keys.file).toBeNull();
    expect(desktop.settings.openai).toBeNull();
  });

  it("keeps model and options from the environment", () => {
    const s = settingsFromEnv({ TATTOO_OPENAI_MODEL: "m2" }, () => UI_KEY);
    expect(s.openai).toMatchObject({ apiKey: UI_KEY, model: "m2" });
    expect(s.keys.model()).toBe("m2");
  });
});
