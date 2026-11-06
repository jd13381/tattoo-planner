// Esc leaves a full-page flow (measuring wizard, projection wizard, Advanced projection page) the same
// way as its Close / Cancel button. A popover or menu that handles Esc first (it calls preventDefault,
// src/ui/Popover.tsx) keeps the key, so Esc there only closes the popover.
import { useEffect, useEffectEvent } from "react";

export function useEscape(onEscape: () => void, enabled = true) {
  const handler = useEffectEvent(onEscape);
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || e.repeat) return;
      // A modifier makes it a different shortcut; an IME composition uses Esc to cancel itself.
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.isComposing) return;
      e.preventDefault();
      handler();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}
