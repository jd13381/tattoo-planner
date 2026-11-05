import { describe, expect, it } from "vitest";
import { assetUsage, parseTags } from "../src/assets/usage.ts";

const layout = (name: string, body: string) => ({ name, text: `name: ${name}\nelements:\n${body}` });

describe("assetUsage", () => {
  it("maps each asset to the layouts and elements that show it", () => {
    const files = [
      layout(
        "a",
        `  - { id: f1, type: figure, asset: medusa, position: { u: 0, v: 0.5 }, size_cm: { h: 10 } }
  - { id: f2, type: figure, asset: skull, position: { u: 0, v: 0.3 }, size_cm: { h: 10 } }
  - { id: b, type: band, pattern: meander, v: 0.6, width_cm: 2 }`,
      ),
      layout(
        "b",
        `  - { id: m, type: figure, asset: medusa, position: { u: 0.5, v: 0.5 }, size_cm: { h: 8 } }`,
      ),
      { name: "broken", text: "name: [" },
    ];
    const usage = assetUsage(files);
    expect(usage.get("medusa")).toEqual([
      { layout: "a", element: "f1" },
      { layout: "b", element: "m" },
    ]);
    expect(usage.get("skull")).toEqual([{ layout: "a", element: "f2" }]);
    expect(usage.has("meander")).toBe(false);
  });

  it("splits comma-separated tags", () => {
    expect(parseTags(" medusa, realistic ,,medusa")).toEqual(["medusa", "realistic"]);
    expect(parseTags("")).toEqual([]);
  });
});
