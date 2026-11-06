// Settings → Image generation: the OpenAI key (bring your own), where it comes from, a check of it
// and the startup-check switch (docs/adr/0016-openai-key-check.md). The key is entered here in the
// desktop app (kept in the Keychain by the main process, docs/adr/0015-desktop-app.md) and when run
// from a checkout (kept by the server in a 0600 file; .env is never changed). The page sends a key
// only to save or test it and never reads one back: it sees a masked hint.
import { useCallback, useEffect, useState } from "react";
import { desktopBridge, type KeyStatus } from "../desktop/bridge.ts";
import {
  isKeyBroken,
  keyProblem,
  keySourceLabel,
  type KeyCheckResult,
  type KeyCheckStatus,
  type KeyOverview,
} from "../edits/keyCheck.ts";
import { announceKeyCheck, keyApi } from "./openaiKeyClient.ts";

/**
 * docs/privacy.md in the repository. It moves with the repository when the public one opens
 * (docs/product/roadmap.md, Phase D). The desktop shell opens https links in the system browser.
 */
export const PRIVACY_URL = "https://github.com/jd13381/tattoo-planner/blob/main/docs/privacy.md";

function resultTone(status: KeyCheckStatus): "ok" | "warn" | "error" {
  if (status === "valid") return "ok";
  return isKeyBroken(status) ? "error" : "warn";
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function ImageGenerationSettings() {
  const desktop = desktopBridge();
  const [overview, setOverview] = useState<KeyOverview | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [desktopStatus, setDesktopStatus] = useState<KeyStatus | null>(null);
  /** The latest check shown under the form; falls back to the server's last check of the key in use. */
  const [result, setResult] = useState<KeyCheckResult | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<null | "save" | "test" | "remove" | "switch">(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    () => Promise.all([keyApi.overview(), desktop ? desktop.getKeyStatus() : null]),
    [desktop],
  );
  const apply = useCallback(([o, d]: [KeyOverview, KeyStatus | null]) => {
    setOverview(o);
    setDesktopStatus(d);
    setLoadFailed(false);
  }, []);
  const reload = useCallback(() => load().then(apply, () => setLoadFailed(true)), [load, apply]);

  useEffect(() => {
    let cancelled = false;
    load().then(
      (v) => !cancelled && apply(v),
      () => !cancelled && setLoadFailed(true),
    );
    return () => {
      cancelled = true;
    };
  }, [load, apply]);

  const shown = result ?? overview?.lastCheck ?? null;
  const active = overview?.active ?? null;
  const unavailable = desktopStatus !== null && !desktopStatus.encryptionAvailable;
  const canEnter = desktop ? !unavailable : !!overview?.canSave;
  const removable = desktop ? !!desktopStatus?.stored : !!overview?.saved;

  const act = async (kind: NonNullable<typeof busy>, fn: () => Promise<void>) => {
    setBusy(kind);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const save = () =>
    act("save", async () => {
      const key = draft.trim();
      const problem = keyProblem(key);
      if (problem) throw new Error(problem);
      setResult(null);
      let checked: KeyCheckResult;
      if (desktop) {
        // Checked first through the local server; a key OpenAI rejects is not stored.
        checked = (await keyApi.test(key)).result;
        if (checked.status === "invalid") {
          setResult(checked);
          return;
        }
        await desktop.setOpenAIKey(key);
      } else {
        try {
          checked = (await keyApi.save(key)).result;
        } catch (e) {
          const rejected = (e as { result?: KeyCheckResult }).result;
          if (rejected) {
            setResult(rejected);
            return;
          }
          throw e;
        }
      }
      setDraft("");
      // Saved also when the check could not finish (offline is not a broken key); the line says so.
      setResult({ ...checked, message: `Saved. ${checked.message}` });
      announceKeyCheck(checked);
      await reload();
    });

  const test = () =>
    act("test", async () => {
      const { result: r } = await keyApi.test();
      setResult(r);
      announceKeyCheck(r);
      await reload();
    });

  const remove = () =>
    act("remove", async () => {
      if (desktop) await desktop.clearOpenAIKey();
      else await keyApi.remove();
      setResult(null);
      announceKeyCheck(null);
      await reload();
    });

  const toggleStartup = (on: boolean) =>
    act("switch", async () => {
      setOverview(await keyApi.setStartupCheck(on));
    });

  const chip = !overview ? null : !active ? (
    <span className="chip warn">Not set up</span>
  ) : shown && isKeyBroken(shown.status) ? (
    <span className="chip error">Key problem</span>
  ) : shown?.status === "valid" ? (
    <span className="chip ok">Ready</span>
  ) : (
    <span className="chip">Key set</span>
  );

  return (
    <div className="settings-section">
      <header className="settings-section-head">
        <h2>Image generation</h2>
        {chip}
        {loadFailed && <span className="chip error">No answer</span>}
      </header>
      <p className="muted">
        The Image studio can redraw a reference image or create a new one with OpenAI’s GPT Image, using your
        own API key. It is optional: everything else works without a key. A request sends the image and your
        instruction to OpenAI and costs a few cents.
      </p>
      <p className="muted">
        Privacy: images are only sent to OpenAI when you run a generative edit. The key is only sent to
        OpenAI, with those requests and with the key check below (no images).{" "}
        <a href={PRIVACY_URL} target="_blank" rel="noreferrer">
          What the planner sends, and where
        </a>
      </p>

      <section className="df-panel" aria-label="API key">
        <div className="df-panel-head">
          <h3 className="float-title">API key</h3>
          {active && <span className="mono faint">{active.hint}</span>}
        </div>
        <p className="df-panel-note">
          {loadFailed
            ? "The planner’s local server did not answer."
            : !overview
              ? "Checking…"
              : active
                ? `Key ${active.hint}, ${keySourceLabel(active.source, desktopStatus?.backend)}. Model: ${overview.model}.`
                : unavailable
                  ? `No key is set. The ${desktopStatus!.backend} is not available, so a key cannot be stored safely.`
                  : "No OpenAI API key is set yet. Create one at platform.openai.com (API keys) and add some credit under Billing."}
        </p>
        {overview && <PrecedenceNote overview={overview} desktop={!!desktop} />}
        {canEnter && (
          <form
            className="key-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (draft.trim()) void save();
            }}
          >
            <label className="pj-field">
              <span>{active ? "Replace with a new key" : "OpenAI API key"}</span>
              <input
                type="password"
                value={draft}
                placeholder="sk-…"
                autoComplete="off"
                spellCheck={false}
                disabled={busy !== null}
                onChange={(e) => setDraft(e.target.value)}
              />
            </label>
            <button type="submit" className="primary" disabled={busy !== null || !draft.trim()}>
              {busy === "save" ? "Checking…" : "Check & save"}
            </button>
            {removable && (
              <button type="button" className="ghost" disabled={busy !== null} onClick={() => void remove()}>
                Remove
              </button>
            )}
            <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer" className="small">
              Get a key
            </a>
          </form>
        )}
        {!desktop && overview && !overview.canSave && (
          <p className="df-panel-note">
            This planner cannot save a key itself; set <code>TATTOO_OPENAI_API_KEY</code> in its{" "}
            <code>.env</code> and restart it.
          </p>
        )}
        <div className="key-check-row">
          <button type="button" disabled={!active || busy !== null} onClick={() => void test()}>
            {busy === "test" ? "Testing…" : "Test key"}
          </button>
          {shown ? (
            <p className={`field-hint ${resultTone(shown.status)}`} role="status">
              {shown.message}
            </p>
          ) : (
            <p className="field-hint">
              {active ? "Not checked yet in this session." : "Save a key to check it."}
            </p>
          )}
        </div>
        {error && (
          <p className="field-hint error key-error" role="alert">
            {error}
          </p>
        )}
      </section>

      <section className="df-panel" aria-label="Startup check">
        <div className="df-panel-head">
          <h3 className="float-title">Startup check</h3>
        </div>
        <label className="inline switch-label key-switch">
          <input
            type="checkbox"
            role="switch"
            className="switch"
            checked={overview?.startupCheck ?? true}
            disabled={!overview || busy !== null}
            onChange={(e) => void toggleStartup(e.target.checked)}
          />
          Check the key when the planner starts
        </label>
        <p className="df-panel-note">
          Once per start, the planner’s server asks OpenAI whether the key can use{" "}
          {overview?.model ?? "the image model"} (one small request with the key, no images, no cost) and
          shows a notice if it no longer works. Off: nothing is sent until you run a generative edit or press{" "}
          <strong>Test key</strong>.
        </p>
      </section>
    </div>
  );
}

/** Which key wins, and that .env is never changed. */
function PrecedenceNote({ overview, desktop }: { overview: KeyOverview; desktop: boolean }) {
  const { active, env } = overview;
  if (!env) return null;
  if (active && active.source !== env.source)
    return (
      <p className="df-panel-note faint">
        The key {env.hint} {keySourceLabel(env.source)} is not used while this one is set; it is used again if
        you remove this one.
      </p>
    );
  if (desktop || overview.canSave)
    return (
      <p className="df-panel-note faint">
        A key entered here takes precedence over the one {keySourceLabel(env.source)}; the planner never
        changes <code>.env</code>.
      </p>
    );
  return null;
}
