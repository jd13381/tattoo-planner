import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin } from "vite";
import { createApi, type ApiContext } from "./server/api.ts";
import { createContext } from "./server/context.ts";

/** Mounts the planner's API (server/api.ts) in the dev server and in `vite preview`. */
function apiPlugin(context: ApiContext): Plugin {
  return {
    name: "tattoo-planner-api",
    configureServer(server) {
      const api = createApi(context);
      server.httpServer?.on("close", () => void api.close());
      server.middlewares.use(api);
    },
    configurePreviewServer(server) {
      const api = createApi(context);
      server.httpServer.on("close", () => void api.close());
      server.middlewares.use(api);
    },
  };
}

export default defineConfig(({ mode }) => {
  const root = import.meta.dirname;
  // Prefix "TATTOO_" keeps the variable server-side: Vite only exposes VITE_* to the browser.
  // Variables already set in the shell win over .env.
  const env = { ...loadEnv(mode, root, "TATTOO_"), ...process.env };
  const context = createContext({ env, root });
  return {
    plugins: [react(), apiPlugin(context)],
    server: {
      // Local only (docs/history/project-brief.md §10.2): never listen on the network.
      host: "127.0.0.1",
      port: 4320,
      cors: false,
    },
    preview: { host: "127.0.0.1", port: 4321 },
  };
});
