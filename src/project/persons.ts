// Persons of a project (docs/adr/0017-persons.md): one project holds the bodies of several people,
// each with own measurements, layouts, projections and photos; the image library is shared.
// Framework-free: the server (store, paths) and the page (switcher, Home) both use it.
//
// project.yaml:
//   body / height_cm / active    belong to the root person (id "me"), exactly as before persons
//                                existed, whose data lives in the project's top-level folders.
//   persons:                     optional; one entry per further person ({ id, name, body,
//                                height_cm?, active? }), data under persons/<id>/. An entry with
//                                id "me" only names the root person and fixes its place in the list.
import { z } from "zod";
import { isRegionId, REGION_IDS, type RegionId } from "../body/regions.ts";
import { BODY_IDS, type BodyId } from "../body/samples.ts";

/** The person whose data lives in the project's top-level folders (every project before persons). */
export const ROOT_PERSON_ID = "me";
/** The root person's name while project.yaml names none. */
export const ROOT_PERSON_DEFAULT_NAME = "Me";
/** Where every person but the root keeps its data: persons/<id>/. */
export const PERSONS_FOLDER = "persons";
/** The sub-folders a new person gets (as a new project; edits and exports stay shared). */
export const PERSON_FOLDERS = ["layouts", "projections", "photos"] as const;
export const MAX_PERSONS = 12;

export const PERSON_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
/** Layout file names (server/layoutsApi.ts). */
const LAYOUT_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;

export const personIdSchema = z.string().regex(PERSON_ID, "use lowercase letters, digits and dashes");
const personNameSchema = z
  .string()
  .trim()
  .min(1, "name is empty")
  .max(60, "name is longer than 60 characters")
  // eslint-disable-next-line no-control-regex
  .regex(/^[^\u0000-\u001f\u007f]*$/, "name contains control characters");

/** The active layout variant per region: the one Home shows. Unknown regions are kept, not used. */
export const activeSchema = z.record(z.string(), z.string().regex(LAYOUT_NAME, "not a layout name"));
export type ActiveMap = Partial<Record<RegionId, string>>;

/** One entry of `persons:`. The root entry ("me") only carries a name; its body is the top level's. */
export const personEntrySchema = z.looseObject({
  id: personIdSchema,
  name: personNameSchema,
  body: z.enum(BODY_IDS).optional(),
  height_cm: z.number().min(50).max(260).nullable().optional(),
  active: activeSchema.optional(),
});
export type PersonEntry = z.infer<typeof personEntrySchema>;

export const personsSchema = z.array(personEntrySchema).superRefine((list, ctx) => {
  const seen = new Set<string>();
  list.forEach((p, i) => {
    if (seen.has(p.id))
      ctx.addIssue({ code: "custom", path: [i, "id"], message: `duplicate person id ${p.id}` });
    seen.add(p.id);
    if (p.id !== ROOT_PERSON_ID && p.body === undefined)
      ctx.addIssue({ code: "custom", path: [i, "body"], message: "body is missing (female | male)" });
  });
  if (list.length > MAX_PERSONS)
    ctx.addIssue({ code: "custom", path: [], message: `at most ${MAX_PERSONS} persons` });
});

/** A person as the page sees it (GET /api/project). */
export type PersonInfo = {
  id: string;
  name: string;
  body: BodyId | null;
  height_cm: number | null;
  /** Active variant per region; a region missing here shows its first variant. */
  active: ActiveMap;
  /** The root person: data in the top-level folders, cannot be deleted. */
  root: boolean;
  /** The person's folder relative to the project, forward slashes; "" for the root person. */
  folder: string;
};

/** The parts of project.yaml that persons read (the top level belongs to the root person). */
export type PersonsSource = {
  body?: BodyId | null;
  height_cm?: number | null;
  active?: Record<string, string>;
  persons?: PersonEntry[];
};

/** Only the known regions of an active map. */
export function knownActive(raw: Record<string, string> | undefined): ActiveMap {
  const out: ActiveMap = {};
  for (const [k, v] of Object.entries(raw ?? {})) if (isRegionId(k)) out[k] = v;
  return out;
}

/** The folder of a person, relative to the project ("" = the project's own top-level folders). */
export function personFolder(id: string): string {
  return id === ROOT_PERSON_ID ? "" : `${PERSONS_FOLDER}/${id}`;
}

/**
 * Every person of a project, in list order. The root person always exists: first unless `persons:`
 * gives it a place, named by its entry or ROOT_PERSON_DEFAULT_NAME. A project without `persons:` has
 * just the root person, so projects from before persons open unchanged.
 */
export function resolvePersons(meta: PersonsSource): PersonInfo[] {
  const root: PersonInfo = {
    id: ROOT_PERSON_ID,
    name: ROOT_PERSON_DEFAULT_NAME,
    body: meta.body ?? null,
    height_cm: meta.height_cm ?? null,
    active: knownActive(meta.active),
    root: true,
    folder: "",
  };
  const entries = meta.persons ?? [];
  const out: PersonInfo[] = entries.map((p) =>
    p.id === ROOT_PERSON_ID
      ? { ...root, name: p.name }
      : {
          id: p.id,
          name: p.name,
          body: p.body ?? null,
          height_cm: p.height_cm ?? null,
          active: knownActive(p.active),
          root: false,
          folder: personFolder(p.id),
        },
  );
  if (!out.some((p) => p.root)) out.unshift(root);
  return out;
}

/** The person to show: the remembered one if it still exists, else the first (the root by default). */
export function pickPerson(persons: PersonInfo[], remembered: string | null | undefined): PersonInfo {
  return persons.find((p) => p.id === remembered) ?? persons[0]!;
}

/** Lowercase, digits and dashes (like asset ids). */
function slug(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32)
    .replace(/-+$/, "");
}

/** A free id for a new person from its name: "Xenia" → xenia, a second one xenia-2. Never "me". */
export function newPersonId(name: string, taken: Iterable<string>): string {
  const used = new Set([...taken, ROOT_PERSON_ID]);
  const base = slug(name) || "person";
  if (!used.has(base)) return base;
  for (let i = 2; ; i++) if (!used.has(`${base}-${i}`)) return `${base}-${i}`;
}

/** Initials for an avatar: "Xenia" → X, "Jan Doe" → JD. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? [words[0]!, words[words.length - 1]!] : words.slice(0, 1);
  return letters.map((w) => Array.from(w)[0]!.toUpperCase()).join("") || "?";
}

/** A stable avatar hue (0–359) for a person id, so each person keeps a colour. */
export function personHue(id: string): number {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return (h * 47) % 360;
}

/**
 * The active variant of a region: the one project.yaml marks if that file still exists for the
 * region, else the region's first variant (by name), else null (no layout on the region).
 */
export function activeVariant(
  region: RegionId,
  variants: readonly { name: string; region: RegionId }[],
  active: ActiveMap,
): string | null {
  const names = variants
    .filter((v) => v.region === region)
    .map((v) => v.name)
    .sort();
  const marked = active[region];
  if (marked && names.includes(marked)) return marked;
  // Same fallback as the Layout tab: Jan's long-standing default, else the first by name.
  if (region === "arm-left" && names.includes("v1-baseline")) return "v1-baseline";
  return names[0] ?? null;
}

/** The active variant of every region (null where a region has none). */
export function activeVariants(
  variants: readonly { name: string; region: RegionId }[],
  active: ActiveMap,
): Record<RegionId, string | null> {
  return Object.fromEntries(REGION_IDS.map((r) => [r, activeVariant(r, variants, active)])) as Record<
    RegionId,
    string | null
  >;
}

/**
 * Whose photo an image file is, by its path in the project: persons/<id>/… belongs to that person;
 * the top-level body-photo folders (photos/, existing/, arm-photos/) to the root person; everything
 * else (images/, generated/, edits/ …) is the shared library (null).
 */
export function assetOwner(file: string): string | null {
  const parts = file.split("/");
  if (parts[0] === PERSONS_FOLDER && parts.length > 2 && PERSON_ID.test(parts[1]!)) return parts[1]!;
  if (parts.length > 1 && ["photos", "existing", "arm-photos"].includes(parts[0]!)) return ROOT_PERSON_ID;
  return null;
}

/** Whether a person should see an image: its own photos and the shared library, not others' photos. */
export function visibleToPerson(file: string, personId: string): boolean {
  const owner = assetOwner(file);
  return owner === null || owner === personId;
}
