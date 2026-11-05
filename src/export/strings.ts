// Every text of the artist handout in one place, so it can be translated (Jan may want German later:
// add a second object of the same type and pass it to buildHandout / writeHandoutPdf).
// The PDF uses the standard Helvetica font: stick to Latin-1 and the usual typographic marks
// (– — … ’ “ ” • ×); German umlauts and ß work. Anything else is replaced (pdfLayout.ts toPdfText).
import type { ViewName } from "../viewer/views.ts";
import type { ElementType } from "../layout/schema.ts";
import type { Category, ZoneId } from "../metrics/coverage.ts";

export type Mode = "blockout" | "reference";

export const HANDOUT_EN = {
  kicker: "Tattoo plan · sketch for the artist",
  /** Shown under the title (the layout's name) when the layout has no description. */
  subjectFallback: "A placement sketch for the tattoo artist",
  /** PDF document title. */
  docTitle: (layout: string) => `Tattoo plan “${layout}”`,
  dateLine: (date: string) => `Prepared ${date}`,
  noteTitle: "This is a sketch, not a design",
  note: [
    "These pages show the idea for the sleeve: which motifs go where, roughly how big they are, and how figures, fillers and open skin balance out. The body is a simple 3D model built from measurements; the pictures are rough reference images.",
    "Please read everything here as a starting point. Style, details, exact placement, sizes and flow are yours to design, and changes that make the tattoo work better are welcome.",
  ],
  contentsTitle: "In this package",
  contents: [
    "All four views at a glance, blockout and reference side by side",
    "Each view on its own page, with the motifs facing that side",
    "The unwrapped skin with a 1 cm grid, in both modes",
    "Notes per element, coverage per zone and what is not decided yet",
  ],
  legendTitle: "How to read the pictures",
  legendIntro:
    "Blockout shows every element as a flat shape coloured by type, to judge balance at a glance. Reference shows the same layout with rough reference images: grayscale on the forearm, procedural placeholder patterns for fillers and bands.",
  legend: {
    figure: "Figure (planned motif)",
    existing: "Existing tattoo (outlined)",
    filler: "Filler (background pattern)",
    band: "Band around the arm",
    line: "Line (brush stroke)",
    open: "Open skin",
  } satisfies Record<Category, string>,
  mode: { blockout: "Blockout", reference: "Reference" } satisfies Record<Mode, string>,
  views: {
    front: { title: "Front", side: "inner side, palm up" },
    back: { title: "Back", side: "outer side, back of the arm" },
    medial: { title: "Medial", side: "side towards the body" },
    lateral: { title: "Lateral", side: "thumb side" },
  } satisfies Record<ViewName, { title: string; side: string }>,
  overviewTitle: "All four views",
  overviewIntro:
    "Arm hanging down, palm facing forward; shoulder at the top, wrist at the bottom. All views use the same scale.",
  viewTitle: (title: string, side: string) => `${title} view – ${side}`,
  facingTitle: "Facing this side",
  facingNone: "Open skin only.",
  viewNote:
    "The 3D arm is a smooth model without hand, elbow bend or muscle detail; sizes are right, the silhouette is approximate.",
  unwrapTitle: (mode: string) => `Unwrapped skin – ${mode}`,
  unwrapIntro: [
    "The skin of the whole arm laid flat, seen from outside: shoulder at the top, wrist at the bottom, the outer centre line (back of the arm) in the middle, the thumb side on the left and the body side on the right. The inner centre line (palm side) is cut open and forms both edges.",
    "Grid: 1 cm squares, bold every 5 cm, measured on the skin; red lines mark the outer, lateral, medial and inner centre lines.",
  ],
  unwrapScale: (mmPerCm: string) => `At this print size, 1 cm of skin is ${mmPerCm} mm on paper.`,
  elementsTitle: "Elements",
  elementsIntro:
    "Every element of the layout, bottom layer first. Sizes in cm on the skin; positions from the wrist crease along the arm and around it by the centre lines.",
  elementHeaders: ["Element", "Type", "Reference", "Size", "Position", "Style", "Notes"],
  type: {
    figure: "figure",
    existing: "existing tattoo",
    filler: "filler",
    band: "band",
    line: "line",
  } satisfies Record<ElementType, string>,
  coverageTitle: "Coverage per zone",
  coverageIntro:
    "Share of each zone’s skin taken by each element type (topmost element counted). Elbow: 4 cm below to 6 cm above the elbow tip; shoulder: the top 8 cm; inner = the half around the palm-side line.",
  coverageHeaders: ["Zone", "Figures", "Existing", "Fillers", "Bands", "Lines", "Open skin"],
  zones: {
    "forearm-inner": "Forearm inner",
    "forearm-outer": "Forearm outer",
    elbow: "Elbow",
    "upper-inner": "Upper arm inner",
    "upper-outer": "Upper arm outer",
    shoulder: "Shoulder",
  } satisfies Record<ZoneId, string>,
  wholeArm: "Whole arm",
  questionsTitle: "Open questions",
  layoutPointsTitle: "Not decided in this layout yet",
  layoutPointsNone: "Nothing flagged.",
  point: {
    heightNotSet: (id: string, cm: number) => `${id}: height not set yet, drawn ${cm} cm tall as a stand-in.`,
    widthAssumed: (id: string) => `${id}: width not set and no image to take it from; the width is a guess.`,
    missingImage: (id: string, reason: string) =>
      `${id}: no reference image (${reason}); shown as a labelled box.`,
    measurements: (n: number, total: number, keys: string) =>
      `Arm model: ${n} of ${total} measurements are generic placeholders (${keys}).`,
    profile: (warning: string) => `Arm model: ${warning}.`,
  },
  cell: {
    none: "–",
    heightNotSet: "height not set",
    widthFromImage: "width from the image",
    fromPhotos: "around the arm, from the photos",
    widthAssumed: "width assumed",
    box: (h: string, w: string) => `${h} × ${w} cm`,
    region: (h: string, w: string) => `${h} cm tall, about ${w} cm wide`,
    band: (w: string, c: string) => `${w} cm wide, ${c} cm around`,
    line: (w: string, len: string) => `${w} cm wide, about ${len} cm long`,
    aboveWrist: (cm: string) => `${cm} cm above the wrist`,
    centre: (side: string, cm: string) => `${side}, centre ${cm} cm above the wrist`,
    span: (from: string, to: string, y0: string, y1: string) =>
      `from ${from} to ${to}, ${y0}–${y1} cm above the wrist`,
    around: (cm: string) => `all around the arm, ${cm} cm above the wrist`,
    path: (from: string, to: string, y0: string, y1: string) =>
      `from ${from} at ${y0} cm to ${to} at ${y1} cm above the wrist`,
    coords: (u: string, v: string) => `(u ${u}, v ${v})`,
    pattern: (name: string) => `pattern ${name}`,
    density: (d: string) => `density ${d}`,
    redAccents: "red accents",
    filter: (f: string) => `${f} reference`,
    colour: (c: string) => `${c}`,
    missing: "image missing",
  },
  sides: {
    outer: "outer line",
    lateral: "lateral line",
    inner: "inner line",
    medial: "medial line",
    between: (a: string, b: string) => `between ${a} and ${b}`,
  },
  sideShort: { outer: "outer", lateral: "lateral", inner: "inner", medial: "medial" },
  footer: (layout: string, date: string) => `Sketch, not a final design · ${layout} · ${date}`,
  page: (n: number, total: number) => `${n} / ${total}`,
};

export type HandoutText = typeof HANDOUT_EN;
