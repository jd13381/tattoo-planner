# Local image model benchmark

Checks whether local models on a 16 GB M4 Mac are good enough for the Image studio's small generative edits, compared with GPT Image. Background and candidate choice: [docs/research/local-image-models.md](../../docs/research/local-image-models.md).

The benchmark runs three cases on each candidate and writes images, timings and peak memory to a results folder **outside the repository** (default `~/tattoo-benchmark-results/<date-time>/`). Never copy results or the input image into the repo.

| Case        | Kind                         | What it asks                                                                                     |
| ----------- | ---------------------------- | ------------------------------------------------------------------------------------------------ |
| `bg-clouds` | instruction edit of an image | "Replace the background with soft drifting clouds. Keep the figure … exactly as it is."          |
| `snakes`    | instruction edit of an image | "Add two snakes winding around the figure, drawn in the same tattoo style …"                     |
| `stars`     | text-to-image + seam repair  | A seamless tileable star field; then the half-shifted image is repaired by the model (see below) |

Candidates (`uv run run_benchmark.py list`):

| Name             | Default    | Licence                     | Download  | Notes                                                                   |
| ---------------- | ---------- | --------------------------- | --------- | ----------------------------------------------------------------------- |
| `flux2-klein-4b` | yes        | Apache 2.0                  | ~15 GB    | `-q 8`, 4 steps; the one that could ship                                |
| `flux2-klein-9b` | yes        | FLUX Non-Commercial         | ~32 GB    | `-q 4 --low-ram --small-decoder`, 4 steps                               |
| `flux3-klein`    | yes        | FLUX Kommunity v1.0 (gated) | ~20 GB    | `-q 4 --low-ram`, 768 px; stretch test, may swap or fail                |
| `z-image-turbo`  | optional   | Apache 2.0                  | ~6 GB (E) | pre-quantized 4-bit, text-to-image only (only `stars` runs)             |
| `qwen21-turbo`   | optional   | Qwen Research Licence       | ~32 GB    | `-q 4`, 8 steps; memory on 16 GB unknown                                |
| `gpt-image`      | `--openai` | API, paid                   | –         | reference column, `gpt-image-2.5-sunburst` (about $0.10–0.30 per image) |

The three defaults need about **67 GB** of disk in the Hugging Face cache (`~/.cache/huggingface`). On a 256 GB Mac, point `HF_HOME` at an external drive (step 3) or run one candidate at a time and delete it afterwards (step 8).

## Steps

### 1. Prepare the Mac

- Plug in the power adapter; close other apps (browser, Electron apps): every GB counts at 16 GB.
- The MacBook Air has no fan and slows down under sustained load. The script rests 20 s between runs (`--cooldown`); keep it on a hard surface.
- macOS 14 or later, Apple Silicon.

### 2. Install the tools (pinned versions)

```sh
# uv (Python package manager), if not installed yet (any 0.11.x works): https://docs.astral.sh/uv/
curl -LsSf https://astral.sh/uv/install.sh | sh   # or: brew install uv

# mflux 0.24.0 (2026-10-27) as a uv tool, with Python 3.12 and fast Hugging Face downloads
uv tool install --python 3.12 "mflux==0.24.0" --with hf_transfer
mflux-generate-flux2 --help | head -5   # check that the commands are on PATH
```

The benchmark script itself runs with `uv run`, which installs its one dependency (Pillow 12.3.0, declared at the top of the script) into a throw-away environment. Nothing is installed into the planner's `node_modules`.

### 3. Hugging Face access (only for gated models)

FLUX 3 Image Klein is gated, and so may FLUX.2 klein 9B be. Create a free account on huggingface.co, open each model page, read and accept the licence, then log in once:

- <https://huggingface.co/black-forest-labs/FLUX.3-image-klein> (FLUX Kommunity licence; check the exact repository name on the BFL page if this link moved)
- <https://huggingface.co/black-forest-labs/FLUX.2-klein-9B> (FLUX Non-Commercial licence)

```sh
uvx --from "huggingface_hub==2.3.0" hf auth login   # paste a read token
# Optional: keep the weights on an external drive
export HF_HOME=/Volumes/External/huggingface
```

### 4. Pick the input image

Use one of your own tattoo-style reference images, e.g. the Medusa reference from your data folder: a figure on a plain or simple background works best for the two edit cases. The script reads it by path and writes a resized working copy (1024 px long side; 768 px for FLUX 3) into the results folder only.

### 5. Dry run

```sh
cd benchmark/local-image-models
uv run run_benchmark.py run --image "$TATTOO_DATA_DIR/images/medusa.png" --dry-run
```

This prints every command without running anything. Check the image path and that the results folder is outside the repo.

### 6. Run

```sh
# The three default candidates, all cases (first run downloads the weights: this takes a while)
uv run run_benchmark.py run --image "$TATTOO_DATA_DIR/images/medusa.png"

# Plus the GPT Image reference column (costs a few cents per image)
export TATTOO_OPENAI_API_KEY=sk-...        # or: set -a; source ../../.env; set +a
uv run run_benchmark.py run --image "$TATTOO_DATA_DIR/images/medusa.png" --openai

# One candidate or one case at a time
uv run run_benchmark.py run --image … --candidates flux2-klein-4b --cases snakes
uv run run_benchmark.py run --image … --candidates z-image-turbo,qwen21-turbo
```

Options: `--out DIR` (default `~/tattoo-benchmark-results`; refused inside the repo), `--seed N` (default 42; rerun with another seed to see the spread), `--cooldown S`, `--dry-run`. Edit the `CANDIDATES` table at the top of `run_benchmark.py` to try other quantisations (`-q 4/6/8`), `--small-text-encoder` or step counts.

Run the whole thing on **both** Macs (Air and Pro) if you can; the Pro's fan makes long runs faster.

### 7. Score

Open `<results>/<date-time>/results.md` (timings, peak memory, swap and seam scores are filled in), look at the images and fill in the score columns using [scoring-rubric.md](scoring-rubric.md). Copy the summary into [results-template.md](results-template.md) (a local copy, or paste it into the PR/issue; the filled-in file contains no images, so it may be committed if you like).

### 8. Clean up

```sh
uvx --from "huggingface_hub==2.3.0" hf cache ls        # what takes the space
uvx --from "huggingface_hub==2.3.0" hf cache rm model/black-forest-labs/FLUX.2-klein-9B
uv tool uninstall mflux
```

## What the script measures

For each run (`results.json`, `results.csv`, `results.md`):

- **Time (s)**: wall-clock time of the whole command, including loading and quantising the model, as the planner would experience it when it starts a model per job. A warm-up run (256 px, 1 step) per candidate keeps the download out of the timings.
- **Peak (GB)**: macOS `/usr/bin/time -l` "peak memory footprint" of the process. It includes the GPU memory MLX allocates, so compare it with the 16 GB of the machine. Above ~12 GB expect the system to swap.
- **Swap + (MB)**: growth of `vm.swapusage` during the run. A large number means the run only finished by swapping (slow, wears the SSD): treat it as "does not fit".
- **Seam x/y** (`stars` only): pixel difference across the wrap edge divided by the difference between neighbouring interior columns/rows. About 1.0 tiles without a visible seam; 2 or more is usually visible. `stars-tiled-2x2.png` shows it to the eye.
- **Cost ($)** (GPT Image only): estimate from the reported token usage, with the planner's list prices.

### Seam repair (`stars`)

Transformer models cannot be switched to wrap-around output by a padding flag, so the script uses a method that works with any model that edits: it shifts the generated star field by half its width and height (`stars-shifted.png`; the outer edges now tile by construction and the old edges form a cross in the middle) and asks the model to remove that cross (`stars-repaired.png`, scored and previewed the same way). A good result has seam scores near 1.0 **and** no visible cross. You can score images made elsewhere (e.g. in Draw Things) with `uv run run_benchmark.py seams file.png`.

## Troubleshooting

- `mflux-generate-…: not installed`: `uv tool update-shell`, open a new terminal.
- An unknown flag error: the flags are for mflux 0.24.0. Check `mflux-generate-flux2 --help` and adjust the `CANDIDATES` table.
- `401` / "gated repo": accept the licence on the model page and repeat `hf auth login`.
- The Mac freezes or the run takes many minutes with heavy swap: stop with Ctrl-C, note "does not fit", continue with the next candidate (`--candidates`).
- Each run's full output is in `<candidate>/<case>.log` next to the image.
