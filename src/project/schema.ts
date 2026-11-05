// The project folder (docs/adr/0012-project-folder.md): project.yaml schema and the API types shared
// by the server (server/projectApi.ts) and the browser. Framework-free.
import { z } from "zod";
import { BODY_IDS, type BodyId } from "../body/samples.ts";

export const PROJECT_FILE = "project.yaml";
export const PROJECT_VERSION = 1;
export const PROJECT_ENDPOINT = "/api/project";

/** Sample bodies a project starts from. */
export const BODIES = BODY_IDS;
export type Body = BodyId;
export const BODY_LABELS: Record<Body, string> = { female: "Female", male: "Male" };

/** Folders a new project gets (others, such as edits/ and exports/, appear when first written). */
export const PROJECT_FOLDERS = ["layouts", "projections", "images", "photos"] as const;

export const MAX_NAME_LENGTH = 80;

export const projectNameSchema = z
  .string()
  .trim()
  .min(1, "name is empty")
  .max(MAX_NAME_LENGTH, `name is longer than ${MAX_NAME_LENGTH} characters`)
  // eslint-disable-next-line no-control-regex
  .regex(/^[^\u0000-\u001f\u007f]*$/, "name contains control characters");

export const heightSchema = z.number().min(50).max(260);

/** project.yaml. Unknown keys are kept (a newer app may add some), so the schema is loose. */
export const projectSchema = z.looseObject({
  version: z.literal(PROJECT_VERSION),
  name: projectNameSchema,
  body: z.enum(BODIES),
  height_cm: heightSchema.nullable().optional(),
});

export type ProjectMeta = z.infer<typeof projectSchema>;

/** PATCH /api/project: the fields the project screen edits; height_cm null removes it. */
export const projectPatchSchema = z.strictObject({
  name: projectNameSchema.optional(),
  body: z.enum(BODIES).optional(),
  height_cm: heightSchema.nullable().optional(),
});

export type ProjectPatch = z.infer<typeof projectPatchSchema>;

/** POST /api/project/create (besides the path). */
export const newProjectSchema = z.object({ name: projectNameSchema, body: z.enum(BODIES) });

/**
 * - none: no project is open (start screen).
 * - legacy: an old data folder (manifest.yaml, no project.yaml); layouts, projections and
 *   measurements still come from the app's own config folder until it is moved into the project.
 * - project: a folder with project.yaml.
 */
export type ProjectState = "none" | "legacy" | "project";

export type RecentProject = { path: string; name: string | null; available: boolean };

export type ProjectStatus = {
  status: ProjectState;
  path: string | null;
  name: string | null;
  body: Body | null;
  height_cm: number | null;
  recent: RecentProject[];
  /** The folder is fixed by the planner's start-up settings: it cannot be switched or closed here. */
  locked: boolean;
  /** Legacy folder with old app data that "Move into project" would copy. */
  canMigrate: boolean;
  /** Why the remembered project could not be opened, or what is wrong with project.yaml. */
  problem: string | null;
};

export type MigrationReport = {
  /** project.yaml: written now, or there already. */
  projectFile: "created" | "kept";
  /** Files copied into the project, relative to it (layouts/v1.yaml, measurements.yaml). */
  copied: string[];
  /** Files that exist in the project already and were left as they are. */
  skipped: string[];
};

export type CreateResult = { project: ProjectStatus; migration: MigrationReport | null };

export type FolderKind = "project" | "legacy" | "folder";

export type BrowseListing = {
  /** The listed folder (real path). */
  path: string;
  home: string;
  /** Null at the home folder: the picker does not go above it. */
  parent: string | null;
  kind: FolderKind;
  /** Whether the folder holds anything besides hidden files (a new project needs an empty one). */
  empty: boolean;
  folders: { name: string; path: string; kind: FolderKind }[];
  truncated: boolean;
};

/** GET /api/project/measurements: the raw text of measurements.yaml, null when there is none. */
export type MeasurementsFile = { text: string | null };
