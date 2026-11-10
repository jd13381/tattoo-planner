import { describe, expect, it } from "vitest";
import {
  firstSentence,
  generativeBlock,
  runButtonLabel,
  versionName,
  versionTitle,
  versionTitleFor,
} from "../src/edits/studioWords.ts";

describe("studio words", () => {
  it("names versions without the internal v0 numbering", () => {
    expect(versionName(0)).toBe("the original");
    expect(versionName(2)).toBe("version 2");
    expect(versionTitle(0)).toBe("Original");
    expect(versionTitle(3)).toBe("Version 3");
    expect(versionTitleFor(0, true)).toBe("Blank");
    expect(versionTitleFor(1, true)).toBe("Version 1");
  });

  it("labels the run button", () => {
    const c = { creatingNew: false, version: 0, engine: "builtin" as const, count: 1, opLabel: "Mirror" };
    expect(runButtonLabel(c)).toBe("Apply Mirror");
    expect(runButtonLabel({ ...c, version: 2 })).toBe("Apply Mirror to version 2");
    expect(runButtonLabel({ ...c, engine: "openai" })).toBe("Edit with GPT Image");
    expect(runButtonLabel({ ...c, engine: "openai", version: 1 })).toBe("Edit version 1 with GPT Image");
    expect(runButtonLabel({ ...c, engine: "openai", count: 3 })).toBe("Make 3 variants");
    expect(runButtonLabel({ ...c, engine: "openai", count: 2, version: 2 })).toBe(
      "Make 2 variants of version 2",
    );
    expect(runButtonLabel({ ...c, creatingNew: true, engine: "openai" })).toBe("Create with GPT Image");
    expect(runButtonLabel({ ...c, creatingNew: true, engine: "openai", count: 2 })).toBe("Create 2 variants");
  });

  it("takes the first sentence of a hint", () => {
    expect(firstSentence("Removes the colour.")).toBe("Removes the colour.");
    expect(firstSentence("For a photo of a tattoo: keeps the ink. A dark seam may stay.")).toBe(
      "For a photo of a tattoo: keeps the ink.",
    );
    expect(firstSentence("Quarter turns; the image size swaps for 90°.")).toBe(
      "Quarter turns; the image size swaps for 90°.",
    );
    expect(firstSentence("No full stop")).toBe("No full stop");
  });
});

describe("generativeBlock", () => {
  it("tells a missing key from a reason shared with the built-in tools", () => {
    const ro = { enabled: false as const, reason: "The sample project is read-only." };
    const nokey = { enabled: false as const, reason: "Generative edits need an OpenAI API key." };
    expect(generativeBlock({ enabled: true }, nokey)).toBe("key");
    expect(generativeBlock(ro, ro)).toBe("same");
    expect(generativeBlock(ro, nokey)).toBe("key");
    expect(generativeBlock({ enabled: true }, { enabled: true })).toBeNull();
    expect(generativeBlock(undefined, undefined)).toBeNull();
  });
});
