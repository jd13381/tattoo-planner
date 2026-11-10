// A compact, dismissible hint floating on a 3D stage (legend keys, how to move the camera). Once
// closed it stays closed in this browser; the same text stays available as the stage's tooltip.
import { useState, type ReactNode } from "react";
import { CloseIcon } from "../ui/icons.tsx";

function readDismissed(key: string): boolean {
  try {
    return localStorage.getItem(`hint:${key}`) === "closed";
  } catch {
    return false;
  }
}

export function StageHint({
  id,
  className,
  title,
  children,
}: {
  /** Remembers the dismissal under this name. */
  id: string;
  /** Positions the hint (a page class such as arm-legend); the hint itself is a .float. */
  className?: string;
  title?: string;
  children: ReactNode;
}) {
  const [closed, setClosed] = useState(() => readDismissed(id));
  if (closed) return null;
  return (
    <div className={`float vw-hint${className ? ` ${className}` : ""}`} title={title} role="note">
      <div className="vw-hint-body">{children}</div>
      <button
        type="button"
        className="ghost icon-button vw-hint-close"
        aria-label="Hide this hint"
        title="Hide this hint"
        onClick={() => {
          setClosed(true);
          try {
            localStorage.setItem(`hint:${id}`, "closed");
          } catch {
            // Private mode or blocked storage: hidden until the page reloads.
          }
        }}
      >
        <CloseIcon />
      </button>
    </div>
  );
}
