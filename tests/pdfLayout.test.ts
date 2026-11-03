import { describe, expect, it } from "vitest";
import {
  columns,
  contentBounds,
  contentBox,
  fitImage,
  gridCells,
  layoutTable,
  padRect,
  pagePlan,
  paginateRows,
  replaceColor,
  toPdfText,
  unionRect,
  unwrapAxisMarks,
  wrapText,
  type Measure,
} from "../src/export/pdfLayout.ts";

/** A fake monospace font: every character 1 mm wide at 10 pt. */
const mono: Measure = (text, size) => (text.length * size) / 10;

describe("page plan", () => {
  it("has cover, overview, four views, two unwraps and the tables", () => {
    const plan = pagePlan();
    expect(plan.map((p) => p.kind)).toEqual([
      "cover",
      "overview",
      "view",
      "view",
      "view",
      "view",
      "unwrap",
      "unwrap",
      "tables",
    ]);
    expect(plan.flatMap((p) => (p.kind === "view" ? [p.view] : []))).toEqual([
      "front",
      "back",
      "medial",
      "lateral",
    ]);
    expect(plan.flatMap((p) => (p.kind === "unwrap" ? [p.mode] : []))).toEqual(["blockout", "reference"]);
    expect(plan.find((p) => p.kind === "overview")!.orientation).toBe("landscape");
  });

  it("keeps margins on both orientations", () => {
    expect(contentBox("portrait")).toEqual({ x: 16, y: 16, w: 178, h: 261 });
    expect(contentBox("landscape")).toEqual({ x: 16, y: 16, w: 265, h: 174 });
  });
});

describe("geometry helpers", () => {
  it("fits images without distortion", () => {
    const box = { x: 10, y: 20, w: 100, h: 100 };
    const tall = fitImage(400, 2000, box);
    expect(tall.h).toBe(100);
    expect(tall.w / tall.h).toBeCloseTo(0.2);
    expect(tall.x).toBeCloseTo(50);
    const wide = fitImage(2000, 1000, box, "top");
    expect(wide).toEqual({ x: 10, y: 20, w: 100, h: 50 });
    expect(fitImage(2000, 1000, box).y).toBe(45);
  });

  it("splits widths and grids", () => {
    expect(columns(100, [1, 3], 10)).toEqual([22.5, 67.5]);
    const cells = gridCells({ x: 0, y: 0, w: 110, h: 50 }, 2, 2, 10, 10);
    expect(cells[3]).toEqual({ x: 60, y: 30, w: 50, h: 20 });
  });

  it("finds the arm in a render and crops all views alike", () => {
    const w = 6;
    const h = 5;
    const data = new Uint8ClampedArray(w * h * 4).fill(255);
    const paint = (i: number, j: number) => data.set([10, 10, 10, 255], (j * w + i) * 4);
    paint(2, 1);
    paint(3, 3);
    expect(contentBounds(data, w, h, [255, 255, 255])).toEqual({ x: 2, y: 1, w: 2, h: 3 });
    expect(contentBounds(new Uint8ClampedArray(16).fill(255), 2, 2, [255, 255, 255])).toBeNull();
    expect(unionRect([{ x: 2, y: 1, w: 2, h: 3 }, null, { x: 0, y: 2, w: 1, h: 1 }])).toEqual({
      x: 0,
      y: 1,
      w: 4,
      h: 3,
    });
    expect(padRect({ x: 1, y: 1, w: 2, h: 2 }, 2, 4, 10)).toEqual({ x: 0, y: 0, w: 4, h: 5 });
  });

  it("whitens the grey around the unwrap only", () => {
    const px = [138, 133, 128, 255, 138, 133, 127, 255];
    replaceColor(px, [138, 133, 128], [255, 255, 255]);
    expect(px).toEqual([255, 255, 255, 255, 138, 133, 127, 255]);
  });

  it("places the centre-line labels across the unwrap's top edge", () => {
    const marks = unwrapAxisMarks(40, 40);
    expect(marks.map((m) => m.side)).toEqual(["inner", "lateral", "outer", "medial", "inner"]);
    expect(marks.map((m) => m.fx)).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(unwrapAxisMarks(20, 40)[0]!.fx).toBe(0.25);
  });
});

describe("text", () => {
  it("wraps words, keeps line breaks and breaks over-long words", () => {
    expect(wrapText("aaa bbb ccc", 7, 10, mono)).toEqual(["aaa bbb", "ccc"]);
    expect(wrapText("one\ntwo", 50, 10, mono)).toEqual(["one", "two"]);
    expect(wrapText("scales-forearm x", 5, 10, mono)).toEqual(["scale", "s-for", "earm", "x"]);
    expect(wrapText("", 5, 10, mono)).toEqual([""]);
  });

  it("keeps Latin-1 and typographic marks, replaces what Helvetica cannot show", () => {
    expect(toPdfText("Jan’s Mäander – 26 × 12 cm … “ok”")).toBe("Jan’s Mäander – 26 × 12 cm … “ok”");
    expect(toPdfText("≈ 3 cm → 4 ≤ 5")).toBe("~ 3 cm -> 4 <= 5");
    expect(toPdfText("😀 Ω")).toBe("? ?");
  });
});

describe("tables", () => {
  const table = layoutTable(
    ["Element", "Notes"],
    [
      ["a", "short"],
      ["b", "x ".repeat(40).trim()],
      ["c", "short"],
    ],
    100,
    [1, 1],
    mono,
    { size: 10, headerSize: 10, padX: 1, padY: 1, leading: 1 },
  );

  it("wraps cells and sizes rows to the tallest cell", () => {
    expect(table.widths).toEqual([50, 50]);
    expect(table.rows[0]!.cells[1]).toEqual(["short"]);
    expect(table.rows[1]!.cells[1]!.length).toBe(2);
    expect(table.rows[1]!.height).toBeGreaterThan(table.rows[0]!.height);
  });

  it("paginates whole rows and repeats nothing when everything fits", () => {
    expect(paginateRows(table, 1000, 1000)).toEqual([[0, 1, 2]]);
    const hh = table.header.height;
    const [r0, r1] = [table.rows[0]!.height, table.rows[1]!.height];
    // Room for the header and the first row only.
    expect(paginateRows(table, hh + r0 + 0.1, 1000)).toEqual([[0], [1, 2]]);
    // Not even the first row fits: the table starts on the next page.
    expect(paginateRows(table, hh + 0.1, 1000)).toEqual([[], [0, 1, 2]]);
    // Small pages: one row each.
    expect(paginateRows(table, hh + r1, hh + r1)).toEqual([[0], [1], [2]]);
  });
});
