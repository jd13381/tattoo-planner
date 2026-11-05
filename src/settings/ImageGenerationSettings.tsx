// Settings → Image generation: whether the Image studio can call OpenAI (bring your own key), and
// how to set the key up. Reads the Image studio's status endpoint; nothing is sent to OpenAI here.
// In the desktop app the key is entered here and kept in the Keychain by the main process
// (docs/adr/0015-desktop-app.md); the page only sends it once and never reads it back.
import { useCallback, useEffect, useState } from "react";
import { desktopBridge, type KeyStatus, type TattooDesktop } from "../desktop/bridge.ts";

/** GET: the Image studio's overview; only the generative status is read here. */
const EDITS_ENDPOINT = "/api/edits";

/**
 * docs/privacy.md in the repository. It moves with the repository when the public one opens
 * (docs/product/roadmap.md, Phase D). The desktop shell opens https links in the system browser.
 */
export const PRIVACY_URL = "https://github.com/jd13381/tattoo-planner/blob/main/docs/privacy.md";

type Generative = { enabled: true; model: string } | { enabled: false; reason: string };
type State = { kind: "loading" } | { kind: "ok"; generative: Generative } | { kind: "failed" };

function useGenerativeStatus(tick: number): State {
  const [state, setState] = useState<State>({ kind: "loading" });
  useEffect(() => {
    let cancelled = false;
    fetch(EDITS_ENDPOINT)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<{ generative?: Generative }>;
      })
      .then(
        (o) =>
          !cancelled &&
          setState(o.generative ? { kind: "ok", generative: o.generative } : { kind: "failed" }),
        () => !cancelled && setState({ kind: "failed" }),
      );
    return () => {
      cancelled = true;
    };
  }, [tick]);
  return state;
}

export function ImageGenerationSettings() {
  const [tick, setTick] = useState(0);
  const state = useGenerativeStatus(tick);
  const enabled = state.kind === "ok" && state.generative.enabled;
  const desktop = desktopBridge();
  return (
    <div className="settings-section">
      <header className="settings-section-head">
        <h2>Image generation</h2>
        {state.kind === "ok" &&
          (enabled ? <span className="chip ok">Ready</span> : <span className="chip warn">Not set up</span>)}
        {state.kind === "failed" && <span className="chip error">No answer</span>}
        <span className="spacer" />
        <button type="button" onClick={() => setTick((n) => n + 1)} disabled={state.kind === "loading"}>
          Check again
        </button>
      </header>
      <p className="muted">
        The Image studio can redraw a reference image or create a new one with OpenAI’s GPT Image, using your
        own API key. It is optional: everything else works without a key. A request sends the image and your
        instruction to OpenAI and costs a few cents; nothing is sent without you starting it.
      </p>
      <p className="muted">
        Privacy: images are only sent to OpenAI when you run a generative edit. The key is only sent to
        OpenAI, with those requests.{" "}
        <a href={PRIVACY_URL} target="_blank" rel="noreferrer">
          What the planner sends, and where
        </a>
      </p>
      <section className="df-panel" aria-label="Status">
        <div className="df-panel-head">
          <h3 className="float-title">Status</h3>
        </div>
        <p className="df-panel-note">
          {state.kind === "loading"
            ? "Checking…"
            : state.kind === "failed"
              ? "The planner’s local server did not answer."
              : state.generative.enabled
                ? `A key is set. Model: ${state.generative.model}.`
                : /api key/i.test(state.generative.reason)
                  ? "No OpenAI API key is set yet."
                  : state.generative.reason}
        </p>
      </section>
      {desktop && (
        <DesktopKeyPanel desktop={desktop} envKey={enabled} onChange={() => setTick((n) => n + 1)} />
      )}
      {!desktop && !enabled && (
        <section className="df-panel" aria-label="Set up a key">
          <div className="df-panel-head">
            <h3 className="float-title">Set up a key</h3>
            <span className="faint small">Planner run from a git checkout</span>
          </div>
          <p className="df-panel-note">
            In the desktop app you enter the key right here. A planner started from the source code reads it
            from its settings file:
          </p>
          <ol className="setup-steps">
            <li>
              <span>
                Create an API key at{" "}
                <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">
                  platform.openai.com
                </a>{" "}
                and add some credit under Billing.
              </span>
            </li>
            <li>
              <span>
                Add it to the local settings file <code>.env</code> in the planner’s folder as{" "}
                <code>TATTOO_OPENAI_API_KEY=…</code> (the file is never committed).
              </span>
            </li>
            <li>
              <span>
                Restart the planner, then press <strong>Check again</strong>.
              </span>
            </li>
          </ol>
        </section>
      )}
    </div>
  );
}

/** The desktop app's key form: Save encrypts the key in the main process, Remove deletes it. */
function DesktopKeyPanel({
  desktop,
  envKey,
  onChange,
}: {
  desktop: TattooDesktop;
  /** Generative edits work without a stored key: a key from the environment (a checkout's .env). */
  envKey: boolean;
  onChange: () => void;
}) {
  const [status, setStatus] = useState<KeyStatus | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    desktop.getKeyStatus().then(
      (s) => !cancelled && setStatus(s),
      (e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      cancelled = true;
    };
  }, [desktop]);

  const run = useCallback(
    async (action: () => Promise<KeyStatus>) => {
      setBusy(true);
      setError(null);
      try {
        setStatus(await action());
        setDraft("");
        onChange();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [onChange],
  );

  const unavailable = status !== null && !status.encryptionAvailable;
  return (
    <section className="df-panel" aria-label="API key">
      <div className="df-panel-head">
        <h3 className="float-title">API key</h3>
        {status?.stored && <span className="chip ok">Stored</span>}
      </div>
      <p className="df-panel-note">
        {status === null
          ? "Checking…"
          : status.stored
            ? `Key stored in the ${status.backend}.`
            : unavailable
              ? `The ${status.backend} is not available, so a key cannot be stored safely.`
              : envKey
                ? "No key stored in the app; the key from the environment (TATTOO_OPENAI_API_KEY) is in use."
                : "No key stored yet. Create one at platform.openai.com (API keys) and add some credit under Billing."}
      </p>
      <form
        className="key-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (draft.trim()) void run(() => desktop.setOpenAIKey(draft));
        }}
      >
        <label className="pj-field">
          <span>{status?.stored ? "Replace with a new key" : "OpenAI API key"}</span>
          <input
            type="password"
            value={draft}
            placeholder="sk-…"
            autoComplete="off"
            spellCheck={false}
            disabled={busy || unavailable}
            onChange={(e) => setDraft(e.target.value)}
          />
        </label>
        <button type="submit" className="primary" disabled={busy || unavailable || !draft.trim()}>
          Save
        </button>
        {status?.stored && (
          <button
            type="button"
            className="ghost"
            disabled={busy}
            onClick={() => void run(desktop.clearOpenAIKey)}
          >
            Remove
          </button>
        )}
        <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer" className="small">
          Get a key
        </a>
      </form>
      {error && (
        <p className="field-hint error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
