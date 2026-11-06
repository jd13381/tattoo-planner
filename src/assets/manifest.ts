// Asset manifest (PROJECT_BRIEF.md §12.4): the catalogue that layouts reference by asset id.
// The manifest lives in the data folder (<TATTOO_DATA_DIR>/manifest.yaml), never in the repo,
// because file names and notes may be private. It holds no image data, only paths and metadata.
import { z } from "zod";

export const MANIFEST_FILE = "manifest.yaml";

/** Known kinds; other strings are allowed so Jan can invent his own. */
export const ASSET_KINDS = ["reference", "card-art", "idea", "existing", "arm-photo", "background"] as const;

/** Normalised rectangle inside an image: 0..1 from the left/top edge. */
export const rectSchema = z.strictObject({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().gt(0).max(1),
  h: z.number().gt(0).max(1),
});
export type NormRect = z.infer<typeof rectSchema>;

export const assetSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "use lowercase letters, digits and dashes"),
  /** Path relative to the data folder, forward slashes. */
  file: z.string().min(1),
  kind: z.string().min(1),
  /**
   * Section of the Assets tab (src/assets/category.ts). Optional: without it the section follows
   * from kind, folder and use. Unknown values are kept and treated as if the field were missing.
   */
  category: z.string().min(1).optional(),
  /** Person a measuring or tattoo photo belongs to (persons of a project); default the implicit one. */
  person: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]*$/)
    .optional(),
  /** Id of the original this image was edited from (kept edits, ADR 0007). */
  derived_from: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]*$/)
    .optional(),
  source: z.string().optional(),
  notes: z.string().optional(),
  tags: z.array(z.string()).default([]),
  /** Where an image extracted from ideas.pdf came from (former `npm run ingest`, ADR 0003): 1-based page and bounding box in PDF points. Kept so those entries stay valid. */
  page: z.number().int().positive().optional(),
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
  /** Default cut-out used when an element shows this asset without its own crop. */
  crop: rectSchema.optional(),
  /** Left out of the image pickers (Assets tab → Hide); the file and the entry stay. */
  hidden: z.boolean().optional(),
});
export type Asset = z.infer<typeof assetSchema>;

export const manifestSchema = z
  .strictObject({
    version: z.literal(1).default(1),
    assets: z.array(assetSchema).default([]),
  })
  .superRefine((m, ctx) => {
    const seen = new Set<string>();
    m.assets.forEach((a, i) => {
      if (seen.has(a.id))
        ctx.addIssue({ code: "custom", path: ["assets", i, "id"], message: `duplicate id ${a.id}` });
      seen.add(a.id);
    });
  });
export type Manifest = z.infer<typeof manifestSchema>;
