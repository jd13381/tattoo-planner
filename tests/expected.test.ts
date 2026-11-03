import { describe, expect, it } from "vitest";
import { EXPECTED_ENTRIES, formatSize, groupByFolder, isPresent } from "../src/data/expected.ts";

const file = (p: string) => ({ path: p, size: 1, modified: "2026-11-03T00:00:00.000Z" });

describe("expected data folder entries", () => {
  const files = [file("ideas.pdf"), file("existing/photo1.jpg"), file("refs/sub/a.png")];
  const byName = (n: string) => {
    const entry = EXPECTED_ENTRIES.find((e) => e.name === n);
    if (!entry) throw new Error(`no expected entry ${n}`);
    return entry;
  };

  it("detects ideas.pdf and non-empty folders", () => {
    expect(isPresent(byName("ideas.pdf"), files)).toBe(true);
    expect(isPresent(byName("existing"), files)).toBe(true);
    expect(isPresent(byName("refs"), files)).toBe(true);
    expect(isPresent(byName("cards"), files)).toBe(false);
  });

  it("does not mistake a prefix for a folder", () => {
    expect(isPresent(byName("ideas"), files)).toBe(false);
  });

  it("groups by top-level folder, root files first", () => {
    const groups = groupByFolder([file("existing/a.jpg"), file("ideas.pdf"), file("refs/b.png")]);
    expect([...groups.keys()]).toEqual(["", "existing", "refs"]);
    expect([...groupByFolder([file("refs/b.png")]).keys()]).toEqual(["refs"]);
  });

  it("formats sizes", () => {
    expect(formatSize(512)).toBe("512 B");
    expect(formatSize(2048)).toBe("2.0 KB");
    expect(formatSize(3 * 1024 * 1024)).toBe("3.0 MB");
  });
});
