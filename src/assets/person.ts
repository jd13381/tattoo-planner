// The person whose photos the Assets tab, the pickers and the projection wizard show: the current
// person of the project (docs/adr/0017-persons.md, src/project/personsStore.ts).
import { usePersons } from "../project/personsStore.ts";
import { ROOT_PERSON_DEFAULT_NAME, ROOT_PERSON_ID } from "../project/persons.ts";
import type { PersonRef } from "./types.ts";

/** The root person, for a legacy folder or a broken project.yaml (no persons known). */
export const ROOT_PERSON: PersonRef = { id: ROOT_PERSON_ID, name: ROOT_PERSON_DEFAULT_NAME, implicit: true };

/** The current person; the root person when the project has none (legacy folder). */
export function useCurrentPerson(): PersonRef {
  const { current } = usePersons();
  return current ? { id: current.id, name: current.name, implicit: current.root } : ROOT_PERSON;
}

/** "Your photos" while the project has one person; with several, the person's name. */
export function personHeading(p: PersonRef | undefined, several: boolean): string {
  if (!p || !several) return "Your photos";
  return p.name || p.id;
}
