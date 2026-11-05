// One-click export (PROJECT_BRIEF.md §14 Phase 5): renders the four views and the unwrap in
// blockout and reference mode, writes them as PNGs and builds the PDF handout, then sends every
// file to the local dev server, which stores it in <TATTOO_DATA_DIR>/exports/. Nothing is uploaded
// anywhere else and nothing is written into the repo.
import type { RegionProfile } from "../body/profile.ts";
import { isFigureLike, type ElementAspects } from "../layout/imageFit.ts";
import type { Layout } from "../layout/schema.ts";
import { classify, resolveElement, type ExistingSize } from "../layout/shapes.ts";
import { coverage } from "../metrics/coverage.ts";
import { BLOCKOUT_COLORS } from "../render/blockout.ts";
import { cpu2d, cpuCanvas, releaseCanvas } from "../render/cpuCanvas.ts";
import { missingReason, type ReferenceSources } from "../render/reference.ts";
import { renderUnwrap } from "../render/unwrapCanvas.ts";
import type { ViewName } from "../viewer/views.ts";
import { buildHandout, type HandoutFacts } from "./handout.ts";
import {
  CONTENT_TYPES,
  EXPORTS_ENDPOINT,
  localIsoDate,
  pngName,
  type ExportReservation,
  type ExportStatus,
  type WrittenFile,
} from "./names.ts";
import { writeHandoutPdf, type HandoutImages, type PdfImage } from "./pdf.ts";
import { MODES, replaceColor, VIEW_ORDER } from "./pdfLayout.ts";
import { commonCrop, cropCanvas, EXPORT_BACKGROUND, renderArmViews } from "./renderViews.ts";
import { handoutText, type HandoutText, type Mode } from "./strings.ts";
import { DEFAULT_REGION, type RegionId } from "../body/regions.ts";

/** Unwrap PNG resolution: 40 px per cm of skin (about 100 dpi at life size). */
export const UNWRAP_PX_PER_CM = 40;
/** Texture on the 3D arm for the view renders. */
export const VIEW_TEXTURE_PX_PER_CM = 30;
/** View render size before cropping to the arm (the arm ends up about 2300 px tall). */
export const VIEW_SIZE = { width: 1000, height: 2400 };
/** JPEG quality of the images inside the PDF (the PNG files stay lossless). */
const PDF_JPEG_QUALITY = 0.9;
/** Metrics resolution, as in the editor. */
const METRICS_PX_PER_CM = 6;

export type ExportInput = {
  layout: Layout;
  profile: RegionProfile;
  existing: ExistingSize;
  aspects: ElementAspects;
  sources: ReferenceSources;
  placeholderMeasurements: string[];
  measurementCount: number;
  /** The body region the layout belongs to; picks the handout's wording (default the left arm). */
  region?: RegionId;
  now?: Date;
  text?: HandoutText;
};

export type ExportProgress = { label: string; done: number; total: number };
export type ExportResult = {
  reservation: ExportReservation;
  pdf: WrittenFile;
  pngs: WrittenFile[];
  ms: number;
};

async function errorOf(r: Response): Promise<string> {
  try {
    return ((await r.json()) as { error?: string }).error ?? `HTTP ${r.status}`;
  } catch {
    return `HTTP ${r.status}`;
  }
}

export async function fetchExportStatus(): Promise<ExportStatus> {
  try {
    const r = await fetch(EXPORTS_ENDPOINT);
    if (!r.ok) return { enabled: false, reason: await errorOf(r) };
    return (await r.json()) as ExportStatus;
  } catch (e) {
    return { enabled: false, reason: `Export needs npm run dev (${String(e)}).` };
  }
}

async function reserve(layout: string, date: string): Promise<ExportReservation> {
  const r = await fetch(EXPORTS_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ layout, date }),
  });
  if (!r.ok) throw new Error(`Cannot start the export: ${await errorOf(r)}`);
  return (await r.json()) as ExportReservation;
}

async function put(rel: string, body: Blob | Uint8Array<ArrayBuffer>, type: string): Promise<WrittenFile> {
  const r = await fetch(`${EXPORTS_ENDPOINT}/${rel.split("/").map(encodeURIComponent).join("/")}`, {
    method: "PUT",
    headers: { "Content-Type": type },
    body,
  });
  if (!r.ok) throw new Error(`Cannot write ${rel}: ${await errorOf(r)}`);
  return (await r.json()) as WrittenFile;
}

function toBlob(c: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    c.toBlob((b) => (b ? resolve(b) : reject(new Error(`cannot encode ${type}`))), type, quality),
  );
}

async function pdfImage(c: HTMLCanvasElement): Promise<PdfImage> {
  const jpeg = new Uint8Array(await (await toBlob(c, "image/jpeg", PDF_JPEG_QUALITY)).arrayBuffer());
  return { jpeg, width: c.width, height: c.height };
}

/** Lets the browser paint the progress before the next heavy step. */
const breathe = () => new Promise((r) => setTimeout(r, 0));

export function handoutFacts(input: ExportInput, date: string): HandoutFacts {
  const { layout, profile, existing, aspects, sources } = input;
  const missingImages = new Map<string, string>();
  for (const el of layout.elements) {
    if (!isFigureLike(el)) continue;
    const reason = missingReason(el, sources);
    if (reason !== null) missingImages.set(el.id, reason);
  }
  return {
    layout,
    profile,
    date,
    resolved: layout.elements.map((el) =>
      resolveElement(el, profile, existing, aspects.get(el.id), sources.patches?.get(el.id)),
    ),
    coverage: coverage(
      classify(layout, profile, METRICS_PX_PER_CM, existing, 0, aspects, sources.patches),
      profile,
    ),
    missingImages,
    placeholderMeasurements: input.placeholderMeasurements,
    measurementCount: input.measurementCount,
    existing,
  };
}

export async function runExport(
  input: ExportInput,
  onProgress: (p: ExportProgress) => void,
): Promise<ExportResult> {
  const t0 = performance.now();
  const t = input.text ?? handoutText(input.region ?? DEFAULT_REGION);
  const { layout, profile } = input;
  const date = localIsoDate(input.now ?? new Date());
  // reserve, 2 textures per mode, the view renders, one file per view and unwrap per mode, PDF build and save
  const total = 1 + MODES.length * 2 + 1 + (VIEW_ORDER.length + 1) * MODES.length + 2;
  let done = 0;
  let current = "Starting";
  const step = async (label: string) => {
    current = label;
    onProgress({ label, done, total });
    await breathe();
  };
  const advance = () => done++;
  // Every canvas made here is freed at the end, also after a failure: Safari only reclaims canvas
  // memory at garbage collection, and a second attempt would otherwise start with the first one's.
  const made: HTMLCanvasElement[] = [];
  const keep = <C extends HTMLCanvasElement>(c: C): C => (made.push(c), c);

  try {
    await step("Reserving the file name");
    const reservation = await reserve(layout.name, date);
    advance();

    const viewTextures = {} as Record<Mode, HTMLCanvasElement>;
    const unwraps = {} as Record<Mode, HTMLCanvasElement>;
    for (const mode of MODES) {
      await step(`Painting the ${mode} texture`);
      const opts = { existing: input.existing, aspects: input.aspects, sources: input.sources };
      viewTextures[mode] = keep(cpuCanvas(1, 1));
      renderUnwrap(viewTextures[mode], profile, mode, layout, {
        ...opts,
        pxPerCm: VIEW_TEXTURE_PX_PER_CM,
        grid: false,
      });
      advance();
      await step(`Painting the ${mode} unwrap with cm grid`);
      const u = keep(cpuCanvas(1, 1));
      renderUnwrap(u, profile, mode, layout, { ...opts, pxPerCm: UNWRAP_PX_PER_CM, grid: true });
      // Paper white instead of the grey around the skin.
      const ctx = cpu2d(u);
      const px = ctx.getImageData(0, 0, u.width, u.height);
      replaceColor(px.data, BLOCKOUT_COLORS.outside, EXPORT_BACKGROUND);
      ctx.putImageData(px, 0, 0);
      unwraps[mode] = u;
      advance();
    }

    await step("Rendering the four views");
    const raw = renderArmViews(profile, viewTextures, VIEW_ORDER, VIEW_SIZE);
    for (const m of MODES) for (const v of VIEW_ORDER) keep(raw[m][v]);
    const crop = commonCrop(MODES.flatMap((m) => VIEW_ORDER.map((v) => raw[m][v])));
    advance();

    const pngs: WrittenFile[] = [];
    const views = {} as Record<Mode, Record<ViewName, PdfImage>>;
    const unwrap = {} as Record<Mode, PdfImage>;
    for (const mode of MODES) {
      views[mode] = {} as Record<ViewName, PdfImage>;
      for (const view of VIEW_ORDER) {
        await step(`Saving ${view} (${mode})`);
        const c = crop ? keep(cropCanvas(raw[mode][view], crop)) : raw[mode][view];
        const file = `${reservation.base}/${pngName(view, mode)}.png`;
        pngs.push(await put(file, await toBlob(c, CONTENT_TYPES.png), CONTENT_TYPES.png));
        views[mode][view] = await pdfImage(c);
        advance();
      }
      await step(`Saving the unwrap (${mode})`);
      const file = `${reservation.base}/${pngName("unwrap", mode)}.png`;
      pngs.push(await put(file, await toBlob(unwraps[mode], CONTENT_TYPES.png), CONTENT_TYPES.png));
      unwrap[mode] = await pdfImage(unwraps[mode]);
      advance();
    }

    await step("Building the PDF");
    const handout = buildHandout(handoutFacts(input, date), t);
    const images: HandoutImages = {
      views,
      unwrap,
      unwrapTopCircumference: profile.circumferenceAt(profile.length),
      unwrapMaxCircumference: profile.maxCircumference,
      unwrapMirrored: profile.mirrored,
      armLength: profile.length,
    };
    const bytes = await writeHandoutPdf(handout, images, t);
    advance();
    await step("Saving the PDF");
    const pdf = await put(`${reservation.base}.pdf`, bytes as Uint8Array<ArrayBuffer>, CONTENT_TYPES.pdf);
    advance();
    onProgress({ label: "Done", done, total });
    return { reservation, pdf, pngs, ms: performance.now() - t0 };
  } catch (e) {
    // Name the step: browser errors such as "The object is in an invalid state" say nothing on their own.
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`${current} failed: ${msg}`, { cause: e });
  } finally {
    made.forEach(releaseCanvas);
  }
}
