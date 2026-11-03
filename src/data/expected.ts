// The data folder layout suggested in PROJECT_BRIEF.md §12.3, used by the sanity page.
import type { DataFile } from "./types.ts";

export type ExpectedEntry = { name: string; kind: "file" | "folder"; purpose: string };

export const EXPECTED_ENTRIES: ExpectedEntry[] = [
  { name: "ideas.pdf", kind: "file", purpose: "Jan's collected ideas" },
  { name: "manifest.yaml", kind: "file", purpose: "asset catalogue (Phase 4)" },
  { name: "ideas", kind: "folder", purpose: "images extracted from ideas.pdf (Phase 4)" },
  { name: "refs", kind: "folder", purpose: "Instagram / Pinterest references" },
  { name: "cards", kind: "folder", purpose: "MTG card art" },
  { name: "existing", kind: "folder", purpose: "photos of existing tattoos" },
  { name: "arm-photos", kind: "folder", purpose: "left arm from four sides" },
  { name: "exports", kind: "folder", purpose: "generated PNG / PDF handouts (Phase 5)" },
];

/** Whether an expected entry is present. Empty folders do not show up in a file listing. */
export function isPresent(entry: ExpectedEntry, files: DataFile[]): boolean {
  return entry.kind === "file"
    ? files.some((f) => f.path === entry.name)
    : files.some((f) => f.path.startsWith(`${entry.name}/`));
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
