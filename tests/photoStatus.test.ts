import { describe, expect, it } from "vitest";
import { photoStatus } from "../src/projection/photoStatus.ts";

const file = "existing/anubis1.jpg";
const ok = { exists: true };

describe("photoStatus", () => {
  it("waits for the listing before judging the photo", () => {
    expect(photoStatus({ file, listing: "loading", info: null, image: undefined }).kind).toBe("loading");
  });

  it("names the data folder when it is unset or unreadable", () => {
    const unset = photoStatus({ file, listing: "unset", info: null, image: undefined });
    expect(unset).toMatchObject({ kind: "blocked", title: "No data folder" });
    expect(photoStatus({ file, listing: "error", info: null, image: undefined }).kind).toBe("blocked");
  });

  it("tells a photo outside the manifest from one missing on disk", () => {
    const notListed = photoStatus({ file, listing: "ok", info: null, image: undefined });
    expect(notListed).toMatchObject({ kind: "blocked", title: "anubis1.jpg is not in manifest.yaml" });
    const missing = photoStatus({ file, listing: "ok", info: { exists: false }, image: undefined });
    expect(missing).toMatchObject({ kind: "blocked", title: "anubis1.jpg is missing" });
  });

  it("reports loading, load errors and ready images", () => {
    expect(photoStatus({ file, listing: "ok", info: ok, image: undefined })).toEqual({
      kind: "loading",
      title: "Loading anubis1.jpg…",
    });
    expect(photoStatus({ file, listing: "ok", info: ok, image: { status: "loading" } }).kind).toBe("loading");
    expect(
      photoStatus({ file, listing: "ok", info: ok, image: { status: "error", message: "decode failed" } }),
    ).toMatchObject({ kind: "blocked", detail: "decode failed" });
    expect(photoStatus({ file, listing: "ok", info: ok, image: { status: "ready" } })).toEqual({
      kind: "ready",
    });
  });
});
