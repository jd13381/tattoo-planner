import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolvePersons } from "../src/project/persons.ts";
import { projectPersons } from "../server/persons.ts";
import type { ProjectPaths } from "../server/project/store.ts";

const dir = path.join("/projects", "ink");
const paths = (person: string | null, base = dir): ProjectPaths => ({
  dir,
  personDir: base,
  person,
  layoutsDir: path.join(base, "layouts"),
  projectionsDir: path.join(base, "projections"),
  measurementsFile: path.join(base, "measurements.yaml"),
  readOnly: false,
});

describe("persons for the Assets API", () => {
  const persons = resolvePersons({
    body: "male",
    persons: [{ id: "xenia", name: "Xenia", body: "female" }],
  });

  it("gives every person their own layouts and projections, the root the top level", () => {
    const xenia = path.join(dir, "persons", "xenia");
    expect(projectPersons(paths("xenia", xenia), persons)).toEqual([
      {
        id: "me",
        name: "Me",
        implicit: true,
        layoutsDir: path.join(dir, "layouts"),
        projectionsDir: path.join(dir, "projections"),
      },
      {
        id: "xenia",
        name: "Xenia",
        implicit: false,
        layoutsDir: path.join(xenia, "layouts"),
        projectionsDir: path.join(xenia, "projections"),
      },
    ]);
  });

  it("keeps the current paths for a legacy folder without persons", () => {
    const legacy = paths(null, path.join("/app", "config"));
    expect(projectPersons(legacy, [])).toEqual([
      {
        id: "me",
        name: "Me",
        implicit: true,
        layoutsDir: legacy.layoutsDir,
        projectionsDir: legacy.projectionsDir,
      },
    ]);
    expect(projectPersons({ ...legacy, dir: null }, [])).toEqual([]);
  });
});
