import { describe, expect, it } from "vitest";
import { readFlag, writeFlag } from "../src/editor/viewPrefs.ts";

function memoryStore(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
    key: () => null,
    get length() {
      return map.size;
    },
  };
}

describe("view preferences", () => {
  it("returns the fallback until a value is stored, then the stored one", () => {
    const store = memoryStore();
    expect(readFlag("layout.coverage", false, store)).toBe(false);
    expect(readFlag("layout.coverage", true, store)).toBe(true);
    writeFlag("layout.coverage", true, store);
    expect(readFlag("layout.coverage", false, store)).toBe(true);
    writeFlag("layout.coverage", false, store);
    expect(readFlag("layout.coverage", true, store)).toBe(false);
  });

  it("ignores foreign values and a missing or failing store", () => {
    const store = memoryStore();
    store.setItem("layout.coverage", "yes");
    expect(readFlag("layout.coverage", false, store)).toBe(false);
    expect(readFlag("layout.coverage", true, null)).toBe(true);
    const broken = {
      ...memoryStore(),
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    } as Storage;
    expect(readFlag("layout.coverage", true, broken)).toBe(true);
    expect(() => writeFlag("layout.coverage", true, broken)).not.toThrow();
  });
});
