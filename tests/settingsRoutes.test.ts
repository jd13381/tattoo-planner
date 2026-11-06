import { describe, expect, it } from "vitest";
import { parseRoute, routeHash, TABS } from "../src/settings/routes.ts";

describe("app routes", () => {
  it("lists Home first, then Layout and Image studio, Settings last", () => {
    expect(TABS.map((t) => t.id)).toEqual(["home", "layout", "images", "compare", "assets", "settings"]);
  });

  it("parses main tabs and Settings sections", () => {
    expect(parseRoute("#compare")).toEqual({ tab: "compare" });
    expect(parseRoute("assets")).toEqual({ tab: "assets" });
    expect(parseRoute("#settings/projection")).toEqual({ tab: "settings", section: "projection" });
    expect(parseRoute("#settings")).toEqual({ tab: "settings", section: "project" });
    expect(parseRoute("#settings/nope")).toEqual({ tab: "settings", section: "project" });
  });

  it("opens Home for an empty or unknown hash", () => {
    expect(parseRoute("")).toEqual({ tab: "home" });
    expect(parseRoute("#whatever")).toEqual({ tab: "home" });
    expect(parseRoute("#layout")).toEqual({ tab: "layout" });
  });

  it("sends the old tabs to their Settings sections", () => {
    expect(parseRoute("#arm")).toEqual({ tab: "settings", section: "body" });
    expect(parseRoute("#projection")).toEqual({ tab: "settings", section: "projection" });
    expect(parseRoute("#data")).toEqual({ tab: "settings", section: "project" });
  });

  it("round-trips through the hash", () => {
    for (const h of [
      "home",
      "layout",
      "images",
      "compare",
      "assets",
      "settings/body",
      "settings/image-generation",
    ])
      expect(routeHash(parseRoute(`#${h}`))).toBe(h);
  });
});
