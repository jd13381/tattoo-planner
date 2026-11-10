// Settings → Appearance: the colour theme (docs/adr/0021-light-theme.md), as three preview cards.
// Same behaviour as ThemeControl (a radio group, arrow keys move and choose) on the same store.
import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { THEMES, type Theme } from "../ui/theme.ts";
import { useTheme } from "../ui/useTheme.ts";
import { PageFrame } from "./PageFrame.tsx";

const OPTIONS: Record<Theme, { label: string; hint: string }> = {
  light: { label: "Light", hint: "Always light" },
  system: { label: "System", hint: "Follows your computer" },
  dark: { label: "Dark", hint: "Always dark" },
};

/** A miniature of the app: top bar, side panel and a canvas with the body. */
function Mini({ tone }: { tone: "light" | "dark" }): ReactNode {
  return (
    <span className="pg-mini" data-tone={tone} aria-hidden="true">
      <span className="pg-mini-bar">
        <i />
        <i />
        <i />
      </span>
      <span className="pg-mini-body">
        <span className="pg-mini-canvas">
          <span className="pg-mini-figure" />
        </span>
        <span className="pg-mini-side">
          <i />
          <i />
          <i />
        </span>
      </span>
    </span>
  );
}

export function AppearanceSettings() {
  const [theme, setTheme] = useTheme();
  const group = useRef<HTMLDivElement>(null);
  const onKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const step =
      e.key === "ArrowRight" || e.key === "ArrowDown"
        ? 1
        : e.key === "ArrowLeft" || e.key === "ArrowUp"
          ? -1
          : 0;
    if (!step) return;
    e.preventDefault();
    const next = THEMES[(THEMES.indexOf(theme) + step + THEMES.length) % THEMES.length]!;
    setTheme(next);
    group.current?.querySelector<HTMLButtonElement>(`[data-theme="${next}"]`)?.focus();
  };
  return (
    <PageFrame
      title="Appearance"
      description="Pick a theme for the planner. The sleeve, the canvases and the handout look the same in every theme."
    >
      <div ref={group} className="pg-theme-grid" role="radiogroup" aria-label="Theme">
        {THEMES.map((t) => {
          const checked = t === theme;
          return (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={checked}
              tabIndex={checked ? 0 : -1}
              data-theme={t}
              className="pg-theme-card"
              onClick={() => setTheme(t)}
              onKeyDown={onKey}
            >
              <span className="pg-theme-preview" data-preview={t}>
                {t === "system" ? (
                  <>
                    <Mini tone="light" />
                    <Mini tone="dark" />
                  </>
                ) : (
                  <Mini tone={t} />
                )}
              </span>
              <span className="pg-theme-label">
                <span className="pg-theme-name">{OPTIONS[t].label}</span>
                <span className="faint small">{OPTIONS[t].hint}</span>
              </span>
            </button>
          );
        })}
      </div>
    </PageFrame>
  );
}
