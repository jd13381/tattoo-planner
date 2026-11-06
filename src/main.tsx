import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// Fonts are bundled (offline-first, no font CDN): Inter for labels, JetBrains Mono for numbers.
import "@fontsource-variable/inter/wght.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import { loadProjectData } from "./project/projectData.ts";
import "./styles.css";
import { themeStore } from "./ui/useTheme.ts";

const root = document.getElementById("root");
if (!root) throw new Error("missing #root element");
// public/theme-init.js set the theme before the first paint; the store now follows OS changes.
themeStore();

// The project and its measurements load before the app's modules: the body is built from them when
// those modules are first evaluated (src/viewer/useArm.ts), so the app is imported only afterwards.
void loadProjectData().then(async () => {
  const { ProjectGate } = await import("./project/ProjectGate.tsx");
  createRoot(root).render(
    <StrictMode>
      <ProjectGate />
    </StrictMode>,
  );
});
