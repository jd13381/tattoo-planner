// The app-level notice after the startup check of the OpenAI key (docs/adr/0016-openai-key-check.md):
// asks the server once per page load (the server checks once per run and caches), says in plain words
// what failed and what it means, links to Settings → Image generation, and can be dismissed. A later
// check in Settings that passes (or removing the key) clears it.
import { useEffect, useState } from "react";
import { startupNotice, type KeyCheckResult } from "../edits/keyCheck.ts";
import { KEY_CHECKED_EVENT, keyApi } from "./openaiKeyClient.ts";

/** sessionStorage: the check time of the notice dismissed last, so a reload does not bring it back. */
const DISMISSED_KEY = "tattoo-planner:key-notice-dismissed";

function readDismissed(): string | null {
  try {
    return sessionStorage.getItem(DISMISSED_KEY);
  } catch {
    return null;
  }
}

export function KeyCheckNotice({ onOpenSettings }: { onOpenSettings: () => void }) {
  const [result, setResult] = useState<KeyCheckResult | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(readDismissed);

  useEffect(() => {
    let cancelled = false;
    keyApi.startup().then(
      (s) => !cancelled && setResult(s.result),
      () => undefined, // No answer from the local server: other parts of the app say so.
    );
    // A later check only clears the notice: Settings shows its own results inline.
    const onChecked = (e: Event) => {
      const detail = (e as CustomEvent<KeyCheckResult | null>).detail;
      if (!startupNotice(detail)) setResult(detail);
    };
    window.addEventListener(KEY_CHECKED_EVENT, onChecked);
    return () => {
      cancelled = true;
      window.removeEventListener(KEY_CHECKED_EVENT, onChecked);
    };
  }, []);

  const notice = startupNotice(result);
  if (!notice || !result || dismissed === result.checkedAt) return null;
  const dismiss = () => {
    setDismissed(result.checkedAt);
    try {
      sessionStorage.setItem(DISMISSED_KEY, result.checkedAt);
    } catch {
      // Private mode: dismissed for this page only.
    }
  };
  return (
    <div className={`notice key-notice ${notice.tone === "error" ? "error" : ""}`} role="alert">
      <h2>{notice.title}</h2>
      <p>{notice.body}</p>
      <div className="key-notice-actions">
        <button
          type="button"
          className="primary"
          onClick={() => {
            onOpenSettings();
            dismiss();
          }}
        >
          Open Settings → Image generation
        </button>
        <button type="button" className="ghost" onClick={dismiss}>
          Dismiss
        </button>
      </div>
    </div>
  );
}
