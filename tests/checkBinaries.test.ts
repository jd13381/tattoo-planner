import { describe, expect, it } from "vitest";
// @ts-expect-error: plain ESM script without type declarations
import { rejectReason } from "../scripts/check-binaries.mjs";

const reason = rejectReason as (file: string) => string | null;

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

  it("allows code, config and the icon allow-list", () => {
    for (const f of [
      "src/App.tsx",
      "config/layouts/v1-baseline.yaml",
      "README.md",
      "public/icons/arm.png",
      "pdf.ts",
    ]) {
      expect(reason(f), f).toBeNull();
    }
  });
});
