// Reads ideas.pdf with MuPDF (mupdf.js, WebAssembly; ADR 0003): per page the text lines with their
// boxes and font sizes, the plain text, and every image with its box and encoded bytes.
// JPEG images are passed through unchanged; everything else is decoded and written as sRGB PNG.
import * as mupdf from "mupdf";
import type { Box, ExtractedPage, TextLine } from "../ideasLayout.ts";

export type ImageBytes = { ext: "png" | "jpg"; bytes: Uint8Array };

export type PdfPage = ExtractedPage & {
  text: string;
  /** Encodes image i of `images`; decoding is deferred because it is the slow part. */
  encodeImage(i: number): ImageBytes;
};

type RawImage = { width: number; height: number; obj: mupdf.PDFObject; ref: mupdf.PDFObject };

/** Image XObjects in the page resources, including those inside form XObjects. */
function pageImageObjects(page: mupdf.PDFPage): RawImage[] {
  const out: RawImage[] = [];
  const seen = new Set<string>();
  const visit = (resources: mupdf.PDFObject, depth: number) => {
    const xobjects = resources.get("XObject");
    if (!xobjects.isDictionary()) return;
    xobjects.forEach((ref) => {
      const key = ref.isIndirect() ? String(ref.asIndirect()) : "";
      if (key && seen.has(key)) return;
      if (key) seen.add(key);
      const obj = ref.resolve();
      const subtype = obj.get("Subtype").toString();
      if (subtype === "/Image")
        out.push({ width: obj.get("Width").asNumber(), height: obj.get("Height").asNumber(), obj, ref });
      else if (subtype === "/Form" && depth < 4) visit(obj.get("Resources"), depth + 1);
    });
  };
  visit(page.getObject().get("Resources"), 0);
  return out;
}

/** Raw JPEG bytes when the stream is a plain RGB or grey JPEG that any viewer shows correctly. */
function passThroughJpeg({ obj, ref }: RawImage): Uint8Array | null {
  const filter = obj.get("Filter");
  const name = filter.isArray() ? (filter.length === 1 ? filter.get(0).toString() : "") : filter.toString();
  if (name !== "/DCTDecode") return null;
  if (!obj.get("SMask").isNull() || !obj.get("Mask").isNull() || !obj.get("Decode").isNull()) return null;
  // CMYK JPEGs from PDFs are often stored inverted; decode those instead.
  const cs = obj.get("ColorSpace");
  const csName = cs.isArray() ? cs.get(0).toString() : cs.toString();
  if (csName === "/ICCBased") {
    const n = cs.get(1).resolve().get("N").asNumber();
    if (n !== 1 && n !== 3) return null;
  } else if (csName !== "/DeviceRGB" && csName !== "/DeviceGray") return null;
  // Raw streams are read through the indirect reference.
  return new Uint8Array(ref.readRawStream().asUint8Array());
}

function encodePng(image: mupdf.Image): ImageBytes {
  let pix = image.toPixmap();
  // Grey stays grey; RGB with an ICC profile, CMYK, Lab or indexed become plain sRGB.
  if (!pix.getColorSpace()?.isGray()) pix = pix.convertToColorSpace(mupdf.ColorSpace.DeviceRGB, true);
  return { ext: "png", bytes: new Uint8Array(pix.asPNG()) };
}

export function openPdf(data: Uint8Array): { pageCount: number; readPage(n: number): PdfPage } {
  const doc = mupdf.Document.openDocument(data, "application/pdf").asPDF();
  if (!doc) throw new Error("not a PDF file");
  return {
    pageCount: doc.countPages(),
    readPage(n: number): PdfPage {
      const page = doc.loadPage(n - 1) as mupdf.PDFPage;
      const stext = page.toStructuredText("preserve-images");
      const lines: TextLine[] = [];
      const images: { bbox: Box; image: mupdf.Image }[] = [];
      let block = -1;
      let line: TextLine | null = null;
      stext.walk({
        onImageBlock(bbox, _transform, image) {
          images.push({ bbox: [bbox[0], bbox[1], bbox[2], bbox[3]], image });
        },
        beginTextBlock() {
          block++;
        },
        beginLine(bbox) {
          line = { text: "", bbox: [bbox[0], bbox[1], bbox[2], bbox[3]], size: 0, block };
        },
        onChar(c, _origin, _font, size) {
          if (!line) return;
          line.text += c;
          line.size = Math.max(line.size, size);
        },
        endLine() {
          if (line) lines.push(line);
          line = null;
        },
      });

      // The structured text yields decoded images; find the XObject of the same size to see whether
      // its original stream is a JPEG that can be copied as is.
      const raw = pageImageObjects(page);
      const rawFor = images.map((img) => {
        const i = raw.findIndex(
          (r) => r.width === img.image.getWidth() && r.height === img.image.getHeight(),
        );
        return i >= 0 ? raw.splice(i, 1)[0]! : null;
      });

      return {
        page: n,
        lines,
        images: images.map(({ bbox }) => ({ bbox })),
        text: stext.asText(),
        encodeImage(i: number): ImageBytes {
          const raw = rawFor[i];
          const jpeg = raw ? passThroughJpeg(raw) : null;
          return jpeg ? { ext: "jpg", bytes: jpeg } : encodePng(images[i]!.image);
        },
      };
    },
  };
}
