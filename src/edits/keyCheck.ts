// Framework-free rules for checking an OpenAI API key (docs/adr/0016-openai-key-check.md): the one
// cheap request that tests a key (GET /v1/models/{model}: authenticated, no image, no cost), how its
// answer is classified, and the plain-English notice the app shows when a key stopped working.
// The server (server/openaiKeyApi.ts) makes the request; the page only sees the classified result.

export const OPENAI_MODELS_URL = "https://api.openai.com/v1/models";
/** A check that takes longer than this counts as a network problem. */
export const KEY_CHECK_TIMEOUT_MS = 10_000;

export type KeyCheckStatus =
  /** OpenAI accepted the key and the image model is available to it. */
  | "valid"
  /** 401: OpenAI rejected the key (wrong, revoked or deleted). */
  | "invalid"
  /** 403/404: the key works, but this account or project may not use the image model. */
  | "no-model-access"
  /** 429 insufficient_quota: no credit left or the billing limit is reached. */
  | "quota"
  /** 429 otherwise: too many requests right now; the key itself is fine. */
  | "rate-limited"
  /** OpenAI could not be reached (offline, DNS, proxy, timeout). Says nothing about the key. */
  | "network"
  /** Anything else (5xx, an unexpected answer). */
  | "error";

export type KeyCheckResult = {
  status: KeyCheckStatus;
  /** One sentence for the user; never contains the key. */
  message: string;
  /** The model the key was checked against. */
  model: string;
  /** ISO time of the check. */
  checkedAt: string;
};

/** Longest key accepted; OpenAI keys are well below it. */
export const MAX_KEY_LENGTH = 512;

/** Null when `key` looks like an OpenAI API key, else why not (never echoes the key). */
export function keyProblem(key: unknown): string | null {
  if (typeof key !== "string") return "The key must be text.";
  const k = key.trim();
  if (k === "") return "Paste a key first.";
  if (k.length > MAX_KEY_LENGTH) return "That is too long for an API key.";
  // eslint-disable-next-line no-control-regex
  if (/[\s\u0000-\u001f\u007f]/.test(k)) return "An API key has no spaces or line breaks.";
  if (!k.startsWith("sk-")) return "OpenAI API keys start with “sk-”.";
  return null;
}

/** Statuses after which generative edits will not work until the user changes something. */
export function isKeyBroken(status: KeyCheckStatus): boolean {
  return status === "invalid" || status === "no-model-access" || status === "quota";
}

/** The masked hint shown for a key: its last four characters. */
export function keyHint(key: string): string {
  const k = key.trim();
  return k.length >= 8 ? `…${k.slice(-4)}` : "…";
}

/** Removes anything that looks like an API key from a message (OpenAI echoes a masked key on 401). */
export function redactKeys(message: string): string {
  return message.replace(/sk-[A-Za-z0-9_*-]{4,}/g, "sk-…");
}

function openaiMessage(body: unknown): { message: string | null; code: string | null } {
  const err = (body as { error?: { message?: unknown; code?: unknown; type?: unknown } } | null)?.error;
  const message =
    typeof err?.message === "string" && err.message.trim() ? redactKeys(err.message.trim()) : null;
  const code = typeof err?.code === "string" ? err.code : typeof err?.type === "string" ? err.type : null;
  return { message, code };
}

/** Classifies the answer of GET /v1/models/{model}. */
export function classifyKeyResponse(
  status: number,
  body: unknown,
  model: string,
  now: Date = new Date(),
): KeyCheckResult {
  const result = (s: KeyCheckStatus, message: string): KeyCheckResult => ({
    status: s,
    message,
    model,
    checkedAt: now.toISOString(),
  });
  const { message, code } = openaiMessage(body);
  const detail = message ? ` OpenAI says: ${message}` : "";
  if (status >= 200 && status < 300) return result("valid", `The key works and can use ${model}.`);
  if (status === 401)
    return result("invalid", `OpenAI rejected the key: it is wrong, revoked or deleted.${detail}`);
  if (status === 403 || status === 404)
    return result(
      "no-model-access",
      `The key works, but it has no access to the image model ${model} (the organisation may need verifying, or the project restricts models).${detail}`,
    );
  if (status === 429) {
    if (code === "insufficient_quota" || /quota|billing/i.test(message ?? ""))
      return result(
        "quota",
        `The key works, but the OpenAI account has no credit left or reached its limit.${detail}`,
      );
    return result(
      "rate-limited",
      "OpenAI is rate-limiting this key right now; the key itself works. Try again in a minute.",
    );
  }
  if (status >= 500)
    return result(
      "error",
      `OpenAI had a problem (HTTP ${status}); the key could not be checked. Try again later.`,
    );
  return result("error", `Unexpected answer from OpenAI (HTTP ${status}).${detail}`);
}

/** Classifies a failed request (no HTTP answer at all). */
export function classifyKeyError(e: unknown, model: string, now: Date = new Date()): KeyCheckResult {
  const timeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
  return {
    status: "network",
    message: timeout
      ? "OpenAI did not answer in time; the key could not be checked. Are you offline?"
      : "Could not reach OpenAI; the key could not be checked. Are you offline?",
    model,
    checkedAt: now.toISOString(),
  };
}

/** The one request of a check: no body, no image, only the key in the Authorization header. */
export function keyCheckRequest(key: string, model: string): { url: string; init: RequestInit } {
  return {
    url: `${OPENAI_MODELS_URL}/${encodeURIComponent(model)}`,
    init: { method: "GET", headers: { Authorization: `Bearer ${key.trim()}` } },
  };
}

/** Checks a key; never throws. `fetchImpl` is replaceable in tests. */
export async function checkOpenAIKey(
  key: string,
  model: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = KEY_CHECK_TIMEOUT_MS,
): Promise<KeyCheckResult> {
  const { url, init } = keyCheckRequest(key, model);
  let res: Response;
  try {
    res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    return classifyKeyError(e, model);
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return classifyKeyResponse(res.status, body, model);
}

/** Text of the app-level notice after a failed startup check; null when there is nothing to say. */
export type StartupNotice = { tone: "error" | "warn"; title: string; body: string };

export const GENERATIVE_IMPACT =
  "Generative features in the Image studio (Generate, Edit with GPT) won't work until you fix the key in Settings → Image generation. Everything else works.";

export function startupNotice(result: KeyCheckResult | null): StartupNotice | null {
  if (!result) return null;
  switch (result.status) {
    case "valid":
    case "rate-limited":
      return null;
    case "invalid":
      return {
        tone: "error",
        title: "Your OpenAI API key no longer works.",
        body: `${result.message} ${GENERATIVE_IMPACT}`,
      };
    case "no-model-access":
      return {
        tone: "error",
        title: "Your OpenAI API key cannot use the image model.",
        body: `${result.message} ${GENERATIVE_IMPACT}`,
      };
    case "quota":
      return {
        tone: "error",
        title: "Your OpenAI account has no credit left.",
        body: `${result.message} Generative features in the Image studio (Generate, Edit with GPT) won't work until you add credit at platform.openai.com (Billing). Everything else works.`,
      };
    case "network":
      return {
        tone: "warn",
        title: "Could not check your OpenAI API key.",
        body: "OpenAI could not be reached, so the planner could not check the key; this does not mean the key is broken. Generative features in the Image studio need a connection to OpenAI. Everything else works offline.",
      };
    case "error":
      return {
        tone: "warn",
        title: "Could not check your OpenAI API key.",
        body: `${result.message} Generative features in the Image studio may not work right now. Everything else works.`,
      };
  }
}

/** Where the key in use comes from (server/settings.ts has the order). */
export type KeySource = "desktop" | "saved" | "env-file" | "environment";

/** GET /api/openai-key (server/openaiKeyApi.ts). Never contains the key, only a masked hint. */
export type KeyOverview = {
  /** The key in use, or null when none is set. */
  active: { source: KeySource; hint: string } | null;
  /** The key from .env or the shell, also when another one wins over it. */
  env: { source: KeySource; hint: string } | null;
  /** The image model the key is checked against. */
  model: string;
  /** Keys can be saved through the API (run from a checkout); the desktop app saves in its Keychain. */
  canSave: boolean;
  /** A key saved through the API is the one in use. */
  saved: boolean;
  /** The startup check is on. */
  startupCheck: boolean;
  /** The latest check of the key in use during this run, or null. */
  lastCheck: KeyCheckResult | null;
};

/** GET /api/openai-key/startup. */
export type StartupCheck = { enabled: boolean; result: KeyCheckResult | null };

/** "from .env", "saved in the macOS Keychain", … for the Settings page. */
export function keySourceLabel(source: KeySource, desktopBackend?: string): string {
  switch (source) {
    case "desktop":
      return `saved in the ${desktopBackend ?? "system keychain"}`;
    case "saved":
      return "saved in the planner’s settings";
    case "env-file":
      return "from .env (TATTOO_OPENAI_API_KEY)";
    case "environment":
      return "from the environment (TATTOO_OPENAI_API_KEY)";
  }
}
