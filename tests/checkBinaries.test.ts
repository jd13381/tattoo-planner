import { describe, expect, it } from "vitest";
// @ts-expect-error: plain ESM script without type declarations
import { rejectReason } from "../scripts/check-binaries.mjs";

const reason = rejectReason as (file: string, bytes?: number) => string | null;

describe("check-binaries", () => {
  it("rejects images and PDFs regardless of case", () => {
    for (const f of [
      "a.png",
      "dir/b.JPG",
      "c.jpeg",
      "d.WebP",
      "e.HEIC",
      "f.pdf",
      "g.Pdf",
      "h.psd",
      "i.tiff",
    ]) {
      expect(reason(f), f).not.toBeNull();
    }
  });

  it("rejects anything under exports/", () => {
    expect(reason("exports/v1.yaml")).toBe("export");
    expect(reason("sub/exports/x.json")).toBe("export");
  });

  it("rejects desktop build output", () => {
    for (const f of [
      "release/Tattoo-Planner-0.1.0-arm64.dmg",
      "x/App.DMG",
      "dist-desktop/desktop/main.js",
      "dist/index.html",
      "build/icon.icns",
      "app.asar",
    ]) {
      expect(reason(f), f).not.toBeNull();
    }
  });

  it("allows code, config and the icon allow-list", () => {
    for (const f of [
      "src/App.tsx",
      "config/layouts/v1-baseline.yaml",
      "README.md",
      "public/icons/arm.png",
      "pdf.ts",
      "desktop/main.ts",
      "docs/release-notes.md",
    ]) {
      expect(reason(f), f).toBeNull();
    }
  });

  it("allows standard background tiles in assets/backgrounds/ only, as PNG/WebP up to 2 MB", () => {
    expect(reason("assets/backgrounds/clouds.png", 900_000)).toBeNull();
    expect(reason("assets/backgrounds/stars.WebP", 2 * 1024 * 1024)).toBeNull();
    expect(reason("assets/backgrounds/clouds.png", 2 * 1024 * 1024 + 1)).toMatch(/over 2 MB/);
    expect(reason("assets/backgrounds/clouds.png")).not.toBeNull();
    for (const f of [
      "assets/backgrounds/ref.jpg",
      "assets/backgrounds/sub/x.png",
      "assets/x.png",
      "x/assets/backgrounds/a.png",
    ])
      expect(reason(f, 1000), f).not.toBeNull();
    expect(reason("assets/backgrounds/backgrounds.yaml")).toBeNull();
  });
});
