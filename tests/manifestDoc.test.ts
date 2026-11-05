import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { manifestSchema, type Asset } from "../src/assets/manifest.ts";
import {
  fileKey,
  ManifestError,
  mergeManifest,
  NEW_MANIFEST_TEXT,
  updateManifestEntry,
} from "../src/assets/manifestDoc.ts";

const idea = (n: number, bbox: [number, number, number, number] = [1, 2, 3, 4]): Asset => ({
  id: `ideas-p01-0${n}`,
  file: `ideas/page-01-img-0${n}.png`,
  kind: "idea",
  source: 'ideas.pdf p.1, under "Medusa Tattoo"',
  notes: n === 1 ? "Too sexy: but nice" : undefined,
  tags: ["medusa-tattoo"],
  page: 1,
  bbox,
});

const INGEST = { refresh: ["page", "bbox"], matchById: true } as const;

describe("mergeManifest", () => {
  it("creates a new manifest with a header and valid entries", () => {
    const r = mergeManifest(null, [idea(1), idea(2)], INGEST);
    expect(r.changed).toBe(true);
    expect(r.added).toEqual(["ideas-p01-01", "ideas-p01-02"]);
    expect(r.text.startsWith("# Asset catalogue")).toBe(true);
    expect(r.text).toContain("bbox: [1, 2, 3, 4]");
    expect(r.text).toContain("tags: [medusa-tattoo]");
    const m = manifestSchema.parse(parse(r.text));
    expect(m.assets.map((a) => a.id)).toEqual(["ideas-p01-01", "ideas-p01-02"]);
    expect(m.assets[0]).toEqual(idea(1));
    expect(Object.keys(parse(r.text).assets[0])).toEqual([
      "id",
      "file",
      "kind",
      "source",
      "notes",
      "tags",
      "page",
      "bbox",
    ]);
  });

  it("writes an empty manifest when there is nothing to add", () => {
    const r = mergeManifest(null, [], INGEST);
    expect(r).toMatchObject({ text: NEW_MANIFEST_TEXT, changed: true, added: [] });
  });

  it("is idempotent", () => {
    const first = mergeManifest(null, [idea(1), idea(2)], INGEST).text;
    const second = mergeManifest(first, [idea(1), idea(2)], INGEST);
    expect(second).toMatchObject({ text: first, changed: false, added: [], updated: [] });
  });

  it("keeps Jan's comments, edits and renamed ids; refreshes only page and bbox", () => {
    const jan = `# my assets
version: 1
assets:
  # the favourite
  - id: medusa-back  # renamed by Jan
    file: ideas/page-01-img-01.png
    kind: reference
    notes: Jan's note
    tags: [medusa, back]
    page: 1
    bbox: [9, 9, 9, 9] # old position

  - id: rhonas-card
    file: cards/rhonas.jpg
    kind: card-art
`;
    const r = mergeManifest(jan, [idea(1, [5, 6, 7, 8]), idea(2)], INGEST);
    expect(r.added).toEqual(["ideas-p01-02"]);
    expect(r.updated).toEqual(["medusa-back"]);
    expect(r.text).toContain("# my assets\n");
    expect(r.text).toContain("  # the favourite\n  - id: medusa-back # renamed by Jan\n");
    expect(r.text).toContain("bbox: [5, 6, 7, 8] # old position");
    const m = manifestSchema.parse(parse(r.text));
    expect(m.assets[0]).toEqual({
      id: "medusa-back",
      file: "ideas/page-01-img-01.png",
      kind: "reference",
      notes: "Jan's note",
      tags: ["medusa", "back"],
      page: 1,
      bbox: [5, 6, 7, 8],
    });
    expect(m.assets.map((a) => a.id)).toEqual(["medusa-back", "rhonas-card", "ideas-p01-02"]);
    // Unchanged entries are byte for byte the same.
    expect(r.text).toContain("  - id: rhonas-card\n    file: cards/rhonas.jpg\n    kind: card-art\n");
  });

  it("matches by id only when asked to", () => {
    const jan = "assets:\n  - id: ideas-p01-01\n    file: ideas/cleaned.png\n    kind: idea\n";
    expect(mergeManifest(jan, [idea(1)], INGEST).added).toEqual([]);
    // Scans never touch an entry with another file: the new one gets a unique id instead.
    const scan = mergeManifest(jan, [idea(1)], {});
    expect(scan.added).toEqual(["ideas-p01-01-2"]);
    expect(manifestSchema.safeParse(parse(scan.text)).success).toBe(true);
  });

  it("matches files regardless of case and leading ./", () => {
    expect(fileKey("./Cards\\Rhonas.JPG")).toBe("cards/rhonas.jpg");
    const jan = "assets:\n  - id: rhonas\n    file: ./cards/Rhonas.JPG\n    kind: card-art\n";
    const r = mergeManifest(jan, [
      { id: "cards-rhonas", file: "cards/Rhonas.JPG", kind: "card-art", tags: [] },
    ]);
    expect(r).toMatchObject({ changed: false, added: [] });
  });

  it("adds version and assets to a manifest that lacks them", () => {
    const r = mergeManifest("# empty\n{}\n", [idea(2)], INGEST);
    const m = manifestSchema.parse(parse(r.text));
    expect(m.assets).toHaveLength(1);
    expect(r.text.indexOf("version")).toBeLessThan(r.text.indexOf("assets"));
  });

  it("refuses broken manifests instead of overwriting them", () => {
    expect(() => mergeManifest("assets: [\n", [idea(1)])).toThrow(ManifestError);
    expect(() => mergeManifest("assets:\n  - id: Bad Id\n    file: x\n    kind: idea\n", [idea(1)])).toThrow(
      /use lowercase/,
    );
    const dup = "assets:\n  - {id: a, file: x.png, kind: idea}\n  - {id: a, file: y.png, kind: idea}\n";
    expect(() => mergeManifest(dup, [])).toThrow(/duplicate id a/);
  });
});

describe("updateManifestEntry", () => {
  const text = `# catalogue
version: 1
assets:
  # the Medusa
  - id: medusa
    file: refs/medusa.jpg
    kind: reference
    source: Pinterest # where from
    tags: [medusa]

  - id: skull
    file: refs/skull.jpg
    kind: reference
`;

  it("changes tags and notes and keeps comments and other entries", () => {
    const out = updateManifestEntry(text, "medusa", { tags: ["medusa", "realistic"], notes: "Nice face" });
    expect(out).toContain("# the Medusa");
    expect(out).toContain("source: Pinterest # where from");
    expect(out).toContain("tags: [medusa, realistic]");
    const m = manifestSchema.parse(parse(out));
    expect(m.assets[0]).toMatchObject({ notes: "Nice face", tags: ["medusa", "realistic"] });
    // notes goes after source, before tags (KEY_ORDER).
    expect(Object.keys(parse(out).assets[0])).toEqual(["id", "file", "kind", "source", "notes", "tags"]);
    expect(m.assets[1]).toEqual({ id: "skull", file: "refs/skull.jpg", kind: "reference", tags: [] });
  });

  it("sets and clears hidden and removes empty notes", () => {
    const hidden = updateManifestEntry(text, "skull", { hidden: true });
    expect(parse(hidden).assets[1].hidden).toBe(true);
    const shown = updateManifestEntry(hidden, "skull", { hidden: false });
    expect(parse(shown).assets[1]).not.toHaveProperty("hidden");
    const noted = updateManifestEntry(text, "medusa", { notes: "x" });
    expect(parse(updateManifestEntry(noted, "medusa", { notes: null })).assets[0]).not.toHaveProperty(
      "notes",
    );
  });

  it("refuses an unknown id and a broken manifest", () => {
    expect(() => updateManifestEntry(text, "nope", { hidden: true })).toThrow(ManifestError);
    expect(() => updateManifestEntry("assets: [{ id: 1 }]", "x", {})).toThrow(ManifestError);
  });
});
