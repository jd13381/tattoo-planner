// Browser calls of the project API (server/projectApi.ts). Each throws an Error with the server's message.
import {
  PROJECT_ENDPOINT,
  type Body,
  type BrowseListing,
  type CreateResult,
  type MigrationReport,
  type ProjectPatch,
  type ProjectStatus,
} from "./schema.ts";

async function call<T>(method: string, sub: string, body?: unknown): Promise<T> {
  const r = await fetch(`${PROJECT_ENDPOINT}${sub}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json: unknown = null;
  try {
    json = await r.json();
  } catch {
    // An empty or non-JSON answer: the status says enough.
  }
  if (!r.ok) {
    const error = (json as { error?: unknown } | null)?.error;
    throw new Error(typeof error === "string" ? error : `The planner answered ${r.status}.`);
  }
  return json as T;
}

export const getProject = () => call<ProjectStatus>("GET", "");
export const openProject = (path: string) => call<ProjectStatus>("POST", "/open", { path });
export const createProject = (fields: { path: string; name: string; body: Body }) =>
  call<CreateResult>("POST", "/create", fields);
export const closeProject = () => call<ProjectStatus>("POST", "/close", {});
export const updateProject = (patch: ProjectPatch) => call<ProjectStatus>("PATCH", "", patch);
export const migrateProject = () =>
  call<{ project: ProjectStatus; migration: MigrationReport }>("POST", "/migrate", {});
export const browseFolders = (path?: string) =>
  call<BrowseListing>("GET", `/browse${path ? `?path=${encodeURIComponent(path)}` : ""}`);

/** Every part of the page depends on the project, so a switch starts the page afresh. */
export function reloadForProject(): void {
  window.location.reload();
}

/** One line per file of a migration, for the project screen. */
export function migrationLines(r: MigrationReport): string[] {
  return [
    r.projectFile === "created" ? "Created project.yaml" : "project.yaml was there already and was kept",
    ...r.copied.map((f) => `Copied ${f}`),
    ...r.skipped.map((f) => `Kept ${f} (already in the folder, not replaced)`),
  ];
}
