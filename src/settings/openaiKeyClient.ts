// Page-side calls of the OpenAI key API (server/openaiKeyApi.ts). The page sends a key only when the
// user saves or tests a new one; answers carry a masked hint, never the key.
import type { KeyCheckResult, KeyOverview, StartupCheck } from "../edits/keyCheck.ts";

const ENDPOINT = "/api/openai-key";

/** Fired on window after a check or a key change, so the app-level notice can follow. */
export const KEY_CHECKED_EVENT = "tattoo:openai-key-checked";

export function announceKeyCheck(result: KeyCheckResult | null) {
  window.dispatchEvent(new CustomEvent<KeyCheckResult | null>(KEY_CHECKED_EVENT, { detail: result }));
}

async function call<T>(path: string, init?: { method: string; body?: unknown }): Promise<T> {
  const res = await fetch(`${ENDPOINT}${path}`, {
    method: init?.method ?? "GET",
    ...(init?.body !== undefined
      ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(init.body) }
      : {}),
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string; result?: KeyCheckResult };
  if (!res.ok) {
    const err = new Error(json.error ?? `HTTP ${res.status}`) as Error & { result?: KeyCheckResult };
    if (json.result) err.result = json.result;
    throw err;
  }
  return json;
}

export const keyApi = {
  overview: () => call<KeyOverview>("/"),
  startup: () => call<StartupCheck>("/startup"),
  /** Checks `key`, or the key in use when omitted. */
  test: (key?: string) =>
    call<{ result: KeyCheckResult }>("/test", { method: "POST", body: key === undefined ? {} : { key } }),
  /** Checks and saves (run from a checkout); rejects with `.result` when OpenAI rejects the key. */
  save: (key: string) =>
    call<{ overview: KeyOverview; result: KeyCheckResult }>("/", { method: "PUT", body: { key } }),
  remove: () => call<KeyOverview>("/", { method: "DELETE" }),
  setStartupCheck: (startupCheck: boolean) =>
    call<KeyOverview>("/settings", { method: "PUT", body: { startupCheck } }),
};
