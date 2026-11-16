// Names and limits of export files, shared by the dev-server endpoint (Node) and the browser.
// Exports live only in <TATTOO_DATA_DIR>/exports/ (docs/history/project-brief.md §10.1 F10, §12.3), never in the repo:
//   exports/<layout>-<YYYY-MM-DD>[-N].pdf        the handout
//   exports/<layout>-<YYYY-MM-DD>[-N]/<name>.png the views and the unwrap as PNG
// Plain TypeScript without Node or DOM imports.

/** GET: whether exports can be written; POST: reserve a name; PUT /<path>: write one file;
 * GET /<path>: read one written file back (to open the PDF). */
export const EXPORTS_ENDPOINT = "/api/exports";
/** Folder inside the data folder. */
export const EXPORTS_FOLDER = "exports";

export const MAX_PDF_BYTES = 100 * 1024 * 1024;
export const MAX_PNG_BYTES = 50 * 1024 * 1024;
/** Highest `-N` suffix tried before giving up (one export per day and layout is the normal case). */
export const MAX_SUFFIX = 99;

const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const BASE = /^([a-z0-9][a-z0-9-]{0,63})-(\d{4}-\d{2}-\d{2})(?:-([2-9]|[1-9]\d))?$/;
const FILE = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function isSlug(s: string): boolean {
  return SLUG.test(s);
}

/** A real calendar date in YYYY-MM-DD form. */
export function isIsoDate(s: string): boolean {
  const m = DATE.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

/** The local calendar date (Jan's day, not UTC) as YYYY-MM-DD. */
export function localIsoDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** `<layout>-<date>`, then `-2`, `-3`, … for the n-th export of the same layout on the same day. */
export function exportBase(layout: string, date: string, n = 1): string {
  return n <= 1 ? `${layout}-${date}` : `${layout}-${date}-${n}`;
}

export function isExportBase(s: string): boolean {
  const m = BASE.exec(s);
  return !!m && isIsoDate(m[2]!);
}

export type ExportTarget =
  { kind: "pdf"; base: string; rel: string } | { kind: "png"; base: string; file: string; rel: string };

/**
 * Parses a path inside exports/: `<base>.pdf` or `<base>/<name>.png`. Anything else (other
 * folders, extensions, upper case, dots, `..`, deeper paths) is null.
 */
export function parseExportPath(rel: string): ExportTarget | null {
  if (rel.length > 160) return null;
  const parts = rel.split("/");
  if (parts.length === 1) {
    const m = /^(.+)\.pdf$/.exec(parts[0]!);
    if (!m || !isExportBase(m[1]!)) return null;
    return { kind: "pdf", base: m[1]!, rel };
  }
  if (parts.length === 2) {
    const m = /^(.+)\.png$/.exec(parts[1]!);
    if (!m || !isExportBase(parts[0]!) || !FILE.test(m[1]!)) return null;
    return { kind: "png", base: parts[0]!, file: m[1]!, rel };
  }
  return null;
}

export const CONTENT_TYPES = { pdf: "application/pdf", png: "image/png" } as const;

export type ExportStatus = { enabled: true } | { enabled: false; reason: string };

/** Answer to a reservation: the files of this export, relative to the data folder. */
export type ExportReservation = { base: string; pdf: string; folder: string };

/** Answer to a written file. */
export type WrittenFile = { path: string; absolute: string; bytes: number };

/** File names of the PNGs inside the export folder. */
export function pngName(subject: string, mode: "blockout" | "reference"): string {
  return `${subject}-${mode}`;
}

/** URL to open a written export file, e.g. `exportFileUrl("v1-2026-11-05.pdf")`. */
export function exportFileUrl(rel: string): string {
  return `${EXPORTS_ENDPOINT}/${rel.split("/").map(encodeURIComponent).join("/")}`;
}
