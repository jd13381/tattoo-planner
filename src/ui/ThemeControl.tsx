// The theme choice as a three-way segmented control (Light / System / Dark), a WAI-ARIA radio group:
// one tab stop, arrow keys move and choose.
import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { MonitorIcon, MoonIcon, SunIcon } from "./icons.tsx";
import { THEMES, type Theme } from "./theme.ts";
import { useTheme } from "./useTheme.ts";

const OPTIONS: Record<Theme, { label: string; title: string; icon: ReactNode }> = {
  light: { label: "Light", title: "Light theme", icon: <SunIcon /> },
  system: { label: "System", title: "Follow the system setting", icon: <MonitorIcon /> },
  dark: { label: "Dark", title: "Dark theme", icon: <MoonIcon /> },
};

export function ThemeControl() {
  const [theme, setTheme] = useTheme();
  const group = useRef<HTMLSpanElement>(null);
  const onKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const i = THEMES.indexOf(theme);
    const step =
      e.key === "ArrowRight" || e.key === "ArrowDown"
        ? 1
        : e.key === "ArrowLeft" || e.key === "ArrowUp"
          ? -1
          : 0;
    if (!step) return;
    e.preventDefault();
    const next = THEMES[(i + step + THEMES.length) % THEMES.length]!;
    setTheme(next);
    group.current?.querySelector<HTMLButtonElement>(`[data-theme="${next}"]`)?.focus();
  };
  return (
    <span ref={group} className="segmented theme-control" role="radiogroup" aria-label="Theme">
      {THEMES.map((t) => {
        const o = OPTIONS[t];
        const checked = t === theme;
        return (
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            data-theme={t}
            title={o.title}
            onClick={() => setTheme(t)}
            onKeyDown={onKey}
          >
            {o.icon}
            <span>{o.label}</span>
          </button>
        );
      })}
    </span>
  );
}
