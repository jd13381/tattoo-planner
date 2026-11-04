// Window-level key handling for the Layout tab. The mapping lives in shortcuts.ts; this hook only
// decides whether a key press is for the tab and hands the action to `run`.
import { useEffect, useRef, type RefObject } from "react";
import {
  detectPlatform,
  isEditableTarget,
  shortcutAction,
  type Platform,
  type ShortcutAction,
} from "./shortcuts.ts";

export function currentPlatform(): Platform {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  return detectPlatform(nav.userAgentData?.platform ?? nav.platform);
}

/**
 * Calls `run` for every Layout shortcut while `root` is visible. The Layout tab stays mounted while
 * another tab is open (inside a [hidden] panel), so a hidden root ignores all keys.
 */
export function useLayoutShortcuts(
  root: RefObject<HTMLElement | null>,
  run: (action: ShortcutAction) => void,
) {
  const runRef = useRef(run);
  useEffect(() => {
    runRef.current = run;
  });

  useEffect(() => {
    const platform = currentPlatform();
    const onKey = (e: KeyboardEvent) => {
      const el = root.current;
      if (e.defaultPrevented || e.isComposing || !el || el.closest("[hidden]")) return;
      const action = shortcutAction(
        {
          key: e.key,
          metaKey: e.metaKey,
          ctrlKey: e.ctrlKey,
          shiftKey: e.shiftKey,
          altKey: e.altKey,
          isEditableTarget: isEditableTarget(e.target),
        },
        platform,
      );
      if (!action) return;
      // Arrows keep their meaning on sliders, checkboxes and selects (pose slider, mode toggles).
      if (action.type === "nudge" && e.target instanceof HTMLInputElement) return;
      e.preventDefault();
      runRef.current(action);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [root]);
}
