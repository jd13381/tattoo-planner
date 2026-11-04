// Small stroke icons (16 px, currentColor) for icon buttons. Decorative: the button carries the label.
import type { ReactNode } from "react";

function Icon({ children, size = 16 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export const UndoIcon = () => (
  <Icon>
    <path d="M5.5 3.5 2.5 6.5l3 3" />
    <path d="M2.5 6.5h7a4 4 0 0 1 0 8H7" />
  </Icon>
);

export const RedoIcon = () => (
  <Icon>
    <path d="m10.5 3.5 3 3-3 3" />
    <path d="M13.5 6.5h-7a4 4 0 0 0 0 8H9" />
  </Icon>
);

export const LockIcon = ({ open = false }: { open?: boolean }) => (
  <Icon size={14}>
    <rect x="3" y="7" width="10" height="7" rx="1.5" />
    <path d={open ? "M5.5 7V5a2.5 2.5 0 0 1 4.9-.7" : "M5.5 7V5a2.5 2.5 0 0 1 5 0v2"} />
  </Icon>
);

export const InfoIcon = () => (
  <Icon size={14}>
    <circle cx="8" cy="8" r="6.25" />
    <path d="M8 7.25v3.75" />
    <path d="M8 5h.01" strokeWidth={2} />
  </Icon>
);
