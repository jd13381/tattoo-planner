// Settings → Image generation: whether the Image studio can call OpenAI (bring your own key), and
// how to set the key up. Reads the Image studio's status endpoint; nothing is sent to OpenAI here.
import { useEffect, useState } from "react";

/** GET: the Image studio's overview; only the generative status is read here. */
const EDITS_ENDPOINT = "/api/edits";

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
      {!enabled && (
        <section className="df-panel" aria-label="Set up a key">
          <div className="df-panel-head">
            <h3 className="float-title">Set up a key</h3>
          </div>
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
