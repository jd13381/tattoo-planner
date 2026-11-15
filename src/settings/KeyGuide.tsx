// "How do I get a key?" in Settings → Image generation: the steps and a prompt for any AI assistant
// (src/settings/keyGuide.ts). Collapsed by default once a key is set.
import { useState } from "react";
import { KEY_GUIDE_CHECKED, KEY_GUIDE_PROMPT, KEY_GUIDE_STEPS, KEY_GUIDE_URL } from "./keyGuide.ts";

export function KeyGuide({ open }: { open: boolean }) {
  const [copied, setCopied] = useState<"ok" | "failed" | null>(null);
  const copy = () =>
    navigator.clipboard.writeText(KEY_GUIDE_PROMPT).then(
      () => setCopied("ok"),
      () => setCopied("failed"),
    );
  return (
    <details className="df-panel key-guide" id="key-guide" open={open}>
      <summary className="df-panel-head">
        <h3 className="float-title">How do I get a key?</h3>
      </summary>
      <ol className="key-guide-steps">
        {KEY_GUIDE_STEPS.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      <p className="df-panel-note">
        <a href={KEY_GUIDE_URL} target="_blank" rel="noreferrer">
          Open platform.openai.com
        </a>{" "}
        · Steps checked in {KEY_GUIDE_CHECKED}. OpenAI changes its site now and then; if a menu has moved, ask
        an AI assistant for the current steps with this prompt:
      </p>
      <pre className="key-guide-prompt">{KEY_GUIDE_PROMPT}</pre>
      <div className="key-check-row">
        <button type="button" onClick={() => void copy()}>
          Copy prompt
        </button>
        <p className={`field-hint ${copied === "failed" ? "error" : copied ? "ok" : ""}`} role="status">
          {copied === "ok"
            ? "Copied. Paste it into ChatGPT, Claude, Gemini or any other assistant."
            : copied === "failed"
              ? "Could not copy; select the text above instead."
              : ""}
        </p>
      </div>
    </details>
  );
}
