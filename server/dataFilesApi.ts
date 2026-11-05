// The project folder listing for Settings → Project.
// Only metadata (paths, sizes, dates) is served; file contents are not readable through it.
//   GET /api/data-files → DataListing (src/data/types.ts)
import type { DataListing } from "../src/data/types.ts";
import { listDataFiles } from "./dataDir.ts";
import { send, type Handler } from "./http.ts";

export function dataFilesHandler(dir: () => Promise<string | null>): Handler {
  return async (req, res) => {
    if (req.method !== "GET") {
      res.statusCode = 405;
      res.end();
      return;
    }
    const folder = await dir();
    if (!folder) return send(res, 200, { status: "unset" } satisfies DataListing);
    const listing = await listDataFiles(folder).catch((e: unknown): DataListing => ({
      status: "error",
      dir: folder,
      message: String(e),
    }));
    send(res, 200, listing);
  };
}
