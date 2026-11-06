import { describe, expect, it, vi } from "vitest";
import {
  checkOpenAIKey,
  classifyKeyError,
  classifyKeyResponse,
  GENERATIVE_IMPACT,
  isKeyBroken,
  keyCheckRequest,
  keyHint,
  keySourceLabel,
  redactKeys,
  startupNotice,
  type KeyCheckResult,
} from "../src/edits/keyCheck.ts";

const MODEL = "gpt-image-2.5-sunburst";
const KEY = "sk-proj-abcdefghijklmnop1234";
const NOW = new Date("2026-11-06T10:00:00Z");

describe("classifyKeyResponse", () => {
  it("accepts a 200", () => {
    const r = classifyKeyResponse(200, { id: MODEL }, MODEL, NOW);
    expect(r).toEqual({
      status: "valid",
      message: expect.stringContaining(MODEL),
      model: MODEL,
      checkedAt: NOW.toISOString(),
    });
  });

  it("reads 401 as an invalid key and never echoes a key", () => {
    const r = classifyKeyResponse(
      401,
      { error: { message: "Incorrect API key provided: sk-proj-****1234.", code: "invalid_api_key" } },
      MODEL,
    );
    expect(r.status).toBe("invalid");
    expect(r.message).toMatch(/rejected/);
    expect(r.message).not.toMatch(/\*\*\*\*1234/);
  });

  it("reads 403 and 404 as no access to the image model", () => {
    expect(classifyKeyResponse(403, {}, MODEL).status).toBe("no-model-access");
    const r = classifyKeyResponse(404, { error: { message: "The model does not exist" } }, MODEL);
    expect(r.status).toBe("no-model-access");
    expect(r.message).toContain(MODEL);
    expect(r.message).toContain("The model does not exist");
  });

  it("tells quota from rate limits", () => {
    expect(
      classifyKeyResponse(
        429,
        { error: { code: "insufficient_quota", message: "You exceeded your quota" } },
        MODEL,
      ).status,
    ).toBe("quota");
    expect(
      classifyKeyResponse(429, { error: { message: "Check your plan and billing details" } }, MODEL).status,
    ).toBe("quota");
    expect(classifyKeyResponse(429, { error: { message: "Rate limit reached" } }, MODEL).status).toBe(
      "rate-limited",
    );
  });

  it("reads 5xx and other answers as errors, also without a JSON body", () => {
    expect(classifyKeyResponse(503, null, MODEL)).toMatchObject({ status: "error", message: /HTTP 503/ });
    expect(classifyKeyResponse(400, "x", MODEL)).toMatchObject({ status: "error", message: /HTTP 400/ });
  });
});

describe("checkOpenAIKey", () => {
  it("sends one GET for the model with the key as bearer token and nothing else", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ id: MODEL }), { status: 200 }));
    const r = await checkOpenAIKey(` ${KEY} `, MODEL, fetchImpl as unknown as typeof fetch);
    expect(r.status).toBe("valid");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://api.openai.com/v1/models/${MODEL}`);
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("encodes the model name in the URL", () => {
    expect(keyCheckRequest(KEY, "a/b").url).toBe("https://api.openai.com/v1/models/a%2Fb");
  });

  it("reports a network failure as network, not as a broken key", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const r = await checkOpenAIKey(KEY, MODEL, fetchImpl as unknown as typeof fetch);
    expect(r.status).toBe("network");
    expect(isKeyBroken(r.status)).toBe(false);
  });

  it("reports a timeout as network", async () => {
    const fetchImpl = ((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) =>
        init.signal!.addEventListener("abort", () => reject(init.signal!.reason)),
      )) as unknown as typeof fetch;
    const r = await checkOpenAIKey(KEY, MODEL, fetchImpl, 20);
    expect(r).toMatchObject({ status: "network", message: /in time/ });
  });

  it("copes with a non-JSON answer", async () => {
    const fetchImpl = vi.fn(async () => new Response("<html>", { status: 401 }));
    expect((await checkOpenAIKey(KEY, MODEL, fetchImpl as unknown as typeof fetch)).status).toBe("invalid");
  });
});

describe("helpers", () => {
  it("masks a key to its last four characters", () => {
    expect(keyHint(KEY)).toBe("…1234");
    expect(keyHint("sk-1")).toBe("…");
  });

  it("redacts key-like strings", () => {
    expect(redactKeys(`bad key ${KEY} and sk-****1234`)).toBe("bad key sk-… and sk-…");
  });

  it("names every key source", () => {
    expect(keySourceLabel("env-file")).toMatch(/\.env/);
    expect(keySourceLabel("environment")).toMatch(/environment/);
    expect(keySourceLabel("saved")).toMatch(/settings/);
    expect(keySourceLabel("desktop", "macOS Keychain")).toBe("saved in the macOS Keychain");
  });

  it("classifies a thrown error as network", () => {
    expect(classifyKeyError(new Error("x"), MODEL).status).toBe("network");
  });
});

describe("startupNotice", () => {
  const result = (status: KeyCheckResult["status"]): KeyCheckResult => ({
    status,
    message: "Detail.",
    model: MODEL,
    checkedAt: NOW.toISOString(),
  });

  it("says nothing when the key works or nothing was checked", () => {
    expect(startupNotice(null)).toBeNull();
    expect(startupNotice(result("valid"))).toBeNull();
    expect(startupNotice(result("rate-limited"))).toBeNull();
  });

  it("explains a broken key and what it means for the Image studio", () => {
    const n = startupNotice(result("invalid"))!;
    expect(n.tone).toBe("error");
    expect(n.body).toContain(GENERATIVE_IMPACT);
    expect(n.body).toContain("Settings → Image generation");
    expect(n.body).toContain("Everything else works.");
    expect(startupNotice(result("no-model-access"))!.body).toContain(GENERATIVE_IMPACT);
    expect(startupNotice(result("quota"))!.body).toMatch(/credit/);
  });

  it("words offline differently from a broken key", () => {
    const n = startupNotice(result("network"))!;
    expect(n.tone).toBe("warn");
    expect(n.body).toMatch(/does not mean the key is broken/);
    expect(n.body).not.toContain(GENERATIVE_IMPACT);
  });
});
