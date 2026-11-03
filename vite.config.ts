import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import { assetsPlugin } from "./src/data/server/assetsApi.ts";
import { resolveDataDir } from "./src/data/server/dataDir.ts";
import { layoutsPlugin } from "./src/data/server/layoutsApi.ts";
import { dataFolderPlugin } from "./src/data/server/vitePlugin.ts";
import { exportsPlugin } from "./src/export/server/exportsApi.ts";

export default defineConfig(({ mode }) => {
  const root = import.meta.dirname;
  // Prefix "TATTOO_" keeps the variable server-side: Vite only exposes VITE_* to the browser.
  // Variables already set in the shell win over .env.
  const env = { ...loadEnv(mode, root, "TATTOO_"), ...process.env };
  const dataDir = resolveDataDir(env, root);
  return {
    plugins: [
      react(),
      dataFolderPlugin(dataDir),
      assetsPlugin(dataDir),
      exportsPlugin(dataDir),
      layoutsPlugin(path.join(root, "config", "layouts")),
    ],
    server: {
      // Local only (PROJECT_BRIEF.md §10.2): never listen on the network.
      host: "127.0.0.1",
      port: 4320,
      cors: false,
    },
    preview: { host: "127.0.0.1", port: 4321 },
  };
});
