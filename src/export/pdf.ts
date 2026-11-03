// Writes the artist handout PDF with jsPDF (page plan and geometry: pdfLayout.ts, content:
// handout.ts, wording: strings.ts). Images arrive as JPEG bytes; each one is embedded once and
// reused where it appears twice (overview and its own page).
import type { jsPDF as JsPdf } from "jspdf";
import type { Category } from "../metrics/coverage.ts";
import type { ViewName } from "../viewer/views.ts";
import type { Handout } from "./handout.ts";
import {
  columns,
  contentBox,
  fitImage,
  FOOTER_Y,
  layoutTable,
  lineHeight,
  MARGIN,
  MODES,
  pagePlan,
  pageSize,
  paginateRows,
  toPdfText,
  unwrapAxisMarks,
  VIEW_ORDER,
  wrapText,
  type Measure,
  type Orientation,
  type PageSpec,
  type Rect,
} from "./pdfLayout.ts";
import type { HandoutText, Mode } from "./strings.ts";

export type PdfImage = { jpeg: Uint8Array; width: number; height: number };
export type HandoutImages = {
  views: Record<Mode, Record<ViewName, PdfImage>>;
  unwrap: Record<Mode, PdfImage>;
  /** Unwrap geometry for the side labels: circumference at the shoulder edge and the widest one. */
  unwrapTopCircumference: number;
  unwrapMaxCircumference: number;
  /** Arm length in cm, for the print scale of the unwrap. */
  armLength: number;
};

type RGB = [number, number, number];
const INK: RGB = [29, 27, 25];
const MUTED: RGB = [110, 101, 94];
const RULE: RGB = [214, 207, 200];
const RED: RGB = [179, 38, 30];
const NOTE_BG: RGB = [247, 242, 236];
const HEAD_BG: RGB = [238, 233, 227];
const ZEBRA: RGB = [250, 248, 245];

/** Blockout colours (src/render/blockout.ts), repeated here for the legend swatches. */
const SWATCH: Record<Category, RGB> = {
  figure: [74, 70, 67],
  existing: [222, 211, 199],
  filler: [196, 190, 184],
  band: [140, 134, 128],
  line: [198, 40, 40],
  open: [239, 230, 220],
};

type Font = "normal" | "bold" | "italic" | "bolditalic";
type TextOpts = { size: number; font?: Font; color?: RGB; align?: "left" | "center" | "right" };

class Writer {
  readonly doc: JsPdf;
  readonly t: HandoutText;

  constructor(doc: JsPdf, t: HandoutText) {
    this.doc = doc;
    this.t = t;
  }

  measure(font: Font): Measure {
    return (text, size) => {
      this.doc.setFont("helvetica", font);
      this.doc.setFontSize(size);
      return this.doc.getTextWidth(toPdfText(text));
    };
  }

  /** One line of text, top-aligned at y. */
  text(s: string, x: number, y: number, o: TextOpts): void {
    const d = this.doc;
    d.setFont("helvetica", o.font ?? "normal");
    d.setFontSize(o.size);
    d.setTextColor(...(o.color ?? INK));
    d.text(toPdfText(s), x, y, { baseline: "top", align: o.align ?? "left" });
  }

  /** Wrapped paragraph; returns the y below it. */
  para(s: string, x: number, y: number, width: number, o: TextOpts & { leading?: number }): number {
    const lines = wrapText(s, width, o.size, this.measure(o.font ?? "normal"));
    const lh = lineHeight(o.size, o.leading ?? 1.35);
    lines.forEach((line, i) => this.text(line, x, y + i * lh, o));
    return y + lines.length * lh;
  }

  rect(r: Rect, fill: RGB, stroke?: RGB, lineWidth = 0.2): void {
    const d = this.doc;
    d.setFillColor(...fill);
    if (stroke) {
      d.setDrawColor(...stroke);
      d.setLineWidth(lineWidth);
    }
    d.rect(r.x, r.y, r.w, r.h, stroke ? "FD" : "F");
  }

  line(x0: number, y0: number, x1: number, y1: number, color: RGB = RULE, width = 0.25): void {
    this.doc.setDrawColor(...color);
    this.doc.setLineWidth(width);
    this.doc.line(x0, y0, x1, y1);
  }

  image(img: PdfImage, alias: string, box: Rect, alignY: "top" | "center" = "top"): Rect {
    const r = fitImage(img.width, img.height, box, alignY);
    // The same alias embeds the bytes once; later uses only reference them.
    this.doc.addImage(img.jpeg, "JPEG", r.x, r.y, r.w, r.h, alias, "NONE");
    return r;
  }

  /** Page heading; returns the y below it. */
  heading(title: string, box: Rect, intro?: string | string[]): number {
    this.text(title, box.x, box.y, { size: 17, font: "bold" });
    let y = box.y + 9;
    for (const p of intro === undefined ? [] : Array.isArray(intro) ? intro : [intro])
      y = this.para(p, box.x, y, box.w, { size: 9, color: MUTED }) + 1.5;
    return y + 2;
  }

  legend(x: number, y: number, width: number, cols: number, size = 8.5): number {
    const cats: Category[] = ["figure", "existing", "filler", "band", "line", "open"];
    const colW = columns(width, Array(cols).fill(1), 6)[0]!;
    let rowY = y;
    for (let i = 0; i < cats.length; i += cols) {
      const row = cats.slice(i, i + cols);
      let rowH = 4.2;
      row.forEach((c, k) => {
        const cx = x + k * (colW + 6);
        this.swatch(c, cx, rowY);
        const end = this.para(this.t.legend[c], cx + 10, rowY + 0.2, colW - 10, { size });
        rowH = Math.max(rowH, end - rowY);
      });
      rowY += rowH + 2.6;
    }
    return rowY;
  }

  private swatch(c: Category, x: number, y: number): void {
    const r = { x, y, w: 7, h: 4.2 };
    if (c === "existing") {
      this.rect(r, SWATCH.existing, [30, 26, 24], 0.5);
      return;
    }
    this.rect(r, SWATCH[c], c === "open" ? RULE : undefined);
    if (c === "band") {
      // The blockout's diagonal stripes.
      this.doc.setDrawColor(...SWATCH.figure);
      this.doc.setLineWidth(0.5);
      for (let k = -4; k < 8; k += 1.6) {
        const x0 = Math.max(x, x + k);
        const x1 = Math.min(x + r.w, x + k + r.h);
        if (x1 <= x0) continue;
        this.doc.line(x0, y + r.h - (x0 - x - k), x1, y + r.h - (x1 - x - k));
      }
    }
  }
}

function newPage(w: Writer, o: Orientation, first: boolean): Rect {
  if (!first) w.doc.addPage("a4", o);
  return contentBox(o);
}

function drawCover(w: Writer, h: Handout, images: HandoutImages, box: Rect): void {
  const { t } = w;
  const leftW = 104;
  const rightX = box.x + leftW + 10;
  const rightW = box.x + box.w - rightX;

  let y = box.y + 6;
  w.text(t.kicker.toUpperCase(), box.x, y, { size: 8.5, font: "bold", color: RED });
  y += 7;
  w.text(t.title, box.x, y, { size: 28, font: "bold" });
  y += 13;
  y = w.para(t.subject, box.x, y, leftW, { size: 11, color: MUTED }) + 6;
  w.text(t.layout(h.layoutName), box.x, y, { size: 12.5, font: "bold" });
  y += 6.5;
  if (h.description) y = w.para(h.description, box.x, y, leftW, { size: 10, font: "italic" }) + 1;
  y = w.para(t.dateLine(h.date), box.x, y + 1, leftW, { size: 9, color: MUTED }) + 7;

  // The note: the most important text of the handout (PROJECT_BRIEF.md §1.2).
  const pad = 5;
  const noteTop = y;
  const measure = w.measure("normal");
  const noteLines = t.note.map((p) => wrapText(p, leftW - 2 * pad - 1.5, 9.5, measure));
  const lh = lineHeight(9.5, 1.38);
  const noteH = pad + 7 + noteLines.reduce((a, l) => a + l.length * lh + 2.2, 0) + pad - 2.2;
  w.rect({ x: box.x, y: noteTop, w: leftW, h: noteH }, NOTE_BG);
  w.rect({ x: box.x, y: noteTop, w: 1.5, h: noteH }, RED);
  w.text(t.noteTitle, box.x + pad + 1.5, noteTop + pad, { size: 12, font: "bold" });
  let ny = noteTop + pad + 7;
  for (const lines of noteLines) {
    lines.forEach((line, i) => w.text(line, box.x + pad + 1.5, ny + i * lh, { size: 9.5 }));
    ny += lines.length * lh + 2.2;
  }
  y = noteTop + noteH + 9;

  w.text(t.contentsTitle, box.x, y, { size: 10.5, font: "bold" });
  y += 6;
  for (const item of t.contents) {
    w.text("•", box.x + 0.5, y, { size: 9.5, color: RED });
    y = w.para(item, box.x + 5, y, leftW - 5, { size: 9.5 }) + 1.2;
  }

  // Right column: the reference views from the front and the back.
  const imgTop = box.y + 6;
  const cellW = (rightW - 4) / 2;
  let imgBottom = imgTop;
  (["front", "back"] as const).forEach((v, i) => {
    const cell = { x: rightX + i * (cellW + 4), y: imgTop, w: cellW, h: box.h - 70 };
    const r = w.image(images.views.reference[v], `view-reference-${v}`, cell, "top");
    w.text(t.views[v].title, r.x + r.w / 2, r.y + r.h + 2.5, { size: 8.5, font: "bold", align: "center" });
    w.text(t.views[v].side, r.x + r.w / 2, r.y + r.h + 6.5, { size: 7.5, color: MUTED, align: "center" });
    imgBottom = Math.max(imgBottom, r.y + r.h + 10);
  });
  const legendTop = Math.max(y, imgBottom) + 10;

  // Legend across the bottom of the page.
  w.line(box.x, legendTop - 4, box.x + box.w, legendTop - 4);
  w.text(t.legendTitle, box.x, legendTop, { size: 10.5, font: "bold" });
  const ly = w.para(t.legendIntro, box.x, legendTop + 6, box.w, { size: 8.5, color: MUTED }) + 3;
  w.legend(box.x, ly, box.w, 3);
}

function drawOverview(w: Writer, images: HandoutImages, box: Rect): void {
  const { t } = w;
  const top = w.heading(t.overviewTitle, box, t.overviewIntro);
  const groupGap = 9;
  const groupW = columns(box.w, [1, 1, 1, 1], groupGap)[0]!;
  const pairGap = 2;
  const imgW = (groupW - pairGap) / 2;
  const imgTop = top + 9;
  const imgH = box.y + box.h - imgTop - 6;
  VIEW_ORDER.forEach((v, gi) => {
    const gx = box.x + gi * (groupW + groupGap);
    w.text(t.views[v].title, gx + groupW / 2, top, { size: 10, font: "bold", align: "center" });
    w.text(t.views[v].side, gx + groupW / 2, top + 4.3, { size: 7.5, color: MUTED, align: "center" });
    MODES.forEach((m, mi) => {
      const cell = { x: gx + mi * (imgW + pairGap), y: imgTop, w: imgW, h: imgH };
      const r = w.image(images.views[m][v], `view-${m}-${v}`, cell, "top");
      w.text(t.mode[m], r.x + r.w / 2, r.y + r.h + 1.8, { size: 7, color: MUTED, align: "center" });
    });
    if (gi > 0) w.line(gx - groupGap / 2, top, gx - groupGap / 2, box.y + box.h);
  });
}

function drawView(w: Writer, h: Handout, images: HandoutImages, view: ViewName, box: Rect): void {
  const { t } = w;
  const top = w.heading(t.viewTitle(t.views[view].title, t.views[view].side), box);
  const sideW = 52;
  const imgArea = { x: box.x, y: top, w: box.w - sideW - 8, h: box.y + box.h - top - 6 };
  const pairGap = 4;
  const cellW = (imgArea.w - pairGap) / 2;
  MODES.forEach((m, i) => {
    const cell = { x: imgArea.x + i * (cellW + pairGap), y: imgArea.y + 6, w: cellW, h: imgArea.h - 6 };
    const r = w.image(images.views[m][view], `view-${m}-${view}`, cell, "top");
    w.text(t.mode[m], r.x + r.w / 2, imgArea.y, { size: 9, font: "bold", align: "center" });
  });

  const sx = box.x + box.w - sideW;
  let y = top + 6;
  w.text(t.facingTitle, sx, y, { size: 10, font: "bold" });
  y += 6;
  const ids = h.facing[view];
  if (ids.length === 0) y = w.para(t.facingNone, sx, y, sideW, { size: 8.5 });
  const rowsById = new Map(h.elementRows.map((r) => [r[0]!, r]));
  for (const id of ids) {
    const row = rowsById.get(id);
    w.text(id, sx, y, { size: 8.5, font: "bold" });
    y += 3.8;
    if (row) y = w.para(`${row[1]}, ${row[3]}`, sx, y, sideW, { size: 7.5, color: MUTED, leading: 1.3 });
    y += 2;
  }
  y += 4;
  w.line(sx, y, sx + sideW, y);
  y += 4;
  w.text(w.t.legendTitle, sx, y, { size: 9, font: "bold" });
  y = w.legend(sx, y + 5.5, sideW, 1) + 3;
  w.para(t.viewNote, sx, y, sideW, { size: 7.5, color: MUTED });
}

function drawUnwrap(w: Writer, images: HandoutImages, mode: Mode, box: Rect): void {
  const { t } = w;
  const top = w.heading(t.unwrapTitle(t.mode[mode]), box, t.unwrapIntro);
  const labelTop = top + 1;
  const img = images.unwrap[mode];
  const area = { x: box.x, y: labelTop + 5, w: box.w, h: box.y + box.h - labelTop - 5 - 12 };
  const r = w.image(img, `unwrap-${mode}`, area, "top");
  w.doc.setDrawColor(...RULE);
  w.doc.setLineWidth(0.2);
  w.doc.rect(r.x, r.y, r.w, r.h, "S");
  for (const mark of unwrapAxisMarks(images.unwrapTopCircumference, images.unwrapMaxCircumference)) {
    const x = r.x + mark.fx * r.w;
    w.text(t.sideShort[mark.side], x, labelTop, { size: 7.5, color: RED, align: "center" });
  }
  const mmPerCm = (r.h / images.armLength).toFixed(1);
  w.para(t.unwrapScale(mmPerCm), box.x, r.y + r.h + 3, box.w, { size: 8.5, color: MUTED });
}

function drawTables(w: Writer, h: Handout, box: Rect, o: Orientation): void {
  const { t } = w;
  const bottom = box.y + box.h;
  let y = w.heading(t.elementsTitle, box, t.elementsIntro);

  const table = (headers: string[], rows: string[][], weights: number[], numeric: boolean[]) => {
    const layout = layoutTable(headers, rows, box.w, weights, w.measure("normal"));
    const chunks = paginateRows(layout, bottom - y, box.h);
    chunks.forEach((idx, ci) => {
      // An empty first chunk: not even one row fits under the heading, so the rows start overleaf.
      if (ci > 0) {
        newPage(w, o, false);
        y = box.y;
      }
      if (idx.length === 0) return;
      const drawRow = (cells: string[][], height: number, header: boolean, zebra: boolean) => {
        if (header) w.rect({ x: box.x, y, w: box.w, h: height }, HEAD_BG);
        else if (zebra) w.rect({ x: box.x, y, w: box.w, h: height }, ZEBRA);
        let x = box.x;
        cells.forEach((lines, c) => {
          const cw = layout.widths[c]!;
          const right = numeric[c];
          lines.forEach((line, k) =>
            w.text(line, right ? x + cw - 1.6 : x + 1.6, y + 1.4 + k * lineHeight(8, 1.25), {
              size: 8,
              font: header || c === 0 ? "bold" : "normal",
              color: header ? MUTED : INK,
              align: right ? "right" : "left",
            }),
          );
          x += cw;
        });
        y += height;
        w.line(box.x, y, box.x + box.w, y, RULE, 0.15);
      };
      drawRow(layout.header.cells, layout.header.height, true, false);
      idx.forEach((i, k) => drawRow(layout.rows[i]!.cells, layout.rows[i]!.height, false, k % 2 === 1));
    });
    y += 8;
  };

  table(
    t.elementHeaders,
    h.elementRows,
    [25, 14, 24, 27, 41, 21, 25],
    [false, false, false, false, false, false, false],
  );

  const needs = (height: number) => {
    if (y + height > bottom) {
      newPage(w, o, false);
      y = box.y;
    }
  };
  needs(60);
  y = w.heading(t.coverageTitle, { ...box, y }, t.coverageIntro);
  table(
    t.coverageHeaders,
    h.coverageRows,
    [30, 13, 13, 13, 13, 13, 15],
    [false, true, true, true, true, true, true],
  );

  // Keep the open questions together on one page when they fit on one.
  const itemsHeight = [...h.layoutPoints, ...h.designQuestions].reduce(
    (a, item) => a + wrapText(item, box.w - 7, 9, w.measure("normal")).length * lineHeight(9, 1.35) + 1.5,
    0,
  );
  needs(Math.min(box.h, 9 + 2 * 10 + 8 + itemsHeight));
  y = w.heading(t.questionsTitle, { ...box, y });
  const list = (title: string, items: string[], numbered: boolean) => {
    needs(14);
    w.text(title, box.x, y, { size: 10, font: "bold" });
    y += 6;
    if (items.length === 0) {
      y = w.para(t.layoutPointsNone, box.x, y, box.w, { size: 9 }) + 2;
      return;
    }
    items.forEach((item, i) => {
      const lines = wrapText(item, box.w - 7, 9, w.measure("normal"));
      needs(lines.length * lineHeight(9, 1.35) + 1.5);
      w.text(numbered ? `${i + 1}.` : "•", box.x + (numbered ? 0 : 1), y, {
        size: 9,
        color: numbered ? MUTED : RED,
      });
      y = w.para(item, box.x + 7, y, box.w - 7, { size: 9 }) + 1.5;
    });
    y += 4;
  };
  list(t.layoutPointsTitle, h.layoutPoints, false);
  list(t.designQuestionsTitle, h.designQuestions, true);
}

function drawFooters(w: Writer, h: Handout): void {
  const d = w.doc;
  const total = d.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    d.setPage(p);
    const { w: pw, h: ph } = pageSize(
      d.internal.pageSize.getWidth() > d.internal.pageSize.getHeight() ? "landscape" : "portrait",
    );
    const fy = FOOTER_Y(ph);
    w.line(MARGIN.side, fy - 2.5, pw - MARGIN.side, fy - 2.5, RULE, 0.2);
    w.text(w.t.footer(h.layoutName, h.date), MARGIN.side, fy, { size: 7.5, color: MUTED });
    w.text(w.t.page(p, total), pw - MARGIN.side, fy, { size: 7.5, color: MUTED, align: "right" });
  }
}

/** Builds the whole handout and returns the PDF bytes. */
export async function writeHandoutPdf(
  h: Handout,
  images: HandoutImages,
  t: HandoutText,
): Promise<Uint8Array> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true });
  doc.setProperties({
    title: toPdfText(`${t.title} – ${h.layoutName} – ${h.date}`),
    subject: toPdfText(t.noteTitle),
    creator: "Tattoo Planner",
  });
  const w = new Writer(doc, t);
  pagePlan().forEach((spec: PageSpec, i) => {
    const box = newPage(w, spec.orientation, i === 0);
    switch (spec.kind) {
      case "cover":
        return drawCover(w, h, images, box);
      case "overview":
        return drawOverview(w, images, box);
      case "view":
        return drawView(w, h, images, spec.view, box);
      case "unwrap":
        return drawUnwrap(w, images, spec.mode, box);
      case "tables":
        return drawTables(w, h, box, spec.orientation);
    }
  });
  drawFooters(w, h);
  return new Uint8Array(doc.output("arraybuffer"));
}
