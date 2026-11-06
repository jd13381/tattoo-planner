// A toast with an Undo button ("Moved 3 images to the Trash · Undo"). It stays `ms` long; the timer
// pauses while the pointer or the keyboard focus is on it. `onExpire` runs when it closes without
// undo (timeout or ×). Each message gets a fresh timer.
import { useEffect, useRef, useState } from "react";

export type UndoToastMessage = {
  id: number;
  text: string;
  /** Null: an information toast without Undo. */
  onUndo: (() => void) | null;
  onExpire?: () => void;
};

type Props = { message: UndoToastMessage | null; ms: number; onClose: () => void };

export function UndoToast({ message, ms, onClose }: Props) {
  return (
    <div className="toast-region" role="status" aria-live="polite">
      {message && <ToastBody key={message.id} message={message} ms={ms} onClose={onClose} />}
    </div>
  );
}

function ToastBody({ message, ms, onClose }: { message: UndoToastMessage; ms: number; onClose: () => void }) {
  const [paused, setPaused] = useState(false);
  const left = useRef(ms);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (paused) return;
    const started = Date.now();
    const t = setTimeout(() => {
      message.onExpire?.();
      onCloseRef.current();
    }, left.current);
    return () => {
      clearTimeout(t);
      left.current = Math.max(800, left.current - (Date.now() - started));
    };
  }, [message, paused]);

  return (
    <div
      className="toast undo-toast"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <span>{message.text}</span>
      {message.onUndo && (
        <button
          type="button"
          className="link undo-button"
          onClick={() => {
            const undo = message.onUndo;
            onCloseRef.current();
            undo?.();
          }}
        >
          Undo
        </button>
      )}
      <button
        type="button"
        className="ghost icon-button small-button"
        aria-label="Dismiss"
        onClick={() => {
          message.onExpire?.();
          onCloseRef.current();
        }}
      >
        ×
      </button>
    </div>
  );
}
