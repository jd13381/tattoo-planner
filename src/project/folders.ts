// Path helpers for the project screens (framework-free; the server runs on the same machine, so its
// paths use "/").
import type { BrowseListing } from "./schema.ts";

/** Home, then every folder below it down to the listed one. */
export function breadcrumb(l: Pick<BrowseListing, "home" | "path">): { label: string; path: string }[] {
  const crumbs = [{ label: "Home", path: l.home }];
  if (l.path === l.home || !l.path.startsWith(`${l.home}/`)) return crumbs;
  let acc = l.home;
  for (const seg of l.path.slice(l.home.length + 1).split("/")) {
    if (!seg) continue;
    acc = `${acc}/${seg}`;
    crumbs.push({ label: seg, path: acc });
  }
  return crumbs;
}

/** A folder name from a project name: no slashes, no leading dots, trimmed. */
export function folderNameFor(name: string): string {
  return (
    name
      // eslint-disable-next-line no-control-regex
      .replace(/[/\\:*?"<>|\u0000-\u001f]+/g, " ")
      .replace(/^\.+/, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80)
  );
}

/** The new project's folder: `name` inside `location`, or `location` itself when the name is empty. */
export function projectFolder(location: string, name: string): string {
  const n = folderNameFor(name);
  if (!n) return location;
  return `${location.replace(/\/+$/, "")}/${n}`;
}

/** The last part of a path, for short labels. */
export function baseName(p: string): string {
  return p.replace(/\/+$/, "").split("/").pop() || p;
}
