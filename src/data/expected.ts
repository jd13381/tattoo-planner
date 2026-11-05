// The project folder layout, shown in Settings → Project.
import type { DataFile } from "./types.ts";

export type ExpectedEntry = {
  name: string;
  kind: "file" | "folder";
  purpose: string;
  /** A location of the older data folder: still read, but new projects do not get it. */
  older?: boolean;
};

/** The project folder (docs/adr/0012-project-folder.md), then the older data-folder locations. */
export const EXPECTED_ENTRIES: ExpectedEntry[] = [
  { name: "project.yaml", kind: "file", purpose: "name, body and height of the project" },
  { name: "measurements.yaml", kind: "file", purpose: "your measurements (optional)" },
  { name: "manifest.yaml", kind: "file", purpose: "image catalogue, kept by the planner" },
  { name: "layouts", kind: "folder", purpose: "layout variants" },
  { name: "projections", kind: "folder", purpose: "how photos of existing tattoos map onto the body" },
  { name: "images", kind: "folder", purpose: "reference images" },
  { name: "photos", kind: "folder", purpose: "body photos for projections" },
  { name: "edits", kind: "folder", purpose: "edited images kept in the Image studio" },
  { name: "generated", kind: "folder", purpose: "new images created in the Image studio" },
  { name: "exports", kind: "folder", purpose: "PDF / PNG handouts" },
  { name: "ideas.pdf", kind: "file", purpose: "collected ideas", older: true },
  {
    name: "ideas",
    kind: "folder",
    purpose: "images extracted from ideas.pdf earlier",
    older: true,
  },
  { name: "refs", kind: "folder", purpose: "references", older: true },
  { name: "cards", kind: "folder", purpose: "card art", older: true },
  { name: "existing", kind: "folder", purpose: "photos of existing tattoos", older: true },
  { name: "arm-photos", kind: "folder", purpose: "arm photos", older: true },
];

/** Whether an expected entry is present. Empty folders do not show up in a file listing. */
export function isPresent(entry: ExpectedEntry, files: DataFile[]): boolean {
  return entry.kind === "file"
    ? files.some((f) => f.path === entry.name)
    : files.some((f) => f.path.startsWith(`${entry.name}/`));
}

/** Files inside an expected folder (recursively); 1 or 0 for a file entry. */
export function countFiles(entry: ExpectedEntry, files: DataFile[]): number {
  return entry.kind === "file"
    ? Number(isPresent(entry, files))
    : files.filter((f) => f.path.startsWith(`${entry.name}/`)).length;
}

/** Groups files by their top-level folder; files in the root go under "" and come first. */
export function groupByFolder(files: DataFile[]): Map<string, DataFile[]> {
  const groups = new Map<string, DataFile[]>([["", []]]);
  for (const f of files) {
    const slash = f.path.indexOf("/");
    const key = slash === -1 ? "" : f.path.slice(0, slash);
    const list = groups.get(key) ?? [];
    list.push(f);
    groups.set(key, list);
  }
  if (groups.get("")?.length === 0) groups.delete("");
  return groups;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
