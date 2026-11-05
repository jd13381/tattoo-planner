// API of the project folder (docs/adr/0012-project-folder.md):
//   GET   /api/project                 → ProjectStatus (none | legacy | project, path, name, body, recent …)
//   PATCH /api/project                 body { name?, body?, height_cm? } → ProjectStatus (comments kept)
//   POST  /api/project/open            body { path } → ProjectStatus
//   POST  /api/project/create          body { path, name, body } → CreateResult
//   POST  /api/project/close           → ProjectStatus (start screen)
//   POST  /api/project/migrate         → { project, migration }: "Move into project" for a legacy folder
//   POST  /api/project/open-sample     → ProjectStatus: the sample shipped with the app, read-only
//   POST  /api/project/save-sample     body { path, name, body } → SaveSampleResult: "Save as new project"
//   GET   /api/project/browse?path=    → BrowseListing: sub-folders, inside the home folder only
//   GET   /api/project/measurements    → MeasurementsFile: the raw text of measurements.yaml or null
//   PUT   /api/project/measurements    body { text } → MeasurementsFile (validated, written as given)
import { parseMeasurements } from "../src/config/loadMeasurements.ts";
import type { MeasurementsFile } from "../src/project/schema.ts";
import { HttpError, isCrossSite, readJson, send, sendError, subPath, type Handler } from "./http.ts";
import { browseFolder } from "./project/browse.ts";
import type { ProjectStore } from "./project/store.ts";

export function projectHandler(store: ProjectStore, home: string): Handler {
  return async (req, res, url) => {
    try {
      const sub = subPath(url).replace(/\/+$/, "") || "/";
      const method = req.method ?? "GET";
      if (method === "GET") {
        if (sub === "/") return send(res, 200, await store.status());
        if (sub === "/browse") {
          const query = new URLSearchParams(url.split("?")[1] ?? "");
          return send(res, 200, await browseFolder(query.get("path") ?? undefined, home));
        }
        if (sub === "/measurements")
          return send(res, 200, { text: await store.readMeasurements() } satisfies MeasurementsFile);
        throw new HttpError(404, "not found");
      }
      // Only the planner page itself may change the project.
      if (isCrossSite(req.headers)) throw new HttpError(403, "cross-site request refused");
      if (method === "PATCH" && sub === "/")
        return send(res, 200, await store.update(await readJson(req, 10_000)));
      if (method === "PUT" && sub === "/measurements") {
        const body = (await readJson(req, 200_000)) as { text?: unknown } | null;
        if (typeof body?.text !== "string") throw new HttpError(400, "expected { text }");
        const parsed = parseMeasurements(body.text);
        if (!parsed.ok) throw new HttpError(400, `measurements.yaml: ${parsed.error}`);
        await store.writeMeasurements(body.text);
        return send(res, 200, { text: body.text } satisfies MeasurementsFile);
      }
      if (method !== "POST") throw new HttpError(405, "method not allowed");
      const json = async () => (await readJson(req, 10_000)) as Record<string, unknown> | null;
      if (sub === "/open") return send(res, 200, await store.open((await json())?.path));
      if (sub === "/create") return send(res, 200, await store.create(await json()));
      if (sub === "/close") return send(res, 200, await store.close());
      if (sub === "/migrate") return send(res, 200, await store.migrate());
      if (sub === "/open-sample") return send(res, 200, await store.openSample());
      if (sub === "/save-sample") return send(res, 200, await store.saveSampleAs(await json()));
      throw new HttpError(404, "not found");
    } catch (e) {
      sendError(res, e, 500);
    }
  };
}
