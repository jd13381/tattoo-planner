import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// Fonts are bundled (offline-first, no font CDN): Inter for labels, JetBrains Mono for numbers.
import "@fontsource-variable/inter/wght.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import { App } from "./App.tsx";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("missing #root element");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
