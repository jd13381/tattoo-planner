// The planner's HTTP API as one Connect-style middleware (docs/adr/0012-project-folder.md).
// Vite mounts it in dev and preview (vite.config.ts); server/standalone.ts mounts it next to the built
// page, as the desktop shell does. Requests outside /api/ go to `next`.
import { assetsHandler } from "./assetsHandler.ts";
import { dataFilesHandler } from "./dataFilesApi.ts";
import { editsHandler } from "./editsApi.ts";
import { exportsHandler } from "./exportsApi.ts";
import { sendError, type Handler, type Middleware } from "./http.ts";
import { layoutsHandler } from "./layoutsApi.ts";
import { openaiKeyHandler } from "./openaiKeyApi.ts";
import { projectPersons } from "./persons.ts";
import { projectHandler } from "./projectApi.ts";
import { projectionsHandler } from "./projectionsApi.ts";
import { handleSampleRequest } from "./sampleApi.ts";
import type { ProjectStore } from "./project/store.ts";
import type { ServerSettings } from "./settings.ts";
import { defaultTrasher, PendingDeletes, type Trasher } from "./trash.ts";

export type ApiContext = {
  /** The current project; asked on every request, so a project opened meanwhile takes effect at once. */
  projects: ProjectStore;
  /** The user's home folder: the in-browser folder picker stays inside it. */
  home: string;
  settings: ServerSettings;
  /** Where deleted images go; default: macOS ~/.Trash, elsewhere the project's .trash/ (server/trash.ts). */
  trash?: Trasher;
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
  const paths = () => context.projects.paths();
  const dir = async () => (await paths()).dir;
  // The settings object itself, not a copy of its key: the desktop app can set a key at runtime.
  const edits = editsHandler(dir, context.settings);
  const trasher = context.trash ?? defaultTrasher();
  const pending = new PendingDeletes(trasher);
  const assets = assetsHandler({
    dir,
    persons: async () => projectPersons(await paths(), await context.projects.persons()),
    sessions: (folder) => edits.sessionAssets(folder),
    pending,
  });
  const routes = new Map<string, Handler>([
    ["/api/data-files", dataFilesHandler(dir)],
    ["/api/assets", assets],
    ["/api/exports", exportsHandler(dir)],
    ["/api/edits", edits.handle],
    ["/api/openai-key", openaiKeyHandler(context.settings.keys)],
    ["/api/layouts", layoutsHandler(async () => (await paths()).layoutsDir)],
    ["/api/project", projectHandler(context.projects, context.home)],
    ["/api/projections", projectionsHandler(paths, trasher)],
  ]);
  const middleware: Middleware = (req, res, next) => {
    const found = route(routes, req.url ?? "/");
    if (!found) return next();
    const run = async () => {
      // The sample project is read-only and draws its images (server/sampleApi.ts).
      const sampleDir = context.projects.readOnly ? context.projects.sampleDir : null;
      if (sampleDir && (await handleSampleRequest(req, res, sampleDir))) return;
      await found.handler(req, res, found.rest);
    };
    run().catch((e: unknown) => sendError(res, e));
  };
  // Stopping the server makes pending deletes final (their undo toast is gone with the page).
  const close = async () => {
    await pending.commitAll();
    await edits.close();
  };
  return Object.assign(middleware, { close });
}
