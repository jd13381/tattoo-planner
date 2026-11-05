// The planner's HTTP API as one Connect-style middleware (docs/adr/0012-project-folder.md).
// Vite mounts it in dev and preview (vite.config.ts); server/standalone.ts mounts it next to the built
// page, as the desktop shell will. Requests outside /api/ go to `next`.
import { assetsHandler } from "./assetsApi.ts";
import { dataFilesHandler } from "./dataFilesApi.ts";
import { editsHandler } from "./editsApi.ts";
import { exportsHandler } from "./exportsApi.ts";
import { sendError, type Handler, type Middleware } from "./http.ts";
import { layoutsHandler } from "./layoutsApi.ts";
import { projectionsHandler } from "./projectionsApi.ts";
import type { ServerSettings } from "./settings.ts";

/** Where the open project keeps its data; null where there is none. */
export type ProjectFolders = {
  /** The folder with manifest.yaml, images and exports. */
  dir: string | null;
  layoutsDir: string | null;
  projectionsDir: string | null;
};

export type ApiContext = {
  /** Asked on every request, so a project opened meanwhile takes effect at once. */
  folders: () => Promise<ProjectFolders>;
  settings: ServerSettings;
};

export type Api = Middleware & { close: () => Promise<void> };

/** Splits `/api/x/y?z` into the handler for `/api/x` and the rest (`/y?z`), as Connect's use(prefix) does. */
export function route(
  routes: ReadonlyMap<string, Handler>,
  url: string,
): { handler: Handler; rest: string } | null {
  for (const [prefix, handler] of routes) {
    if (url !== prefix && !url.startsWith(`${prefix}/`) && !url.startsWith(`${prefix}?`)) continue;
    const rest = url.slice(prefix.length);
    return { handler, rest: rest === "" ? "/" : rest.startsWith("?") ? `/${rest}` : rest };
  }
  return null;
}

export function createApi(context: ApiContext): Api {
  const dir = async () => (await context.folders()).dir;
  const edits = editsHandler(dir, { openai: context.settings.openai });
  const routes = new Map<string, Handler>([
    ["/api/data-files", dataFilesHandler(dir)],
    ["/api/assets", assetsHandler(dir)],
    ["/api/exports", exportsHandler(dir)],
    ["/api/edits", edits.handle],
    ["/api/layouts", layoutsHandler(async () => (await context.folders()).layoutsDir)],
    ["/api/projections", projectionsHandler(async () => (await context.folders()).projectionsDir)],
  ]);
  const middleware: Middleware = (req, res, next) => {
    const found = route(routes, req.url ?? "/");
    if (!found) return next();
    found.handler(req, res, found.rest).catch((e: unknown) => sendError(res, e));
  };
  return Object.assign(middleware, { close: edits.close });
}
