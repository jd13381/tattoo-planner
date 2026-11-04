// A small panel that opens under its trigger. Put the trigger and the Popover in one
// `.popover-anchor` element: a click outside that element or Esc closes it, and Esc does not reach
// other key handlers (so it does not also deselect in the Layout editor).
import { useEffect, useRef, type ReactNode } from "react";

type Props = {
  open: boolean;
  onClose: () => void;
  /** Accessible name of the dialog. */
  label: string;
  /** Which edge of the anchor the panel lines up with. */
  align?: "start" | "end";
  className?: string;
  children: ReactNode;
};

export function Popover({ open, onClose, label, align = "start", className, children }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const panel = ref.current;
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // Focus the field marked data-autofocus, else the panel itself.
    const first = panel?.querySelector<HTMLElement>("[data-autofocus]");
    (first ?? panel)?.focus();
    if (first instanceof HTMLInputElement) first.select();

    const onDown = (e: PointerEvent) => {
      const anchor = ref.current?.parentElement;
      if (anchor && !anchor.contains(e.target as Node)) onCloseRef.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      onCloseRef.current();
    };
    document.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
      // Give focus back to the trigger unless the user has moved it elsewhere.
      const now = document.activeElement;
      if (before?.isConnected && (now === null || now === document.body || panel?.contains(now)))
        before.focus();
    };
  }, [open]);

  if (!open) return null;
  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={label}
      tabIndex={-1}
      className={`popover ${align}${className ? ` ${className}` : ""}`}
    >
      {children}
    </div>
  );
}
