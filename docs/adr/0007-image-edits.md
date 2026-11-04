# ADR 0007: Editing reference images with `claude -p`

- Status: accepted (2026-11-04); the iteration flow (Keep / Edit further / Discard) is superseded by ADR 0010 (editing sessions)
- Context: Jan needs to touch up reference images (remove a background, take out text or a watermark, small changes) without leaving the planner for some web service, and suggested driving the edits with `claude -p`.

## Decision

**A new tab "Edit images" and a dev-server endpoint that runs Claude Code headless on Jan's Mac.** Jan picks a manifest image, types what should change (or starts from a preset such as "Remove background"), and the dev server:

1. copies the image into a fresh temp folder (`$TMPDIR/tattoo-edit-*/input.<ext>`); the original is never opened for writing;
2. runs `claude -p --output-format stream-json --verbose --permission-mode acceptEdits --no-session-persistence --strict-mcp-config --add-dir <cache> --allowedTools Bash Read Write Edit Glob Grep --disallowedTools WebFetch WebSearch` in that folder, with the task on stdin (`buildEditPrompt` in `src/edits/edit.ts`): write `output.png` (RGBA where the background was removed), look at the result and fix it, use only local tools (Pillow/numpy/OpenCV, ImageMagick, `rembg` for background removal, installed into a reusable virtualenv in `~/.cache/tattoo-planner/venv` if missing), never upload the image, invent no design;
3. streams Claude's remarks and the commands it runs into the job's progress log; at the end checks that `output.png` is a real PNG (signature, IHDR, at most 50 MB) and reads its size and alpha;
4. shows before and after on a checkerboard. **Keep** writes `edits/<original-id>-edit-N.png` (exclusive create, smallest free N) into the data folder and appends one manifest entry: id `<original-id>-edit-N`, kind, source and tags of the original plus the tag `edited`, `derived_from: <original-id>`, the instructions in `notes`, and the original's `crop` when the size is unchanged. **Edit further** starts a new job on the result (the prompt lists the earlier instructions). **Discard** deletes the temp folder.

Endpoints (`src/edits/server/editsApi.ts`, contract in `src/edits/types.ts`): `GET /api/edits` (availability: data folder set, `claude --version` works; and the jobs), `POST /api/edits` `{ assetId, instruction, fromJob? }`, `GET /api/edits/jobs/<id>[/input|/output]`, `POST /api/edits/jobs/<id>/keep|discard|cancel`. POSTs from another site are refused (`Sec-Fetch-Site`), the start request must be JSON. At most two edits run at once; one edit is stopped after 15 minutes. Jobs live in memory: restarting `npm run dev` forgets unkept results and removes their temp folders.

The manifest schema gains the optional field `derived_from` (id of the original). The Assets panel reloads on its own after a keep.

Settings in `.env` (all optional): `TATTOO_CLAUDE_BIN` (default `claude` on the PATH of `npm run dev`), `TATTOO_EDIT_MODEL` (passed as `--model`), `TATTOO_EDIT_CACHE` (default `~/.cache/tattoo-planner`).

## Alternatives

- **An image-generation API** (inpainting, background removal services): needs keys and money. Added later for generative edits only, see ADR 0008.
- **Fixed built-in operations in the browser** (canvas filters, a JS background-removal model): covers "mirror" and "contrast" but not "remove the background except the snake's tail" or "take out the text"; a WASM segmentation model is a large dependency for a sketch tool. Claude can choose the right tool per request and check its own result.
- **Writing the result next to the original or replacing it**: makes it hard to go back and to see which file is what; a separate `edits/` folder with `derived_from` keeps originals pristine and edits easy to find or delete.
- **`--dangerously-skip-permissions`**: not needed; `acceptEdits` plus an explicit tool list is enough for a headless run.

## Consequences and limits

- Needs Claude Code installed and logged in on the Mac where `npm run dev` runs; without it the tab explains why and stays read-only. Cloud sessions can test the endpoint with a fake runner only.
- **Claude sees the image**: it reads `input.*` and `output.png` to judge the result, so the image is sent to Anthropic like any image Jan shows Claude Code. That is the trade-off Jan chose with `claude -p`; nothing is uploaded anywhere else (no web tools, and the prompt forbids uploads).
- `Bash` is allowed without asking, so Claude can run any command as Jan's user. The prompt confines it to the temp folder and the cache folder and forbids touching the input; Claude Code itself restricts file edits to those folders. Downloading Python packages and the `rembg` model (about 170 MB, first use only) is allowed.
- An edit takes about one to five minutes and uses Jan's Claude Code quota.
- Kept edits are ordinary manifest entries: assign them in the Layout tab's Assets panel, rename or delete them in `manifest.yaml` by hand (and delete the file in `edits/`).
