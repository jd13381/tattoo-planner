// Persons of a project, as far as the Assets tab needs them (shared contract with the people-home
// work, docs/adr/0020-asset-structure.md). A project without a `persons:` list has one implicit
// person who uses the top-level folders (measurements.yaml, layouts/, projections/, photos/);
// further persons keep the same sub-structure under persons/<id>/. The image library (images/,
// generated/, edits/, backgrounds/) is shared by all persons.
//
// This is a seam: `useCurrentPerson` returns the implicit person until the persons API exists, so
// wiring the real one is a one-line change.

/** Id of the implicit person of a project without a persons list. */
export const DEFAULT_PERSON_ID = "me";

/** Folder that holds the data of every person but the implicit one. */
export const PERSONS_FOLDER = "persons";

export const PERSON_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

export type PersonRef = {
  id: string;
  /** Null for the implicit person (the UI says "Your photos"). */
  name: string | null;
  /** True for the person whose data lives in the top-level folders. */
  implicit: boolean;
};

export const IMPLICIT_PERSON: PersonRef = { id: DEFAULT_PERSON_ID, name: null, implicit: true };

/** The person the UI works on. Until persons can be chosen, always the implicit one. */
export function useCurrentPerson(): PersonRef {
  return IMPLICIT_PERSON;
}

/** "Your photos" for the implicit person, else the person's name. */
export function personHeading(p: PersonRef | undefined): string {
  if (!p || (p.implicit && !p.name)) return "Your photos";
  return p.name ?? p.id;
}
