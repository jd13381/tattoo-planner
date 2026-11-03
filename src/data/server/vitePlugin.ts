// Dev-server middleware that exposes the data folder listing to the UI.
// Only metadata (paths, sizes, dates) is served; file contents are not readable through it.
import type { Plugin } from "vite";
import { DATA_FILES_ENDPOINT, type DataListing } from "../types.ts";
import { listDataFiles } from "./dataDir.ts";

export function dataFolderPlugin(dataDir: string | null): Plugin {
  return {
    name: "tattoo-planner-data-folder",
    configureServer(server) {
      server.middlewares.use(DATA_FILES_ENDPOINT, (req, res) => {
        if (req.method !== "GET") {
          res.statusCode = 405;
          res.end();
          return;
        }
        const respond = (body: DataListing) => {
          res.setHeader("Content-Type", "application/json");
          res.setHeader("Cache-Control", "no-store");
          res.end(JSON.stringify(body));
        };
        if (!dataDir) return respond({ status: "unset" });
        listDataFiles(dataDir).then(respond, (e: unknown) =>
          respond({ status: "error", dir: dataDir, message: String(e) }),
        );
      });
    },
  };
}
