// Small stroke icons (16 px, currentColor) for icon buttons. Decorative: the button carries the label.
import type { ReactNode } from "react";

/** `box` is the drawing grid: the original icons use 16, the Pro tool icons 24 (stroke 1.6). */
function Icon({ children, size = 16, box = 16 }: { children: ReactNode; size?: number; box?: number }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox={`0 0 ${box} ${box}`}
      fill="none"
      stroke="currentColor"
      strokeWidth={box === 16 ? 1.5 : 1.6}
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

// Pro tool icons (24 grid). The rail and the floating bars use these.
const Pro = ({ children, size = 16 }: { children: ReactNode; size?: number }) => (
  <Icon size={size} box={24}>
    {children}
  </Icon>
);

export const SelectIcon = () => (
  <Pro>
    <path d="M5 3l14 8-6.2 1.6L10 19z" />
  </Pro>
);

export const FigureIcon = () => (
  <Pro>
    <rect x="5" y="4" width="14" height="16" rx="3" fill="currentColor" fillOpacity=".35" />
  </Pro>
);

export const ExistingIcon = () => (
  <Pro>
    <rect x="5" y="4" width="14" height="16" rx="3" strokeDasharray="3 2.4" />
  </Pro>
);

export const FillerIcon = () => (
  <Pro>
    <rect x="5" y="4" width="14" height="16" rx="3" />
    <path d="M9 9h.01M15 9h.01M12 12h.01M9 15h.01M15 15h.01" strokeWidth={2.2} />
  </Pro>
);

export const BandIcon = () => (
  <Pro>
    <rect x="3" y="8" width="18" height="8" rx="1.5" />
    <path d="M7 8l-3 6M11 8l-4 8M15 8l-4 8M19 8l-4 8M21 12l-2 4" />
  </Pro>
);

export const LineIcon = () => (
  <Pro>
    <path d="M5 19c3-1 3-6 6-8s6-1 8-6" />
  </Pro>
);

/** The red line brush: the one icon drawn in the sleeve red. */
export const RedLineIcon = () => (
  <Pro>
    <path d="M4 20c3-1 4-7 7-9s6-1 9-7" stroke="var(--red)" strokeWidth={2.6} />
    <circle cx="20" cy="4" r="1.6" fill="var(--red)" stroke="none" />
  </Pro>
);

export const HelpIcon = () => (
  <Pro>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M9.6 9.5a2.5 2.5 0 014.8.9c0 1.7-2.4 2-2.4 3.6M12 17h.01" />
  </Pro>
);

export const LayersIcon = () => (
  <Pro size={14}>
    <path d="M12 4l8.5 4.5L12 13 3.5 8.5z" />
    <path d="M3.5 12.5L12 17l8.5-4.5M3.5 16.5L12 21l8.5-4.5" />
  </Pro>
);

export const ImageIcon = () => (
  <Pro size={14}>
    <rect x="4" y="5" width="16" height="14" rx="2" />
    <circle cx="9" cy="10" r="1.6" />
    <path d="M20 16l-5-5-9 8" />
  </Pro>
);

export const CameraIcon = () => (
  <Pro>
    <path d="M4 8.5A1.5 1.5 0 015.5 7h2l1.5-2h6l1.5 2h2A1.5 1.5 0 0120 8.5v9a1.5 1.5 0 01-1.5 1.5h-13A1.5 1.5 0 014 17.5z" />
    <circle cx="12" cy="12.5" r="3.2" />
  </Pro>
);

export const ExportIcon = () => (
  <Pro>
    <path d="M12 4v11M7.5 8.5L12 4l4.5 4.5M5 14v4.5A1.5 1.5 0 006.5 20h11a1.5 1.5 0 001.5-1.5V14" />
  </Pro>
);

export const FitIcon = () => (
  <Pro size={14}>
    <path d="M4 9V5.5A1.5 1.5 0 015.5 4H9M15 4h3.5A1.5 1.5 0 0120 5.5V9M20 15v3.5a1.5 1.5 0 01-1.5 1.5H15M9 20H5.5A1.5 1.5 0 014 18.5V15" />
  </Pro>
);

export const ArrowUpIcon = () => (
  <Pro size={14}>
    <path d="M12 19V6M6.5 11.5L12 6l5.5 5.5" />
  </Pro>
);

export const ArrowDownIcon = () => (
  <Pro size={14}>
    <path d="M12 5v13M6.5 12.5L12 18l5.5-5.5" />
  </Pro>
);

export const DuplicateIcon = () => (
  <Pro size={14}>
    <rect x="8.5" y="8.5" width="11" height="11" rx="2" />
    <path d="M15.5 8.5V6a1.5 1.5 0 00-1.5-1.5H6A1.5 1.5 0 004.5 6v8A1.5 1.5 0 006 15.5h2.5" />
  </Pro>
);

export const TrashIcon = () => (
  <Pro size={14}>
    <path d="M4.5 7h15M10 11v6M14 11v6M6.5 7l1 12a1.5 1.5 0 001.5 1.4h6a1.5 1.5 0 001.5-1.4l1-12M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2" />
  </Pro>
);

export const WarnIcon = () => (
  <Pro size={13}>
    <path d="M12 4l9 16H3z" />
    <path d="M12 10v4M12 17h.01" />
  </Pro>
);

/** Swap two things (Compare: A ⇄ B). */
export const SwapIcon = () => (
  <Pro>
    <path d="M7 4L3.5 7.5 7 11M3.5 7.5h14M17 13l3.5 3.5L17 20M20.5 16.5h-14" />
  </Pro>
);

// Theme choice (Settings → Appearance).
export const SunIcon = () => (
  <Pro size={14}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
  </Pro>
);

export const MonitorIcon = () => (
  <Pro size={14}>
    <rect x="3" y="4.5" width="18" height="12" rx="2" />
    <path d="M8.5 20.5h7M12 16.5v4" />
  </Pro>
);

export const MoonIcon = () => (
  <Pro size={14}>
    <path d="M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z" />
  </Pro>
);

/** Active layout variant (Layout tab, Home); `filled` when it is the active one. */
export const StarIcon = ({ filled = false }: { filled?: boolean }) => (
  <Pro size={14}>
    <path
      d="M12 3.8l2.5 5.1 5.6.8-4 4 1 5.6-5.1-2.7-5.1 2.7 1-5.6-4-4 5.6-.8z"
      fill={filled ? "currentColor" : "none"}
    />
  </Pro>
);

export const PlusIcon = () => (
  <Pro size={14}>
    <path d="M12 5v14M5 12h14" />
  </Pro>
);

/** Turntable on Home: play / pause the slow rotation. */
export const PlayIcon = () => (
  <Pro size={13}>
    <path d="M8 5.5v13l10.5-6.5z" />
  </Pro>
);

export const PauseIcon = () => (
  <Pro size={13}>
    <path d="M9 5.5v13M15 5.5v13" />
  </Pro>
);

export const ArrowRightIcon = () => (
  <Pro size={13}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Pro>
);
