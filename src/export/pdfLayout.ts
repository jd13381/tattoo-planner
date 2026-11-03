// Page geometry of the handout, without a PDF library: page sizes, the page plan, image fitting,
// text wrapping and table pagination. Units are millimetres; text is measured through a callback so
// the PDF writer can plug in the real font metrics and the tests a fake one.
import type { ViewName } from "../viewer/views.ts";
import type { Mode } from "./strings.ts";

export type Rect = { x: number; y: number; w: number; h: number };

export const A4 = { w: 210, h: 297 } as const;
export const MARGIN = { top: 16, side: 16, bottom: 20 } as const;
/** Baseline of the page footer, from the top. */
export const FOOTER_Y = (pageH: number) => pageH - 10;

export type Orientation = "portrait" | "landscape";
export function pageSize(o: Orientation): { w: number; h: number } {
  return o === "portrait" ? { w: A4.w, h: A4.h } : { w: A4.h, h: A4.w };
}

/** The writable area of a page. */
export function contentBox(o: Orientation): Rect {
  const { w, h } = pageSize(o);
  return { x: MARGIN.side, y: MARGIN.top, w: w - 2 * MARGIN.side, h: h - MARGIN.top - MARGIN.bottom };
}

export type PageSpec =
  | { kind: "cover"; orientation: "portrait" }
  | { kind: "overview"; orientation: "landscape" }
  | { kind: "view"; orientation: "portrait"; view: ViewName }
  | { kind: "unwrap"; orientation: "portrait"; mode: Mode }
  | { kind: "tables"; orientation: "portrait" };

export const VIEW_ORDER: ViewName[] = ["front", "back", "medial", "lateral"];
export const MODES: Mode[] = ["blockout", "reference"];

/**
 * The fixed part of the handout: cover, the four views on one landscape page, one page per view,
 * the unwrap in both modes, then the tables (elements, coverage, open questions), which flow over
 * as many pages as they need.
 */
export function pagePlan(): PageSpec[] {
  return [
    { kind: "cover", orientation: "portrait" },
    { kind: "overview", orientation: "landscape" },
    ...VIEW_ORDER.map((view) => ({ kind: "view" as const, orientation: "portrait" as const, view })),
    ...MODES.map((mode) => ({ kind: "unwrap" as const, orientation: "portrait" as const, mode })),
    { kind: "tables", orientation: "portrait" },
  ];
}

/** Largest rectangle with the image's proportions inside the box, centred (never distorted). */
export function fitImage(imgW: number, imgH: number, box: Rect, alignY: "top" | "center" = "center"): Rect {
  const scale = Math.min(box.w / imgW, box.h / imgH);
  const w = imgW * scale;
  const h = imgH * scale;
  return { x: box.x + (box.w - w) / 2, y: alignY === "top" ? box.y : box.y + (box.h - h) / 2, w, h };
}

/** Splits a width into columns by weight, with gaps between them. */
export function columns(total: number, weights: number[], gap = 0): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  const free = total - gap * (weights.length - 1);
  return weights.map((w) => (free * w) / sum);
}

/** Cells of a row-major grid inside a box. */
export function gridCells(box: Rect, cols: number, rows: number, gapX: number, gapY: number): Rect[] {
  const w = (box.w - gapX * (cols - 1)) / cols;
  const h = (box.h - gapY * (rows - 1)) / rows;
  const out: Rect[] = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) out.push({ x: box.x + c * (w + gapX), y: box.y + r * (h + gapY), w, h });
  return out;
}

/** Width of `text` in mm at `size` pt. */
export type Measure = (text: string, size: number) => number;

/**
 * Greedy word wrap. Keeps explicit line breaks; a word longer than the line is broken into pieces
 * (long asset ids and file names must never run out of their table cell).
 */
export function wrapText(text: string, width: number, size: number, measure: Measure): string[] {
  const lines: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (measure(candidate, size) <= width) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      let rest = word;
      while (measure(rest, size) > width && rest.length > 1) {
        let n = rest.length - 1;
        while (n > 1 && measure(rest.slice(0, n), size) > width) n--;
        lines.push(rest.slice(0, n));
        rest = rest.slice(n);
      }
      line = rest;
    }
    lines.push(line);
  }
  return lines;
}

/** Line height in mm for a font size in pt (1 pt = 0.3528 mm), with the given leading. */
export function lineHeight(size: number, leading = 1.3): number {
  return size * 0.3528 * leading;
}

export type TableStyle = { size: number; headerSize: number; padX: number; padY: number; leading: number };
export const TABLE_STYLE: TableStyle = { size: 8, headerSize: 8, padX: 1.6, padY: 1.4, leading: 1.25 };

export type TableRow = { cells: string[][]; height: number };
export type TableLayout = { widths: number[]; header: TableRow; rows: TableRow[] };

export function layoutRow(
  cells: string[],
  widths: number[],
  size: number,
  style: TableStyle,
  measure: Measure,
): TableRow {
  const wrapped = cells.map((c, i) => wrapText(c, widths[i]! - 2 * style.padX, size, measure));
  const lines = Math.max(1, ...wrapped.map((w) => w.length));
  return { cells: wrapped, height: lines * lineHeight(size, style.leading) + 2 * style.padY };
}

export function layoutTable(
  headers: string[],
  rows: string[][],
  width: number,
  weights: number[],
  measure: Measure,
  style: TableStyle = TABLE_STYLE,
): TableLayout {
  const widths = columns(width, weights);
  return {
    widths,
    header: layoutRow(headers, widths, style.headerSize, style, measure),
    rows: rows.map((r) => layoutRow(r, widths, style.size, style, measure)),
  };
}

/**
 * Splits table rows into pages: the first chunk gets `firstHeight` (what is left on the current
 * page), later chunks `nextHeight`; the header repeats on every chunk. A row is never split. An
 * empty first chunk means the table starts on a new page. A row taller than a whole page still gets
 * a page of its own (it then runs over the bottom margin).
 */
export function paginateRows(table: TableLayout, firstHeight: number, nextHeight: number): number[][] {
  const chunks: number[][] = [[]];
  let room = firstHeight - table.header.height;
  table.rows.forEach((row, i) => {
    const freshPage = chunks.length > 1 && chunks[chunks.length - 1]!.length === 0;
    if (row.height > room && !freshPage) {
      chunks.push([]);
      room = nextHeight - table.header.height;
    }
    chunks[chunks.length - 1]!.push(i);
    room -= row.height;
  });
  return chunks;
}

/** Characters the standard PDF fonts (WinAnsi) can show besides Latin-1. */
const WIN_ANSI_EXTRA = new Set("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ");
const REPLACEMENTS: Record<string, string> = {
  "≈": "~",
  "→": "->",
  "←": "<-",
  "≤": "<=",
  "≥": ">=",
  "−": "-",
  "✔": "yes",
  " ": " ",
};

/** Makes text safe for the standard Helvetica font: unknown characters become "?" instead of garbage. */
export function toPdfText(text: string): string {
  let out = "";
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (REPLACEMENTS[ch] !== undefined) out += REPLACEMENTS[ch];
    else if (
      ch === "\n" ||
      (code >= 0x20 && code <= 0x7e) ||
      (code >= 0xa0 && code <= 0xff) ||
      WIN_ANSI_EXTRA.has(ch)
    )
      out += ch;
    else if (code < 0x20) out += " ";
    else out += "?";
  }
  return out;
}

/**
 * Bounding box of the pixels that differ from the background colour (RGBA rows), or null when the
 * image is all background. Used to crop the rendered views to the arm.
 */
export function contentBounds(
  data: ArrayLike<number>,
  width: number,
  height: number,
  bg: readonly [number, number, number],
  tolerance = 6,
): Rect | null {
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      const k = (j * width + i) * 4;
      if (
        Math.abs(data[k]! - bg[0]) > tolerance ||
        Math.abs(data[k + 1]! - bg[1]) > tolerance ||
        Math.abs(data[k + 2]! - bg[2]) > tolerance
      ) {
        if (i < x0) x0 = i;
        if (i > x1) x1 = i;
        if (j < y0) y0 = j;
        if (j > y1) y1 = j;
      }
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

export function unionRect(rects: (Rect | null)[]): Rect | null {
  const rs = rects.filter((r): r is Rect => r !== null);
  if (rs.length === 0) return null;
  const x0 = Math.min(...rs.map((r) => r.x));
  const y0 = Math.min(...rs.map((r) => r.y));
  const x1 = Math.max(...rs.map((r) => r.x + r.w));
  const y1 = Math.max(...rs.map((r) => r.y + r.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Grows a pixel rectangle by `pad` on each side, clamped to the image. */
export function padRect(r: Rect, pad: number, width: number, height: number): Rect {
  const x = Math.max(0, Math.floor(r.x - pad));
  const y = Math.max(0, Math.floor(r.y - pad));
  const x1 = Math.min(width, Math.ceil(r.x + r.w + pad));
  const y1 = Math.min(height, Math.ceil(r.y + r.h + pad));
  return { x, y, w: x1 - x, h: y1 - y };
}

/** Replaces one exact RGB colour in RGBA pixels, e.g. the grey around the unwrap with paper white. */
export function replaceColor(
  data: Uint8ClampedArray | number[],
  from: readonly [number, number, number],
  to: readonly [number, number, number],
): void {
  for (let k = 0; k < data.length; k += 4) {
    if (data[k] === from[0] && data[k + 1] === from[1] && data[k + 2] === from[2]) {
      data[k] = to[0];
      data[k + 1] = to[1];
      data[k + 2] = to[2];
    }
  }
}

/**
 * Where the named centre lines meet the top (shoulder) edge of the unwrap, as fractions of the image
 * width: the thumb side (lateral) is drawn on the left (src/arm/uv.ts), the inner line is both edges.
 */
export function unwrapAxisMarks(
  topCircumference: number,
  maxCircumference: number,
): { side: "inner" | "lateral" | "outer" | "medial"; fx: number }[] {
  const at = (u: number) => 0.5 - (u * topCircumference) / maxCircumference;
  return [
    { side: "inner", fx: at(0.5) },
    { side: "lateral", fx: at(0.25) },
    { side: "outer", fx: at(0) },
    { side: "medial", fx: at(-0.25) },
    { side: "inner", fx: at(-0.5) },
  ];
}
