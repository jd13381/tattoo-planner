// Sections of the image catalogue (docs/adr/0020-asset-structure.md). Every manifest entry falls
// into one category, derived at read time from its fields, folder and use; an explicit `category`
// field wins. Derived values are never written back, so a manifest that is only read stays
// byte-identical. Framework-free, used by the server (listing, import) and the UI (sidebar, pickers).
import { ROOT_PERSON_ID, PERSON_ID, PERSONS_FOLDER } from "../project/persons.ts";
import type { Asset } from "./manifest.ts";
import { fileKey } from "./manifestDoc.ts";

/** Shared by all persons of a project: the image library. */
export const SHARED_CATEGORIES = ["reference", "generated", "edit", "background"] as const;
/** Belong to one person: photos of the body. */
export const PERSON_CATEGORIES = ["measuring", "existing"] as const;
export const ASSET_CATEGORIES = [...SHARED_CATEGORIES, ...PERSON_CATEGORIES] as const;

export type SharedCategory = (typeof SHARED_CATEGORIES)[number];
export type PersonCategory = (typeof PERSON_CATEGORIES)[number];
export type AssetCategory = (typeof ASSET_CATEGORIES)[number];

/** UI names; kinds and categories are never shown raw. */
export const CATEGORY_LABELS: Record<AssetCategory, string> = {
  reference: "Ideas",
  generated: "Generated",
  edit: "Edits",
  background: "Backgrounds",
  measuring: "Measuring photos",
  existing: "Tattoo photos",
};

/** Singular, for "Move to …" and the detail panel. */
export const CATEGORY_LABELS_ONE: Record<AssetCategory, string> = {
  reference: "Idea",
  generated: "Generated in the studio",
  edit: "Edited in the studio",
  background: "Background",
  measuring: "Measuring photo",
  existing: "Tattoo photo",
};

export function isCategory(v: unknown): v is AssetCategory {
  return typeof v === "string" && (ASSET_CATEGORIES as readonly string[]).includes(v);
}

export function isPersonCategory(c: AssetCategory): c is PersonCategory {
  return (PERSON_CATEGORIES as readonly string[]).includes(c);
}

type Entry = Pick<Asset, "file" | "kind"> &
  Partial<Pick<Asset, "category" | "person" | "derived_from" | "tags">>;

function norm(file: string): string {
  return file.replaceAll("\\", "/").replace(/^(\.\/)+/, "");
}

/** `persons/<id>/rest` → { id, rest }; else null. */
export function personPath(file: string): { id: string; rest: string } | null {
  const parts = norm(file).split("/");
  if (parts.length < 3 || parts[0]!.toLowerCase() !== PERSONS_FOLDER) return null;
  const id = parts[1]!;
  if (!PERSON_ID.test(id)) return null;
  return { id, rest: parts.slice(2).join("/") };
}

function under(file: string, ...folders: string[]): boolean {
  const f = norm(file).toLowerCase();
  return folders.some((d) => f.startsWith(`${d}/`));
}

/**
 * The entry's category. Order: explicit `category`; kind background or backgrounds/ (an edited
 * background stays one); `derived_from` (a kept edit); generated/ or the tag generated; then photos:
 * photos/measuring/ → measuring; photos/existing/, existing/ (also persons/<id>/existing/) or kind
 * existing → existing; a body photo (kind arm-photo, photos/, arm-photos/) → existing when a
 * projection uses the file, else measuring; everything else is an idea.
 * `projectionFiles` holds fileKey()s of every projection photo (all persons).
 */
export function categoryOf(entry: Entry, projectionFiles?: ReadonlySet<string>): AssetCategory {
  if (isCategory(entry.category)) return entry.category;
  // A tileable background stays one when edited (a kept edit copies the original's kind).
  if (entry.kind === "background" || under(entry.file, "backgrounds")) return "background";
  if (entry.derived_from || under(entry.file, "edits")) return "edit";
  if (under(entry.file, "generated") || (entry.tags ?? []).includes("generated")) return "generated";
  const own = personPath(entry.file);
  const rest = own ? own.rest : norm(entry.file);
  if (under(rest, "photos/measuring")) return "measuring";
  if (under(rest, "photos/existing", "existing") || entry.kind === "existing") return "existing";
  if (own || entry.kind === "arm-photo" || under(rest, "photos", "arm-photos")) {
    return projectionFiles?.has(fileKey(entry.file)) ? "existing" : "measuring";
  }
  return "reference";
}

/**
 * The person a photo belongs to: explicit `person`, else persons/<id>/…, else the implicit
 * person. Null for the shared library (ideas, studio images, backgrounds).
 */
export function personOf(
  entry: Entry,
  category: AssetCategory,
  defaultPerson: string = ROOT_PERSON_ID,
): string | null {
  if (!isPersonCategory(category)) return null;
  if (entry.person) return entry.person;
  return personPath(entry.file)?.id ?? defaultPerson;
}

type PersonEntry = Pick<Asset, "id"> &
  Partial<Pick<Asset, "derived_from" | "person">> & { effectivePerson: string | null };

/**
 * Effective persons with studio edits inheriting their original's (Jan, 2026-11-09): an edit of a
 * body photo is that person's, so the projection picker shows it with their photos and not with the
 * shared library. An explicit `person` on the edit wins; else the `derived_from` chain is followed
 * (cycles and unknown originals end it with null). Derived at read time, never written back.
 * Entries that already have a person keep it. Returns new objects only where a person was added.
 */
export function inheritPersons<T extends PersonEntry>(entries: readonly T[]): T[] {
  const byId = new Map(entries.map((a) => [a.id, a]));
  const memo = new Map<string, string | null>();
  const resolve = (a: T, seen: Set<string>): string | null => {
    if (a.effectivePerson !== null) return a.effectivePerson;
    const known = memo.get(a.id);
    if (known !== undefined) return known;
    let person: string | null = null;
    if (a.derived_from && a.person) person = a.person;
    else if (a.derived_from && !seen.has(a.id)) {
      const parent = byId.get(a.derived_from);
      seen.add(a.id);
      person = parent ? resolve(parent, seen) : null;
    }
    memo.set(a.id, person);
    return person;
  };
  return entries.map((a) => {
    const person = resolve(a, new Set());
    return person === a.effectivePerson ? a : { ...a, effectivePerson: person };
  });
}

/** Folder (relative to the project, no trailing slash) where new files of a section are put. */
export function folderFor(
  category: AssetCategory,
  person: string | null,
  defaultPerson: string = ROOT_PERSON_ID,
): string {
  switch (category) {
    case "reference":
      return "images";
    case "generated":
      return "generated";
    case "edit":
      return "edits";
    case "background":
      return "backgrounds";
    case "measuring":
    case "existing": {
      const base = !person || person === defaultPerson ? "" : `${PERSONS_FOLDER}/${person}/`;
      return `${base}photos/${category}`;
    }
  }
}

/** The kind a new entry of a section gets (kinds stay for older code and Jan's own conventions). */
export function kindFor(category: AssetCategory): string {
  switch (category) {
    case "reference":
      return "reference";
    case "generated":
    case "edit":
      return "idea";
    case "background":
      return "background";
    case "measuring":
      return "arm-photo";
    case "existing":
      return "existing";
  }
}

/** Sidebar sections of the Assets tab, in order. */
export type SectionId =
  "all" | "ideas" | "studio" | "backgrounds" | "measuring" | "existing" | "unused" | "hidden" | "missing";

export const SECTION_LABELS: Record<SectionId, string> = {
  all: "All images",
  ideas: "Ideas",
  studio: "Made in studio",
  backgrounds: "Backgrounds",
  measuring: "Measuring photos",
  existing: "Tattoo photos",
  unused: "Unused",
  hidden: "Hidden",
  missing: "Missing file",
};

/** The categories a library or person section shows; null for "all" and the smart albums. */
export function sectionCategories(section: SectionId): AssetCategory[] | null {
  switch (section) {
    case "ideas":
      return ["reference"];
    case "studio":
      return ["generated", "edit"];
    case "backgrounds":
      return ["background"];
    case "measuring":
      return ["measuring"];
    case "existing":
      return ["existing"];
    default:
      return null;
  }
}

/** The category new files dropped into a section get; null where dropping makes no sense. */
export function dropCategory(section: SectionId): AssetCategory | null {
  switch (section) {
    case "ideas":
    case "all":
      return "reference";
    case "backgrounds":
      return "background";
    case "measuring":
      return "measuring";
    case "existing":
      return "existing";
    default:
      return null;
  }
}

/** Where an entry can be moved ("Move to …"): every category but the studio ones, which mean provenance. */
export const MOVE_TARGETS: AssetCategory[] = ["reference", "background", "measuring", "existing"];
