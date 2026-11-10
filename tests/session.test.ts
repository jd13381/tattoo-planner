import { describe, expect, it } from "vitest";
import {
  attemptsFrom,
  closeQuestion,
  dropQuestion,
  familyOf,
  parentIndex,
  pickVersion,
  runSource,
  sessionForAsset,
  truncateVersions,
  unsavedWork,
  versionLabel,
} from "../src/edits/session.ts";
import type { EditJob, EditSession } from "../src/edits/types.ts";

const job = (id: string, extra: Partial<EditJob> = {}): EditJob => ({
  id,
  assetId: "medusa",
  engine: "openai",
  instructions: ["x"],
  tools: ["gpt-image"],
  state: "done",
  startedAt: `2026-11-04T10:00:0${id.length}.000Z`,
  log: [],
  session: "s1",
  ...extra,
});

const session = (versions: string[], extra: Partial<EditSession> = {}): EditSession => ({
  id: "s1",
  mode: "edit",
  assetId: "medusa",
  versions,
  startedAt: "2026-11-04T10:00:00.000Z",
  ...extra,
});

describe("versions", () => {
  it("knows which version a job started from", () => {
    expect(versionLabel(3)).toBe("v3");
    expect(parentIndex(["a", "b"], job("x"))).toBe(0);
    expect(parentIndex(["a", "b"], job("x", { fromJob: "a" }))).toBe(1);
    expect(parentIndex(["a", "b"], job("x", { fromJob: "b" }))).toBe(2);
    expect(parentIndex(["a"], job("x", { fromJob: "gone" }))).toBeNull();
  });

  it("picks a result as the next version and drops what came after its source", () => {
    expect(pickVersion([], job("a"))).toEqual({ ok: true, versions: ["a"], dropped: 0 });
    expect(pickVersion(["a"], job("c", { fromJob: "a" }))).toEqual({
      ok: true,
      versions: ["a", "c"],
      dropped: 0,
    });
    expect(pickVersion(["a", "c"], job("b"))).toEqual({ ok: true, versions: ["b"], dropped: 2 });
    expect(pickVersion(["a", "c"], job("c", { fromJob: "a" }))).toEqual({
      ok: true,
      versions: ["a", "c"],
      dropped: 0,
    });
    expect(pickVersion(["a"], job("r", { state: "running" })).ok).toBe(false);
    expect(pickVersion(["a"], job("o", { fromJob: "gone" })).ok).toBe(false);
  });

  it("continues from an earlier version", () => {
    expect(truncateVersions(["a", "b", "c"], 1)).toEqual(["a"]);
    expect(truncateVersions(["a", "b"], 0)).toEqual([]);
    expect(truncateVersions(["a"], 5)).toEqual(["a"]);
  });

  it("groups the attempts by the version they started from, in start order", () => {
    const jobs = [
      job("bb", { fromJob: "a" }),
      job("a"),
      job("ccc", { fromJob: "a" }),
      job("b"),
      job("z", { session: "other" }),
    ];
    const s = session(["a"]);
    expect(attemptsFrom(s, jobs, 0).map((j) => j.id)).toEqual(["a", "b"]);
    expect(attemptsFrom(s, jobs, 1).map((j) => j.id)).toEqual(["bb", "ccc"]);
  });
});

describe("source of the next run", () => {
  it("is always the last version, else the image or the blank artboard", () => {
    expect(runSource(session(["a", "b"]))).toEqual({ kind: "job", jobId: "b" });
    expect(runSource(session([]))).toEqual({ kind: "asset", assetId: "medusa" });
    const create = { name: "triangle", size: "1024x1024", background: "transparent" } as const;
    expect(runSource(session([], { mode: "create", assetId: undefined, create }))).toEqual({
      kind: "blank",
      create,
    });
  });

  it("finds the open session on an image", () => {
    const s = session([]);
    expect(sessionForAsset([s], "medusa")).toBe(s);
    expect(sessionForAsset([s], "medusa-edit-1")).toBeNull();
  });
});

describe("closing", () => {
  it("counts what would be lost and asks only then", () => {
    const jobs = [
      job("a", { state: "kept" }),
      job("b", { fromJob: "a" }),
      job("c"),
      job("d", { state: "running" }),
    ];
    const work = unsavedWork(session(["a", "b"]), jobs);
    expect(work).toEqual({ versions: 1, results: 1, running: 1 });
    expect(closeQuestion(work)).toBe(
      "Close without saving? This drops 1 unsaved version, 1 other result, 1 running edit.",
    );
    expect(closeQuestion({ versions: 0, results: 0, running: 0 })).toBeNull();
  });

  it("names the versions a pick drops", () => {
    expect(dropQuestion(2, 1)).toBeNull();
    expect(dropQuestion(2, 2)).toBe("Version 2 will be dropped from this session. Continue?");
    expect(dropQuestion(1, 3)).toBe("Versions 1 to 3 will be dropped from this session. Continue?");
  });
});

describe("familyOf", () => {
  it("lists the original first, then its saved edits by number", () => {
    const assets = [
      { id: "medusa-edit-10", derived_from: "medusa" },
      { id: "skull" },
      { id: "medusa-edit-2", derived_from: "medusa" },
      { id: "medusa" },
    ];
    expect(familyOf(assets, "medusa-edit-2").map((a) => a.id)).toEqual([
      "medusa",
      "medusa-edit-2",
      "medusa-edit-10",
    ]);
    expect(familyOf(assets, "skull").map((a) => a.id)).toEqual(["skull"]);
    expect(familyOf(assets, "missing")).toEqual([]);
  });
});
