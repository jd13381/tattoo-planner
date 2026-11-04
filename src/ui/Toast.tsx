// A short confirmation at the bottom of the window ("Saved v1-baseline"). One message at a time;
// a new one replaces the old. The region is a polite live region, so screen readers announce it.
//
//   const toast = useToast();
//   toast.show("Saved v1-baseline");
//   <ToastRegion toast={toast} />
import { useCallback, useEffect, useRef, useState } from "react";

export type ToastTone = "ok" | "info" | "warn" | "error";
export type ToastMessage = { id: number; text: string; tone: ToastTone };

export type ToastApi = {
  message: ToastMessage | null;
  show: (text: string, tone?: ToastTone) => void;
  dismiss: () => void;
};

export function useToast(durationMs = 2200): ToastApi {
  const [message, setMessage] = useState<ToastMessage | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);

  const dismiss = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setMessage(null);
  }, []);

  const show = useCallback(
    (text: string, tone: ToastTone = "ok") => {
      if (timer.current) clearTimeout(timer.current);
      seq.current += 1;
      setMessage({ id: seq.current, text, tone });
      // Errors stay longer: they usually need reading.
      timer.current = setTimeout(() => setMessage(null), tone === "error" ? durationMs * 2 : durationMs);
    },
    [durationMs],
  );

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  return { message, show, dismiss };
}

export function ToastRegion({ toast }: { toast: ToastApi }) {
  const m = toast.message;
  return (
    <div className="toast-region" role="status" aria-live="polite">
      {m && (
        <div key={m.id} className={`toast ${m.tone}`} onClick={toast.dismiss}>
          {m.text}
        </div>
      )}
    </div>
  );
}
