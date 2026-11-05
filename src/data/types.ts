// Shared between the dev-server middleware (Node) and the browser UI.

/** Name of the environment variable that points at the Seafile data folder. */
export const DATA_DIR_VAR = "TATTOO_DATA_DIR";

/** Endpoint served by the dev server; see server/dataFilesApi.ts. */
export const DATA_FILES_ENDPOINT = "/api/data-files";

export type DataFile = {
  /** Path relative to the data folder, always with forward slashes. */
  path: string;
  size: number;
  /** Last modification, ISO 8601. */
  modified: string;
};

export type DataListing =
  | { status: "ok"; dir: string; files: DataFile[]; truncated: boolean }
  | { status: "unset" }
  | { status: "error"; dir: string; message: string };
