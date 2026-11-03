// Page analysis for ideas.pdf ingestion (PROJECT_BRIEF.md §10.1 F11, ADR 0003): orders the images on
// each page, finds the section heading and short label above them and assigns nearby caption text.
// Pure functions over the extractor's output, so they can be tested without a PDF.
import type { Asset } from "./manifest.ts";

/**
 * Rectangle [x0, y0, x1, y1] in PDF points (1/72 inch), origin at the top-left corner of the page,
 * y growing downwards (MuPDF's page space, the way the page is seen).
 */
export type Box = [number, number, number, number];

export type TextLine = {
  text: string;
  bbox: Box;
  /** Largest font size on the line, in points. */
  size: number;
  /** Index of the text block the line belongs to; lines of one block can form a paragraph. */
  block: number;
};

/** One page as the PDF extractor reports it. Images are listed in drawing order. */
export type ExtractedPage = {
  /** 1-based page number. */
  page: number;
  lines: TextLine[];
  images: { bbox: Box }[];
};

export type Heading = { text: string; page: number };

export type IdeaImage = {
  page: number;
  /** 1-based position in reading order on the page (rows top to bottom, left to right in a row). */
  number: number;
  /** Index into ExtractedPage.images. */
  imageIndex: number;
  bbox: Box;
  /** Last heading above the image, possibly on an earlier page. */
  heading?: Heading;
  /** Short label line above the image on the same page, e.g. "Charon". */
  label?: string;
  /** Caption paragraphs assigned to this image, top to bottom. */
  captions: string[];
};

export type LayoutOptions = {
  /** A line counts as a heading when its font is at least this many times the body size. */
  headingScale: number;
  /** Text further than this from every image (in points) is not a caption. */
  maxCaptionGap: number;
  /** Distance factor for text directly above an image; < 1 prefers captions above (Google Docs style). */
  aboveBias: number;
  /** Labels are short lines of at most this many words. */
  maxLabelWords: number;
};

export const DEFAULT_LAYOUT_OPTIONS: LayoutOptions = {
  headingScale: 1.3,
  maxCaptionGap: 36,
  aboveBias: 0.75,
  maxLabelWords: 3,
};

/** Removes zero-width characters, list bullets and repeated whitespace. */
export function cleanText(s: string): string {
  return s
    .replace(/[\u200b-\u200d\u2060\ufeff]/g, "")
    .replace(/^\s*[●•◦▪■–-]\s+/u, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Cleans the plain text of a page for page-NN.txt; null when the page has no text. */
export function cleanPageText(s: string): string | null {
  const text = s
    .replace(/[\u200b-\u200d\u2060\ufeff]/g, "")
    .split("\n")
    .map((l) => l.replace(/\s+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text ? `${text}\n` : null;
}

const pad = (n: number) => String(n).padStart(2, "0");

export const ideaImageBase = (page: number, n: number) => `page-${pad(page)}-img-${pad(n)}`;
export const ideaTextFile = (page: number) => `ideas/page-${pad(page)}.txt`;
export const ideaAssetId = (page: number, n: number) => `ideas-p${pad(page)}-${pad(n)}`;

/** Lowercase, digits and dashes only, as asset ids and tags need. */
export function slug(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function hOverlap(a: Box, b: Box): number {
  return Math.min(a[2], b[2]) - Math.max(a[0], b[0]);
}

function vOverlap(a: Box, b: Box): number {
  return Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
}

/** Gap between two boxes (0 when they touch or overlap). */
export function boxGap(a: Box, b: Box): number {
  const dx = Math.max(0, a[0] - b[2], b[0] - a[2]);
  const dy = Math.max(0, a[1] - b[3], b[1] - a[3]);
  return Math.hypot(dx, dy);
}

function union(a: Box, b: Box): Box {
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
}

/** Indices of `boxes` in reading order: rows top to bottom (boxes overlapping by half), then left to right. */
export function readingOrder(boxes: Box[]): number[] {
  const byTop = boxes.map((b, i) => ({ b, i })).sort((p, q) => p.b[1] - q.b[1] || p.b[0] - q.b[0]);
  const rows: { span: Box; items: { b: Box; i: number }[] }[] = [];
  for (const item of byTop) {
    const row = rows.at(-1);
    const h = item.b[3] - item.b[1];
    const fits = row && row.items.some((r) => vOverlap(r.b, item.b) >= 0.5 * Math.min(h, r.b[3] - r.b[1]));
    if (row && fits) {
      row.items.push(item);
      row.span = union(row.span, item.b);
    } else rows.push({ span: item.b, items: [item] });
  }
  return rows.flatMap((r) => r.items.sort((p, q) => p.b[0] - q.b[0]).map((x) => x.i));
}

/** The most common font size of the text, weighted by characters; 11 when there is no text. */
export function bodySize(pages: ExtractedPage[]): number {
  const weight = new Map<number, number>();
  for (const p of pages)
    for (const l of p.lines) {
      const n = cleanText(l.text).length;
      if (n === 0) continue;
      const s = Math.round(l.size * 2) / 2;
      weight.set(s, (weight.get(s) ?? 0) + n);
    }
  let best = 11;
  let bestW = 0;
  for (const [s, w] of weight)
    if (w > bestW || (w === bestW && s < best)) {
      best = s;
      bestW = w;
    }
  return best;
}

type Paragraph = { text: string; bbox: Box };
type Marker = { kind: "heading" | "label"; text: string; bbox: Box };

/** Splits the page text into headings, labels and caption paragraphs. */
function classify(
  page: ExtractedPage,
  body: number,
  opts: LayoutOptions,
): { markers: Marker[]; paragraphs: Paragraph[] } {
  const markers: Marker[] = [];
  const paragraphs: Paragraph[] = [];
  let current: (Paragraph & { block: number; size: number }) | null = null;
  const flush = () => {
    if (current) paragraphs.push({ text: current.text, bbox: current.bbox });
    current = null;
  };

  for (const line of page.lines) {
    const text = cleanText(line.text);
    if (!text) {
      flush();
      continue;
    }
    if (line.size >= body * opts.headingScale && text.length <= 120) {
      flush();
      markers.push({ kind: "heading", text, bbox: line.bbox });
      continue;
    }
    if (isLabel(text, line.bbox, page, opts)) {
      flush();
      markers.push({ kind: "label", text, bbox: line.bbox });
      continue;
    }
    const c: (Paragraph & { block: number; size: number }) | null = current;
    if (c && c.block === line.block && line.bbox[1] - c.bbox[3] < 0.8 * Math.max(line.size, c.size)) {
      c.text += ` ${text}`;
      c.bbox = union(c.bbox, line.bbox);
      c.size = Math.max(c.size, line.size);
    } else {
      flush();
      current = { text, bbox: line.bbox, block: line.block, size: line.size };
    }
  }
  flush();
  return { markers, paragraphs };
}

/** A label is a short line without sentence punctuation that sits directly above an image. */
function isLabel(text: string, bbox: Box, page: ExtractedPage, opts: LayoutOptions): boolean {
  if (text.split(" ").length > opts.maxLabelWords || /[.,:;!?]$/.test(text)) return false;
  const height = bbox[3] - bbox[1];
  return page.images.some(
    (img) => hOverlap(bbox, img.bbox) > 0 && img.bbox[1] >= bbox[3] - 1 && img.bbox[1] - bbox[3] <= height,
  );
}

/** Analyses all pages in order; headings carry over to the following pages until the next heading. */
export function analyseIdeas(pages: ExtractedPage[], options: Partial<LayoutOptions> = {}): IdeaImage[] {
  const opts = { ...DEFAULT_LAYOUT_OPTIONS, ...options };
  const body = bodySize(pages);
  const result: IdeaImage[] = [];
  let carried: Heading | undefined;

  for (const page of [...pages].sort((a, b) => a.page - b.page)) {
    const { markers, paragraphs } = classify(page, body, opts);
    markers.sort((a, b) => a.bbox[1] - b.bbox[1]);
    const order = readingOrder(page.images.map((i) => i.bbox));

    const images: IdeaImage[] = order.map((imageIndex, k) => {
      const bbox = page.images[imageIndex]!.bbox;
      let heading = carried;
      let label: string | undefined;
      for (const m of markers) {
        // A heading or label applies to the images that start below its top edge.
        if (m.bbox[1] > bbox[1]) break;
        if (m.kind === "heading") {
          heading = { text: m.text, page: page.page };
          label = undefined;
        } else label = m.text;
      }
      return { page: page.page, number: k + 1, imageIndex, bbox, heading, label, captions: [] };
    });

    // Each paragraph is the caption of at most one image: the closest, within maxCaptionGap.
    const assigned = paragraphs
      .map((p) => {
        let best: IdeaImage | undefined;
        let bestD = Infinity;
        for (const img of images) {
          const above = p.bbox[3] <= img.bbox[1] + 1 && hOverlap(p.bbox, img.bbox) > 0;
          const d = boxGap(p.bbox, img.bbox) * (above ? opts.aboveBias : 1);
          if (d < bestD) {
            best = img;
            bestD = d;
          }
        }
        return { p, best: bestD <= opts.maxCaptionGap ? best : undefined };
      })
      .sort((a, b) => a.p.bbox[1] - b.p.bbox[1]);
    for (const { p, best } of assigned) best?.captions.push(p.text);

    result.push(...images);
    const lastHeading = markers.filter((m) => m.kind === "heading").at(-1);
    if (lastHeading) carried = { text: lastHeading.text, page: page.page };
  }
  return result;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** The manifest entry for an extracted image. `file` is relative to the data folder. */
export function ideaAsset(img: IdeaImage, file: string, pdfName = "ideas.pdf"): Asset {
  const own = img.heading?.page === img.page;
  const where = [own ? img.heading?.text : undefined, img.label].filter(Boolean).map((t) => `"${t}"`);
  let source = `${pdfName} p.${img.page}`;
  if (where.length > 0) source += `, under ${where.join(" > ")}`;
  // A heading from an earlier page may or may not still apply (Google Docs has no section ends).
  if (img.heading && !own) source += `, after heading "${img.heading.text}" on p.${img.heading.page}`;
  // Tags only from text on the image's own page; a heading carried over may belong to other content.
  const tags = [own ? img.heading?.text : undefined, img.label]
    .filter((t): t is string => Boolean(t))
    .map(slug)
    .filter((t, i, all) => t && all.indexOf(t) === i);
  const asset: Asset = {
    id: ideaAssetId(img.page, img.number),
    file,
    kind: "idea",
    source,
    tags,
    page: img.page,
    bbox: img.bbox.map(round1) as Box,
  };
  if (img.captions.length > 0) asset.notes = img.captions.join("\n");
  return asset;
}
