import { describe, expect, it } from "vitest";
import { shortcutAction } from "../src/editor/shortcuts.ts";
import {
  groupMatches,
  isPaletteChord,
  matchCommand,
  moveActive,
  rankCommands,
  splitByRanges,
  type CommandSpec,
} from "../src/ui/commands.ts";

const COMMANDS: CommandSpec[] = [
  { id: "go:home", title: "Home", group: "Go to" },
  { id: "go:layout", title: "Layout", group: "Go to", keywords: "editor unwrap" },
  { id: "go:images", title: "Image studio", group: "Go to", keywords: "edit generate" },
  { id: "go:settings", title: "Settings", group: "Go to" },
  { id: "settings:image-generation", title: "Settings: Image generation", group: "Go to" },
  { id: "region:arm-left", title: "Left arm", group: "Body regions", keywords: "sleeve" },
  { id: "region:leg-left", title: "Left leg", group: "Body regions" },
  { id: "theme:dark", title: "Dark theme", group: "Theme", keywords: "appearance night" },
  { id: "theme:reset", title: "Reset to system theme", group: "Theme" },
];

const ids = (query: string) => rankCommands(COMMANDS, query).map((m) => m.command.id);

describe("command matching", () => {
  it("keeps every command in the given order for an empty query", () => {
    expect(ids("")).toEqual(COMMANDS.map((c) => c.id));
    expect(ids("   ")).toEqual(COMMANDS.map((c) => c.id));
  });

  it("ranks a title that starts with the query first", () => {
    expect(ids("set")[0]).toBe("go:settings");
    // "Reset to system theme" contains "set" only inside a word.
    expect(ids("set").indexOf("theme:reset")).toBeGreaterThan(
      ids("set").indexOf("settings:image-generation"),
    );
    expect(ids("left")).toEqual(["region:arm-left", "region:leg-left"]);
  });

  it("ranks a whole word above the start of a longer word", () => {
    const list: CommandSpec[] = [
      { id: "save", title: "Save the sample as my project", group: "Project" },
      { id: "sam", title: "Switch to Sam", group: "People" },
    ];
    expect(rankCommands(list, "sam").map((m) => m.command.id)).toEqual(["sam", "save"]);
  });

  it("is case-insensitive and finds later words", () => {
    expect(ids("STUDIO")).toEqual(["go:images"]);
    expect(ids("arm")).toEqual(["region:arm-left"]);
  });

  it("finds a command by its keywords and by its group", () => {
    expect(ids("sleeve")).toEqual(["region:arm-left"]);
    expect(ids("night")).toEqual(["theme:dark"]);
    expect(ids("regions")).toEqual(["region:arm-left", "region:leg-left"]);
  });

  it("takes keywords and group names only from the start of a word", () => {
    // "le" is inside "sleeve" (a keyword of Left arm) but starts no word of Dark theme's keywords.
    expect(ids("le")).toEqual(["region:arm-left", "region:leg-left"]);
    expect(ids("ody")).toEqual([]);
  });

  it("needs every word of the query", () => {
    expect(ids("left leg")).toEqual(["region:leg-left"]);
    // "gen" is in the title of one and only in the keywords of the other.
    expect(ids("image gen")).toEqual(["settings:image-generation", "go:images"]);
    expect(ids("left xyz")).toEqual([]);
  });

  it("matches letters in order with gaps, but below a plain match", () => {
    expect(ids("imst")).toContain("go:images");
    expect(ids("lyt")).toEqual(["go:layout"]);
    const order = ids("la");
    expect(order[0]).toBe("go:layout");
  });

  it("does not match letters scattered over a long title", () => {
    expect(matchCommand({ id: "x", title: "Reset to system theme", group: "g" }, "rm")).toBeNull();
    expect(ids("zzz")).toEqual([]);
  });

  it("reports the matched ranges of the title, merged", () => {
    expect(matchCommand(COMMANDS[2]!, "studio")!.ranges).toEqual([[6, 12]]);
    expect(matchCommand(COMMANDS[5]!, "left arm")!.ranges).toEqual([
      [0, 4],
      [5, 8],
    ]);
    // A keyword hit marks nothing in the title.
    expect(matchCommand(COMMANDS[5]!, "sleeve")!.ranges).toEqual([]);
  });
});

describe("command groups", () => {
  it("keeps the given group order for an empty query", () => {
    expect(groupMatches(rankCommands(COMMANDS, "")).map((g) => g.group)).toEqual([
      "Go to",
      "Body regions",
      "Theme",
    ]);
  });

  it("puts the group of the best match first and keeps a group together", () => {
    const groups = groupMatches(rankCommands(COMMANDS, "the"));
    expect(groups[0]!.group).toBe("Theme");
    expect(groups[0]!.items.map((m) => m.command.id)).toEqual(["theme:dark", "theme:reset"]);
    const flat = groupMatches(rankCommands(COMMANDS, "le")).flatMap((g) =>
      g.items.map((m) => m.command.group),
    );
    // Each group appears as one run.
    expect(flat.filter((g, i) => g !== flat[i - 1]).length).toBe(new Set(flat).size);
  });
});

describe("palette keys", () => {
  it("wraps the active row", () => {
    expect(moveActive(0, 1, 3)).toBe(1);
    expect(moveActive(2, 1, 3)).toBe(0);
    expect(moveActive(0, -1, 3)).toBe(2);
    expect(moveActive(-1, 1, 3)).toBe(0);
    expect(moveActive(0, 1, 0)).toBe(-1);
  });

  it("splits a title by ranges", () => {
    expect(splitByRanges("Left arm", [[5, 8]])).toEqual([
      { text: "Left ", hit: false },
      { text: "arm", hit: true },
    ]);
    expect(splitByRanges("Home", [])).toEqual([{ text: "Home", hit: false }]);
  });

  const key = (k: string, mods: Partial<Parameters<typeof isPaletteChord>[0]> = {}) => ({
    key: k,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    ...mods,
  });

  it("opens on Cmd+K on a Mac and Ctrl+K elsewhere, with nothing else held", () => {
    expect(isPaletteChord(key("k", { metaKey: true }), "mac")).toBe(true);
    expect(isPaletteChord(key("K", { ctrlKey: true }), "other")).toBe(true);
    expect(isPaletteChord(key("k", { ctrlKey: true }), "mac")).toBe(false);
    expect(isPaletteChord(key("k", { metaKey: true }), "other")).toBe(false);
    expect(isPaletteChord(key("k"), "mac")).toBe(false);
    expect(isPaletteChord(key("k", { metaKey: true, shiftKey: true }), "mac")).toBe(false);
    expect(isPaletteChord(key("k", { ctrlKey: true, altKey: true }), "other")).toBe(false);
    expect(isPaletteChord(key("j", { ctrlKey: true }), "other")).toBe(false);
  });

  it("does not collide with a Layout shortcut", () => {
    for (const platform of ["mac", "other"] as const)
      for (const isEditableTarget of [false, true])
        expect(
          shortcutAction(
            { ...key("k", platform === "mac" ? { metaKey: true } : { ctrlKey: true }), isEditableTarget },
            platform,
          ),
        ).toBeNull();
  });
});
