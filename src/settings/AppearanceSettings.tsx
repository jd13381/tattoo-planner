// Settings → Appearance: the colour theme (docs/adr/0018-light-theme.md).
import { ThemeControl } from "../ui/ThemeControl.tsx";

export function AppearanceSettings() {
  return (
    <div className="settings-section">
      <header className="settings-section-head">
        <h2>Appearance</h2>
      </header>
      <div className="appearance-row">
        <div>
          <p className="appearance-label">Theme</p>
          <p className="muted small">
            System follows your computer’s light or dark setting. The sleeve, the canvases and the handout
            look the same in every theme.
          </p>
        </div>
        <ThemeControl />
      </div>
    </div>
  );
}
