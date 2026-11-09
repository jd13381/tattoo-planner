# ADR 0008: Generative image edits with GPT Image

- Status: accepted (2026-11-04)
- Context: The local edits of ADR 0007 keep the original pixels (cut, mask, retouch). Jan's tattoo artist asked for design changes to the Medusa reference (fewer snakes, the skull separate from the face and not on the upper arm), which need an image model that redraws. Claude models read images but do not generate pixels. Jan decided (2026-11-04) to buy an OpenAI API key for this and clarified that sending images to an image-edit service is fine; what must not happen is images in a git repo or the planner being reachable from outside.

## Decision

**A second engine in the "Edit images" tab (now "Image studio", ADR 0009): the OpenAI Images API with `gpt-image-2.5-sunburst`, called directly from the dev server.** The tab gets a switch _Local (Claude, keeps the pixels)_ / _Generative (GPT Image, redraws)_; everything else (jobs, before/after, Keep, Edit further, Discard, `edits/` and the manifest entry) is shared with ADR 0007.

- `POST /api/edits` takes `engine: "openai"`. The server copies the image into a temp folder as before, sends it with a short prompt (`buildGenerativePrompt` in `src/edits/openai.ts`: apply exactly this change, keep everything else, no frame/text/watermark; Jan's instruction verbatim, German is fine) as `multipart/form-data` to `POST https://api.openai.com/v1/images/edits` with `n=1`, `size=auto`, `quality=high`, `output_format=png` and `input_fidelity=high` (keeps style and features of the input closer). If the model refuses `input_fidelity`, the request is sent once more without it.
- The answer (`b64_json`) is checked like Claude's output (real PNG, at most 50 MB) and becomes the job's `output.png`. The job shows a rough cost from the reported token usage (`estimateCostUsd`; GPT Image 2.5 list prices of Nov 2026: $5 per M text input, $8 per M image input, $30 per M image output tokens).
- **Variants:** one click can start 1–3 generative jobs with the same instruction (default 2); each is its own request and its own result card, so any one of them can be kept or edited further. At most four generative jobs run at once (Claude jobs keep their own limit of two).
- **Chains mix engines:** "Edit further" can follow a generative step with a local one (e.g. fewer snakes, then remove the background) or the other way round. Each job records the tool of every step (`tools`), and a kept edit's `notes` name them: `Edited: "Weniger Schlangen" (gpt-image-2.5-sunburst), then "Remove the background" (claude -p)`.
- **Edit further starts a new round:** once the new jobs have their copy of the chosen result, the other unkept results of that original (done, failed, stopped) are discarded, so the list shows only the current round plus kept edits (`staleJobs` in `src/edits/edit.ts`).
- Two generative presets ("Simplify", "Remove an object") fill the text field and switch the engine; they describe generic edits, not design decisions.

Settings in `.env` (git-ignored): `TATTOO_OPENAI_API_KEY` (required; `OPENAI_API_KEY` from the shell works too), `TATTOO_OPENAI_MODEL` (default `gpt-image-2.5-sunburst`; `gpt-image-2.5-flare` is the faster variant), `TATTOO_OPENAI_FIDELITY` (`high` default, `low`, or `default` to leave it out), `TATTOO_OPENAI_QUALITY` (`high` default, `medium`, `low`, `auto`). The key stays in the dev server; the browser never sees it.

### Padding to the output size (2026-11-09)

GPT Image answers only in 1024×1024, 1536×1024 or 1024×1536, so with `size=auto` a photo of another shape came back stretched or cropped and no longer lay on the original (ADR 0023: a projection draws the edit over the photo's frame). Now, by default, the server pads the image to the closest of these shapes (centred, plain grey bars, transparent for an image with transparency), scales it down to that size, sends that `size` with one prompt line about the bars, and crops the bars off the answer. The edit then has the original's aspect at GPT's resolution. The maths is pure (`src/edits/pad.ts`, tests in `tests/editPad.test.ts`). The server decodes only PNG, so for a JPEG or WebP original the studio page posts a PNG copy first (`POST /api/edits/sessions/<id>/source`, at most 2048 px); without it the image goes unpadded with `size=auto`. `TATTOO_OPENAI_PAD=off` switches padding off. It relies on the model leaving the bars plain; a real run is still to be checked.

## Alternatives

- **Codex CLI (`codex exec`) with a ChatGPT subscription**, the counterpart of `claude -p`: its built-in image tool was reported to use gpt-image-1.5/2 rather than 2.5, gives no control over model, fidelity or variants, and draws on the subscription quota. Fine for trying Codex, not as the engine.
- **Google Nano Banana Pro / 2**: close second on the edit leaderboards and cheaper per image, but GPT Image 2.5 led the image-edit rankings in Oct 2026 and Jan chose it. The engine is isolated in `src/edits/openai.ts`, so a second provider can be added the same way.
- **Letting Claude call the API as a tool inside `claude -p`**: an extra agent loop (minutes, Claude quota) around what is one HTTP request; Claude adds nothing to a generative edit that the prompt does not.
- **Masks (repaint only a brushed area)**: useful for "only the skull"; left for later, the API supports a mask image.

## Consequences and limits

- The image and the instruction go to OpenAI. This replaces the earlier blanket rule "no uploading assets to third-party services" with Jan's actual constraint: nothing from the data folder in git, and the planner stays local (`127.0.0.1`).
- Costs money per edit (rough estimate shown per result; the real bill is on platform.openai.com → Usage). An edit takes about a minute.
- A generative result is a new drawing: it may change details the instruction did not mention. Compare before and after; keep only what is worth showing the artist. It is still a sketch for the conversation with the artist, not the design.
- Without a key the switch stays usable but the tab explains how to set `TATTOO_OPENAI_API_KEY`; local edits work as before.
- Cloud sessions cannot reach the API; the tests use a fake `fetch`.
