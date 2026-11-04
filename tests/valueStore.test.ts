import { describe, expect, it } from "vitest";
import { createValueStore } from "../src/ui/valueStore.ts";

describe("createValueStore", () => {
  it("notifies subscribers of changes only, until they unsubscribe", () => {
    const store = createValueStore<number | null>(null);
    let calls = 0;
    const off = store.subscribe(() => calls++);
    store.set(1);
    store.set(1);
    expect(store.get()).toBe(1);
    expect(calls).toBe(1);
    off();
    store.set(2);
    expect(store.get()).toBe(2);
    expect(calls).toBe(1);
  });
});
