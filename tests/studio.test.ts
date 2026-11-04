import { describe, expect, it } from "vitest";
import {
  artboardAspect,
  elapsedLabel,
  formatUsd,
  hasInput,
  hasResult,
  runEstimate,
  runLabel,
  spentUsd,
  splitRound,
  stepId,
} from "../src/edits/studio.ts";
import type { EditJob } from "../src/edits/types.ts";

const job = (id: string, state: EditJob["state"], extra: Partial<EditJob> = {}): EditJob => ({
  id,
  assetId: "medusa",
  engine: "openai",
  instructions: ["x"],
  tools: ["gpt-image"],
  state,
  startedAt: "2026-11-04T10:00:00.000Z",
  log: [],
  ...extra,
});

describe("splitRound", () => {
  it("puts open results oldest first and history newest first", () => {
    const newestFirst = [
      job("e", "kept"),
      job("d", "done"),
      job("c", "discarded"),
      job("b", "running"),
      job("a", "failed"),
    ];
    const { open, earlier } = splitRound(newestFirst);
    expect(open.map((j) => j.id)).toEqual(["a", "b", "d"]);
    expect(earlier.map((j) => j.id)).toEqual(["e", "c"]);
  });

  it("handles no jobs", () => {
    expect(splitRound([])).toEqual({ open: [], earlier: [] });
  });
});

describe("result and input", () => {
  it("knows which jobs have a result", () => {
    expect(hasResult(job("a", "done"))).toBe(true);
    expect(hasResult(job("a", "kept"))).toBe(true);
    expect(hasResult(job("a", "running"))).toBe(false);
    expect(hasResult(job("a", "failed"))).toBe(false);
  });

  it("a new image has no input until it is edited further", () => {
    expect(hasInput(job("a", "done"))).toBe(true);
    expect(hasInput(job("a", "done", { created: { name: "n" } }))).toBe(false);
    expect(hasInput(job("a", "done", { created: { name: "n" }, fromJob: "z" }))).toBe(true);
  });
});

describe("cost", () => {
  it("sums reported costs and is null without any", () => {
    expect(spentUsd([job("a", "done"), job("b", "done")])).toBeNull();
    expect(
      spentUsd([job("a", "done", { costUsd: 0.04 }), job("b", "done"), job("c", "kept", { costUsd: 0.07 })]),
    ).toBeCloseTo(0.11);
    expect(formatUsd(0.105)).toBe("$0.10");
  });
});

describe("run button", () => {
  it("names what one click does", () => {
    expect(runLabel({ creatingNew: true, refining: false, engine: "openai", count: 1 })).toBe(
      "Create with GPT Image",
    );
    expect(runLabel({ creatingNew: true, refining: false, engine: "openai", count: 3 })).toBe(
      "Create 3 variants",
    );
    expect(runLabel({ creatingNew: false, refining: true, engine: "claude", count: 1 })).toBe(
      "Edit the result",
    );
    expect(runLabel({ creatingNew: false, refining: false, engine: "openai", count: 2 })).toBe(
      "Make 2 variants",
    );
    expect(runLabel({ creatingNew: false, refining: false, engine: "openai", count: 1 })).toBe(
      "Edit with GPT Image",
    );
    expect(runLabel({ creatingNew: false, refining: false, engine: "claude", count: 1 })).toBe(
      "Edit with Claude",
    );
  });

  it("estimates per engine", () => {
    expect(runEstimate("openai", 2)).toMatch(/^2 × GPT Image/);
    expect(runEstimate("claude", 1)).toMatch(/no API cost/);
  });
});

describe("artboard and time", () => {
  it("uses the format's aspect ratio", () => {
    expect(artboardAspect("1024x1024")).toBe(1);
    expect(artboardAspect("1536x1024")).toBe(1.5);
    expect(artboardAspect("1024x1536")).toBeCloseTo(2 / 3);
    expect(artboardAspect("auto")).toBe(1);
  });

  it("formats elapsed time", () => {
    const startedAt = "2026-11-04T10:00:00.000Z";
    expect(elapsedLabel({ startedAt, finishedAt: "2026-11-04T10:00:42.000Z" })).toBe("42 s");
    expect(elapsedLabel({ startedAt, finishedAt: "2026-11-04T10:02:05.000Z" })).toBe("2 min 5 s");
    expect(elapsedLabel({ startedAt }, Date.parse("2026-11-04T10:00:03.000Z"))).toBe("3 s");
  });

  it("steps through ids with wrap-around", () => {
    expect(stepId(["a", "b", "c"], "c", 1)).toBe("a");
    expect(stepId(["a", "b", "c"], "a", -1)).toBe("c");
    expect(stepId(["a"], "x", 1)).toBeNull();
  });
});
