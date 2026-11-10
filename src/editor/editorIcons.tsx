// Icons used only by the Layout tab (same drawing rules as src/ui/icons.tsx: 16 px grid, stroke 1.5,
// currentColor, decorative: the control carries the label).
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

/** The cm grid over the skin. */
export const GridIcon = () => (
  <Icon>
    <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" />
    <path d="M6.2 2.5v11M9.8 2.5v11M2.5 6.2h11M2.5 9.8h11" />
  </Icon>
);

export const MinusIcon = () => (
  <Icon size={14}>
    <path d="M3.5 8h9" />
  </Icon>
);

export const PlusSmallIcon = () => (
  <Icon size={14}>
    <path d="M8 3.5v9M3.5 8h9" />
  </Icon>
);

/** The side panel (elements and properties), shown or hidden. */
export const SidePanelIcon = () => (
  <Icon>
    <rect x="2" y="3" width="12" height="10" rx="2" />
    <path d="M10 3v10" />
  </Icon>
);

export const ChevronIcon = ({ dir = "down" }: { dir?: "down" | "up" | "right" }) => (
  <Icon size={12}>
    <path d={dir === "down" ? "M4 6.5 8 10.5l4-4" : dir === "up" ? "M4 9.5 8 5.5l4 4" : "M6.5 4l4 4-4 4"} />
  </Icon>
);

/** Drag affordance of a list row. */
export const GripIcon = () => (
  <svg className="icon" width={8} height={14} viewBox="0 0 8 14" fill="currentColor" aria-hidden="true">
    <circle cx="2" cy="3" r="1" />
    <circle cx="6" cy="3" r="1" />
    <circle cx="2" cy="7" r="1" />
    <circle cx="6" cy="7" r="1" />
    <circle cx="2" cy="11" r="1" />
    <circle cx="6" cy="11" r="1" />
  </svg>
);

/** A position on the skin (status bar). */
export const TargetIcon = () => (
  <Icon size={14}>
    <circle cx="8" cy="8" r="4" />
    <path d="M8 1.5v3M8 11.5v3M1.5 8h3M11.5 8h3" />
  </Icon>
);

/** Coverage: a share of the whole. */
export const CoverageIcon = () => (
  <Icon size={14}>
    <circle cx="8" cy="8" r="5.5" />
    <path d="M8 2.5V8l4 3.7" />
  </Icon>
);
