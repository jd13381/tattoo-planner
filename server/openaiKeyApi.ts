// API of the OpenAI key (docs/adr/0016-openai-key-check.md). The key itself never goes to the page:
// answers carry its source and a masked hint (last four characters) only.
//   GET    /api/openai-key            → KeyOverview
//   GET    /api/openai-key/startup    → StartupCheck: checks the key once per run (cached), unless off
//   POST   /api/openai-key/test       body { key? } → { result }: checks the given key, or the one in use
//   PUT    /api/openai-key            body { key } → { overview, result }: checks, then saves (not when
//                                      OpenAI rejects the key); run from a checkout only
//   DELETE /api/openai-key            → KeyOverview: deletes the saved key (never .env)
//   PUT    /api/openai-key/settings   body { startupCheck } → KeyOverview
import {
  checkOpenAIKey,
  keyHint,
  keyProblem,
  type KeyCheckResult,
  type KeyOverview,
  type StartupCheck,
} from "../src/edits/keyCheck.ts";
import { HttpError, isCrossSite, readJson, send, sendError, subPath, type Handler } from "./http.ts";
import type { OpenAIKeys } from "./settings.ts";

/** Results kept per key during a run (a few: the key in use and keys just tested). */
const MAX_CACHED = 8;

export function openaiKeyHandler(
  keys: OpenAIKeys,
  opts: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Handler {
  /** Checks per key for this run; a pending check is shared, so the startup check runs once. */
  const checks = new Map<string, Promise<KeyCheckResult>>();
  const done = new Map<string, KeyCheckResult>();

  const check = (key: string, fresh: boolean): Promise<KeyCheckResult> => {
    const known = checks.get(key);
    if (known && !fresh) return known;
    const p = checkOpenAIKey(key, keys.model(), opts.fetchImpl ?? fetch, opts.timeoutMs).then((r) => {
      done.set(key, r);
      return r;
    });
    checks.delete(key);
    checks.set(key, p);
    while (checks.size > MAX_CACHED) {
      const oldest = checks.keys().next().value as string;
      checks.delete(oldest);
      done.delete(oldest);
    }
    return p;
  };

  const overview = async (): Promise<KeyOverview> => {
    const active = keys.current();
    const env = keys.envKey();
    return {
      active: active ? { source: active.source, hint: keyHint(active.key) } : null,
      env: env ? { source: env.source, hint: keyHint(env.key) } : null,
      model: keys.model(),
      canSave: keys.canSave,
      saved: active?.source === "saved",
      startupCheck: await keys.startupCheckEnabled(),
      lastCheck: active ? (done.get(active.key) ?? null) : null,
    };
  };

  return async (req, res, url) => {
    try {
      const sub = subPath(url).replace(/\/+$/, "") || "/";
      const method = req.method ?? "GET";
      if (method === "GET") {
        if (sub === "/") return send(res, 200, await overview());
        if (sub === "/startup") {
          const enabled = await keys.startupCheckEnabled();
          const active = keys.current();
          // Off, or no key: no request at all.
          const result = enabled && active ? await check(active.key, false) : null;
          return send(res, 200, { enabled, result } satisfies StartupCheck);
        }
        throw new HttpError(404, "not found");
      }
      // Only the planner page itself may test or change the key.
      if (isCrossSite(req.headers)) throw new HttpError(403, "cross-site request refused");
      const body =
        method === "DELETE" ? null : ((await readJson(req, 10_000)) as Record<string, unknown> | null);
      if (method === "POST" && sub === "/test") {
        if (body?.key !== undefined) {
          const problem = keyProblem(body.key);
          if (problem) throw new HttpError(400, problem);
          return send(res, 200, { result: await check((body.key as string).trim(), true) });
        }
        const active = keys.current();
        if (!active) throw new HttpError(409, "No OpenAI API key is set.");
        return send(res, 200, { result: await check(active.key, true) });
      }
      if (method === "PUT" && sub === "/settings") {
        if (typeof body?.startupCheck !== "boolean") throw new HttpError(400, "expected { startupCheck }");
        await keys.setStartupCheck(body.startupCheck);
        return send(res, 200, await overview());
      }
      if (sub !== "/") throw new HttpError(404, "not found");
      if (method === "PUT") {
        if (!keys.canSave)
          throw new HttpError(409, "The desktop app keeps the key in the Keychain; save it there.");
        const problem = keyProblem(body?.key);
        if (problem) throw new HttpError(400, problem);
        const key = (body!.key as string).trim();
        const result = await check(key, true);
        // A key OpenAI rejects is not saved; any other outcome is (offline is not a broken key).
        if (result.status === "invalid") return send(res, 422, { error: result.message, result });
        await keys.save(key);
        return send(res, 200, { overview: await overview(), result });
      }
      if (method === "DELETE") {
        if (!keys.canSave) throw new HttpError(409, "The desktop app keeps the key in the Keychain.");
        await keys.remove();
        return send(res, 200, await overview());
      }
      throw new HttpError(405, "method not allowed");
    } catch (e) {
      sendError(res, e, 500);
    }
  };
}
