// What a background layer can show (docs/adr/0019): the procedural patterns, the standard
// backgrounds and their catalogue (assets/backgrounds/backgrounds.yaml, images generated with
// `npm run backgrounds:generate`). Framework-free: the catalogue text is passed in.
import { parseDocument } from "yaml";
import { z } from "zod";
import { FILLER_PATTERNS } from "../patterns/index.ts";
import { isProcedural } from "./procedural.ts";

/** Folder of the standard background images in the repo (the one sanctioned image folder, CLAUDE.md). */
export const STANDARD_FOLDER = "assets/backgrounds";
export const CATALOGUE_FILE = `${STANDARD_FOLDER}/backgrounds.yaml`;
/** Asset kind of a project's own tileable backgrounds (Image studio, Background mode). */
export const BACKGROUND_KIND = "background";

export type PatternInfo = {
  name: string;
  label: string;
  /** Natural tile width in cm (tile patterns) or null (line patterns painted in place). */
  tileCm: number | null;
};

/** Tile patterns: seamless, cm-true, tileable round the limb (src/render/backgrounds/procedural.ts). */
export const TILE_PATTERNS: PatternInfo[] = [
  { name: "clouds", label: "Clouds", tileCm: 14 },
  { name: "stars", label: "Stars", tileCm: 8 },
  { name: "smoke", label: "Smoke / shading (dotwork)", tileCm: 12 },
  { name: "waves", label: "Waves", tileCm: 8 },
  { name: "geometric", label: "Geometric lattice", tileCm: 6 },
];

/** Line patterns of the former fillers (src/render/patterns), painted over the layer's rows. */
export const LINE_PATTERNS: PatternInfo[] = FILLER_PATTERNS.map((name) => ({
  name,
  label: name === "snake-scales" ? "Snake scales" : name === "hatching" ? "Hatching" : "Starfield",
  tileCm: null,
}));

export const BACKGROUND_PATTERNS: PatternInfo[] = [...TILE_PATTERNS, ...LINE_PATTERNS];

export function patternInfo(name: string): PatternInfo | undefined {
  return BACKGROUND_PATTERNS.find((p) => p.name === name);
}

/** Natural tile width of a tile pattern (10 cm for an unknown one). */
export function naturalTileCm(name: string): number {
  return patternInfo(name)?.tileCm ?? 10;
}

const entrySchema = z.strictObject({
  name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "use lowercase letters, digits and dashes"),
  label: z.string().min(1),
  /** Image file in assets/backgrounds/ (PNG or WebP); missing = not generated yet (procedural is shown). */
  file: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]*\.(png|webp)$/, "a .png or .webp file name in assets/backgrounds/")
    .optional(),
  /** Width of one tile on the skin in cm. */
  tile_cm: z.number().positive(),
  /** Procedural pattern shown while there is no image; default the pattern of the same name. */
  fallback: z.string().optional(),
  /** The fixed prompt the generator sends to GPT Image. */
  prompt: z.string().min(1),
  /** Where the image comes from and under which terms. */
  licence: z.string().optional(),
  /** Model and date of the generated image. */
  generated: z.string().optional(),
});

export const catalogueSchema = z.strictObject({
  version: z.literal(1),
  backgrounds: z.array(entrySchema),
});

export type CatalogueEntry = z.infer<typeof entrySchema>;
export type Catalogue = z.infer<typeof catalogueSchema>;

/** Licence note written for every generated image. */
export const GENERATED_LICENCE = "Generated with GPT Image (OpenAI); OpenAI's terms of use apply.";

export function parseCatalogue(
  text: string,
): { ok: true; catalogue: Catalogue } | { ok: false; error: string } {
  const doc = parseDocument(text);
  if (doc.errors.length > 0) return { ok: false, error: `YAML syntax: ${doc.errors[0]!.message}` };
  const r = catalogueSchema.safeParse(doc.toJS());
  if (!r.success)
    return {
      ok: false,
      error: r.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; "),
    };
  return { ok: true, catalogue: r.data };
}

export type StandardBackground = {
  name: string;
  label: string;
  tileCm: number;
  /** The procedural pattern shown while there is no image. */
  fallback: string;
  /** URL of the catalogue image when it exists in the build; null = the procedural version is shown. */
  imageUrl: string | null;
};

/**
 * The standard backgrounds offered in the Layers panel: every catalogue entry (with its image when
 * the build has it), then every tile pattern the catalogue does not list.
 */
export function standardBackgrounds(
  catalogue: Catalogue | null,
  imageUrls: Readonly<Record<string, string>>,
): StandardBackground[] {
  const out: StandardBackground[] = [];
  for (const e of catalogue?.backgrounds ?? [])
    out.push({
      name: e.name,
      label: e.label,
      tileCm: e.tile_cm,
      fallback: e.fallback ?? (isProcedural(e.name) ? e.name : "smoke"),
      imageUrl: e.file ? (imageUrls[e.file] ?? null) : null,
    });
  for (const p of TILE_PATTERNS)
    if (!out.some((s) => s.name === p.name))
      out.push({ name: p.name, label: p.label, tileCm: p.tileCm!, fallback: p.name, imageUrl: null });
  return out;
}
