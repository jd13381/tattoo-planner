import { describe, expect, it } from "vitest";
import {
  defaultLocation,
  folderClash,
  missingForCreate,
  parentPath,
  shortPath,
} from "../src/project/startForm.ts";

describe("shortPath", () => {
  it("replaces a known home folder with ~", () => {
    expect(shortPath("/Users/jan/Documents/Sleeve", "/Users/jan")).toBe("~/Documents/Sleeve");
    expect(shortPath("/Users/jan", "/Users/jan/")).toBe("~");
    expect(shortPath("/Users/janet/x", "/Users/jan")).toBe("/Users/janet/x");
  });
  it("shortens the usual home roots without a known home", () => {
    expect(shortPath("/Users/jan/Documents/")).toBe("~/Documents");
    expect(shortPath("/home/sam")).toBe("~");
    expect(shortPath("/Volumes/Data/Sleeve")).toBe("/Volumes/Data/Sleeve");
    expect(shortPath("/")).toBe("/");
  });
});

describe("parentPath", () => {
  it("returns the folder above", () => {
    expect(parentPath("/a/b/c/")).toBe("/a/b");
    expect(parentPath("/a")).toBe("/");
  });
});

describe("missingForCreate", () => {
  it("names everything that is missing", () => {
    expect(missingForCreate({ name: " ", body: null, location: null })).toBe(
      "Add a name, a body and a location to continue.",
    );
    expect(missingForCreate({ name: "x", body: null, location: "/a" })).toBe("Add a body to continue.");
    expect(missingForCreate({ name: "x", body: "female", location: null })).toBe(
      "Add a location to continue.",
    );
  });
  it("is null when ready, unless a project is in the way", () => {
    expect(missingForCreate({ name: "x", body: "female", location: "/a" })).toBeNull();
    const clash = { blocking: true, message: "taken" };
    expect(missingForCreate({ name: "x", body: "female", location: "/a", clash })).toBe("taken");
    expect(
      missingForCreate({ name: "x", body: "female", location: "/a", clash: { ...clash, blocking: false } }),
    ).toBeNull();
  });
});

describe("defaultLocation", () => {
  it("prefers Documents in the home folder", () => {
    const docs = { name: "Documents", path: "/h/Documents", kind: "folder" as const };
    expect(defaultLocation({ path: "/h", folders: [docs] })).toBe("/h/Documents");
    expect(defaultLocation({ path: "/h", folders: [] })).toBe("/h");
    expect(defaultLocation({ path: "/h", folders: [{ ...docs, kind: "project" }] })).toBe("/h");
  });
});

describe("folderClash", () => {
  const listing = {
    folders: [
      { name: "Sleeve", path: "/h/Sleeve", kind: "project" as const },
      { name: "Notes", path: "/h/Notes", kind: "folder" as const },
    ],
  };
  it("blocks a project, warns for another folder, ignores free names", () => {
    expect(folderClash(listing, "sleeve")?.blocking).toBe(true);
    expect(folderClash(listing, "Notes")?.blocking).toBe(false);
    expect(folderClash(listing, "New one")).toBeNull();
    expect(folderClash(listing, "")).toBeNull();
    expect(folderClash(null, "Sleeve")).toBeNull();
  });
});
