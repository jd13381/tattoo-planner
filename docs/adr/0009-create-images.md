# ADR 0009: Creating new images and using reference images

- Status: accepted (2026-11-04)
- Context: Jan wants to make completely new images and patterns with GPT Image 2.5 in the planner, not only edit imported ones, and to point at assets as references ("make a red triangle around it like in this reference image"). He allowed renaming and reshaping the edit tab.

## Decision

**The "Edit images" tab becomes "Image studio" with two modes, _Edit an image_ and _Create new_, sharing one job list per mode, the same Keep / Edit further / Discard flow and the same endpoint (`POST /api/edits`).** The tab id stays `images`, so `#images` links keep working.

- **References (GPT Image only, both modes):** up to four manifest assets per request (`references: [ids]`). The server copies them into the job's temp folder and sends them as extra images; the prompt names each one ("Image 2: reference `triangle-ref` (notes)") and says to use them only for what the instruction asks. In edit mode the image to edit goes first (`image[]` = input, ref-1, …). PNG, JPEG and WebP only. A request with references and engine `claude` is refused.
- **Create new:** `mode: "create"` with `name`, `size` (`1024x1024` default, `1024x1536`, `1536x1024`, `auto`) and `background` (`transparent` default, `opaque`, `auto`). Without references the request goes to `POST /v1/images/generations` (JSON); with references to `POST /v1/images/edits` with the references as the only images. The prompt (`buildCreatePrompt`) asks for one centred motif as a clean sketch on a plain background, no frame, text, watermark or skin, unless the description says otherwise.
- **Kept new images** go to `generated/<name>-N.png` (`name` slugged: lowercase, digits, dashes, ß → ss, umlauts folded, at most 40 characters; default `generated`) with a manifest entry: kind `idea`, tag `generated`, no `derived_from`, the prompt of every step with its tool and the references in `notes`. A created image edited further (locally or with GPT Image) stays a new image when kept.
- **Hidden from the studio:** arm photos and photos of existing tattoos (kind `arm-photo` or `existing`, or files in `arm-photos/` or `existing/`) are neither offered for editing nor as references (`showInStudio` in `src/edits/edit.ts`; Jan, 2026-11-04).
- **UI:** a segmented switch at the top of the tab. In create mode the left list picks references (click toggles); in edit mode it picks the image to edit and each card gets a "+ Reference" button when GPT Image is the engine. Chosen references show as chips with ×. New images show only the result (no "before").

## Alternatives

- **A separate "Create" tab:** two tabs for one flow (prompt, variants, keep), and "edit further" on a created image would have to jump tabs.
- **References only in create mode:** Jan's own example edits an existing image with a reference.
- **Keeping created images in `edits/`:** mixes edits of originals with new motifs; `generated/` keeps them apart and easy to find or delete.

## Consequences and limits

- Each reference adds image input tokens (a few cents per request). The cost shown per result still comes from the reported usage.
- References and the description go to OpenAI like any generative edit (ADR 0008).
- Everything created is a sketch for the conversation with the artist, not the design.
