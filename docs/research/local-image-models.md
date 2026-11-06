# Local image models for small generative edits (research, 2026-11-06)

Question (Jan, 2026-11-06): which image models could run **on the Mac itself** instead of GPT Image (ADR 0008, ADR 0009) for smaller generative edits: replace a background, add snakes to a Medusa motif, remove an element, create a tileable background (clouds, stars)? The low end is a **MacBook Air M4, 16 GB** and a **MacBook Pro M4 (base chip), 16 GB**. If the quality is not good enough there, the feature does not ship.

Status: research and benchmark preparation only; no app code. The benchmark is in [`benchmark/local-image-models/`](../../benchmark/local-image-models/README.md). Nothing here has been run on an M4 with 16 GB yet: every number for that machine is an **estimate** until Jan's benchmark replaces it.

Legend used below: **[V]** verified from a primary source (model README, model card, official docs) · **[S]** secondary source (blog, news, aggregator) · **[E]** my estimate, derived from the figures named next to it.

## Recommendation: benchmark these three

| #   | Candidate                                                        | Why it is on the list (one line)                                                                                                                                                                                          |
| --- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **FLUX.2 [klein] 4B** (distilled), mflux `-q 8`                  | The only current instruction-edit + text-to-image model with an **Apache 2.0** licence that clearly fits 16 GB (about 8 GB of loaded weights at 8 bit, 4 steps); if anything ships, it is this.                           |
| 2   | **FLUX.2 [klein] 9B** (distilled), mflux `-q 4 --low-ram`        | Same family and runtime, visibly stronger edits; mflux measured a 7.2 GB peak for a whole 9B run at 1024² with `-q 4 --low-ram` and the small decoder; but the **FLUX Non-Commercial** licence means "user downloads it". |
| 3   | **FLUX 3 Image Klein** (5.6B, distilled), mflux `-q 4 --low-ram` | The newest open-weights editor (Oct 2026, BFL claims best open model for editing) under the FLUX Kommunity licence; peak 18.5 GB at `-q 4` on an M4 Pro, so it is the **stretch test**: does the current best fit at all? |

All three run in **one runtime, [mflux](https://github.com/filipstrand/mflux) 0.24.0** (MIT, MLX-native, Oct 27, 2026), which is also the fastest path on Apple Silicon. The benchmark script can additionally run two optional candidates: **Z-Image-Turbo** (Apache 2.0, text-to-image only, for the tileable background) and **Qwen-Image-2.1-Turbo** (strong editor, but research-only licence and unknown 16 GB peak).

What to expect **[E]**: FLUX.2 klein 4B should give a usable edit in roughly 1–2 minutes on the M4 base chip (GPT Image takes about a minute too), with less faithful "keep everything else" behaviour than GPT Image 2.5. Whether that is good enough for a tattoo sketch is exactly what the benchmark decides; my guess is "yes for background replacement and the tileable star field, borderline for adding snakes that wind convincingly around a figure".

**Product view (MIT, open source, weights on demand):** only candidate 1 (and Z-Image-Turbo for text-to-image) can be offered without licence friction: Apache 2.0 weights may be downloaded on demand, mirrored and used commercially. Candidates 2 and 3 can only be an opt-in "download it yourself" option: the user accepts the licence on Hugging Face (`hf auth login`), and the planner must say that the FLUX.2 9B licence is non-commercial and the FLUX Kommunity licence is free for commercial use only below US$5M annual revenue. Qwen-Image-2.1 (research licence) and FIBO 2 (CC BY-NC 4.0) are worse for a product.

## Comparison table

Sizes are download sizes (bf16 unless noted). "Peak" is unified memory while generating at 1024×1024 unless noted. Times on the M4 base chip are estimates from the M4 Pro / M5 numbers in the sources: the M4 base has a 10-core GPU and 120 GB/s memory bandwidth versus 20 cores and 273 GB/s on the M4 Pro, so I assume about 2–2.5× the M4 Pro time, plus throttling on the fanless Air under sustained load.

| Model                                 | Params                | Licence (commercial / redistribution / on demand)                                    | Download                                         | Peak memory                                                                            | Fits 16 GB?                         | Time / image on M4 base **[E]**                                      | Instruction edit                     | Mask inpaint          | Text-to-image | Tileable                           |
| ------------------------------------- | --------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------ | -------------------------------------------------------------------------------------- | ----------------------------------- | -------------------------------------------------------------------- | ------------------------------------ | --------------------- | ------------- | ---------------------------------- |
| **FLUX.2 klein 4B**                   | 4B + Qwen3-4B TE      | Apache 2.0 [S]: yes / yes / yes                                                      | ~15 GB [V]                                       | loaded weights 8.0 GB `-q 8`, 4.3 GB `-q 4`, 3.3 GB with small TE [V]                  | yes [E]                             | t2i 45–70 s, edit 60–120 s                                           | yes, up to 4 refs [V]                | no (prompt only)      | yes           | via seam repair (below)            |
| **FLUX.2 klein 9B**                   | 9B + Qwen3-8B TE      | FLUX Non-Commercial [S]: no / no / user download only                                | ~32 GB [V]                                       | 7.2 GB whole run `-q 4 --low-ram` + small decoder (9B-kv) [V]                          | yes [V]                             | 2–4 min                                                              | yes [V]                              | no                    | yes           | via seam repair                    |
| **FLUX 3 Image Klein**                | 5.6B + Qwen3-VL-4B TE | FLUX Kommunity v1.0 [V]: free below US$5M revenue / no / gated, user accepts licence | ~20 GB [V]                                       | 18.5 GB `-q 4`, 22.8 GB `-q 8` (M4 Pro 64 GB) [V]                                      | **doubtful**: swap or failure [E]   | 4–6 min if it fits, more with swap                                   | yes, up to 10 refs [V]               | no                    | yes, 16 steps | via seam repair                    |
| Z-Image-Turbo                         | 6B + Qwen3-4B TE      | Apache 2.0 [S]: yes / yes / yes                                                      | ~31 GB bf16, pre-quantized 4-bit repo exists [V] | 7.5 GB at `-q 8`, 1024², 9 steps [V]; **26 GB** if loaded from the Hub unquantized [V] | yes with 4-bit repo [V/E]           | 60–100 s                                                             | **no** (edit weights unreleased [S]) | no                    | yes           | via seam repair with another model |
| Qwen-Image-2.1 (Turbo)                | 7.1B + 8B TE          | Qwen Research Licence [S]: no / no / research only                                   | ~32 GB [V]                                       | 46 GB bf16; 27 GB `-q 8` ControlNet run (M5 Max) [V]; small TE option                  | unknown, probably not at `-q 8` [E] | 3–6 min                                                              | yes, up to 10 refs [V]               | `--mask-image` [V]    | yes           | via seam repair                    |
| Qwen-Image-Edit-2511                  | 20B + 7B VL TE        | Apache 2.0 [S]                                                                       | ~58 GB [V]                                       | text encoder alone ~15.5 GB, never quantized [V]; 4-bit set ~25 GB [S]                 | **no**                              | – (Qwen-Image-2.1 Q4 GGUF in ComfyUI took ~736 s on an M4 16 GB [S]) | yes                                  | no                    | (Qwen-Image)  | –                                  |
| FIBO 2 Edit Turbo                     | 8.1B + 4B TE          | CC BY-NC 4.0, gated [V]                                                              | 25.5 GB (+25.5 GB for Edit Turbo) [V]            | 18.3 GB `-q 4` [V]                                                                     | **no** [E]                          | –                                                                    | yes, 1–5 images [V]                  | yes `--mask-path` [V] | yes           | –                                  |
| FLUX.1 Kontext [dev]                  | 12B                   | FLUX Non-Commercial [S]                                                              | ~34 GB [V]                                       | not stated                                                                             | tight at `-q 4` [E]                 | 3–5 min                                                              | yes                                  | Fill model, 34 GB [V] | (FLUX.1 dev)  | –                                  |
| SDXL inpainting                       | 2.6B                  | CreativeML OpenRAIL++-M (known): yes, with use restrictions                          | ~7 GB [E]                                        | ~6–8 GB [E]                                                                            | yes                                 | 30–60 s                                                              | no (prompt + mask only)              | yes                   | yes           | yes, circular padding (UNet) [S]   |
| HiDream-E1.1 / OmniGen2 / Step1X-Edit | 17B / ~7B / ~12B+     | MIT [S] / Apache 2.0 [S] / Apache 2.0 [S]                                            | 30–60 GB [E]                                     | HiDream-E1: OOM on 24 GB GPU unquantized [S]; OmniGen2 ~17 GB VRAM [S]                 | **no**                              | –                                                                    | yes                                  | –                     | –             | –                                  |
| GPT Image 2.5 (reference)             | –                     | API, paid per image                                                                  | –                                                | –                                                                                      | –                                   | about 1 min (ADR 0008)                                               | yes                                  | yes (mask)            | yes           | prompt only                        |

## Details

### FLUX.2 [klein] 4B and 9B (Black Forest Labs, January 2026)

- One model for text-to-image and multi-reference editing; the distilled checkpoints need 4 steps at guidance 1.0 [V, mflux FLUX.2 README]. The non-distilled "base" checkpoints need ~50 steps and are "typically slower and worse for general editing" [V], so the benchmark uses the distilled ones.
- Licence: the 4B checkpoints are Apache 2.0, the 9B checkpoints FLUX Non-Commercial [S: Hugging Face model card text quoted by several sources; huggingface.co was not reachable from this session, so check the card before shipping].
- mflux commands [V]: `mflux-generate-flux2 --model flux2-klein-4b …` and `mflux-generate-flux2-edit --model flux2-klein-4b --image-paths in.png --prompt "…" --steps 4`. `--small-text-encoder` (Qwen3-0.6B + adapter, Apache 2.0) cuts the 4B's loaded weights from 8.0 to 5.4 GB at `-q 8`; `--small-decoder` cuts VAE decode memory; `--low-ram` frees the text encoder and transformer before decoding; `flux2-klein-9b-kv` is a KV-cache variant for faster edits.
- Speed [V]: 1024×1024 bf16, 4 steps, prompt encoding included: ~20 s with the small text encoder, ~27 s without, on an M4 Pro 64 GB. Community: 30–40 s at 1024 px on an M1 Max [S], ~11 s at 512×512 4-bit on an M3 Pro 18 GB [S].
- Memory [V]: whole 9B-kv run at `-q 4 --low-ram` with the small decoder peaked at 7.2 GB at 1024×1024 (10.4 GB at 2048×2048). This is the strongest evidence that the 9B fits 16 GB.
- Weaknesses: no negative prompt, no mask input (the edit is prompt-only, so "keep everything else" depends on the model) [V].

### FLUX 3 Image Klein (Black Forest Labs, 2026-10-15)

- 5.6B transformer + Qwen3-VL-4B text encoder; text-to-image and editing with up to 10 references; 16 steps distilled [V, mflux FLUX 3 README]. BFL claims first place among open models for editing in its own evaluations [S, not independently verified].
- Licence: FLUX Kommunity Licence v1.0 [V]: free commercial output for individuals and companies under US$5M revenue; the repository is gated (accept on Hugging Face, `hf auth login`).
- mflux, M4 Pro 64 GB, 1024², 16 steps [V]: peak 30.7 GB bf16, 22.8 GB `-q 8`, 20.6 GB `-q 6`, 18.5 GB `-q 4`; ~7 s per step at every quantisation ("quantization saves memory, not time"). `--low-ram` exists; no peak is published for it. On 16 GB this will swap or fail at 1024²; the benchmark runs it at 768 px with `-q 4 --low-ram` to find out. A third-party write-up says best results need a separate ~28 GB prompt upsampler [S]; the benchmark does not use one.

### Z-Image-Turbo (Tongyi-MAI, November 2025)

- 6B, Apache 2.0 [S], text-to-image only; the Edit checkpoint was still "to be released" in Aug 2026 [S]. Good candidate for the tileable background case, not for edits.
- mflux [V]: 9 steps, peak 7.5 GB at `-q 8` (1024²); loading the unquantized Hub weights peaks at about 26 GB, so use the pre-quantized repo `filipstrand/Z-Image-Turbo-mflux-4bit` on 16 GB.

### Qwen-Image family (Alibaba)

- **Qwen-Image-Edit-2509 / 2511** (20B, Apache 2.0): excellent editors, but the text encoder alone takes ~14–15.5 GB and is not quantized in mflux [V]; a community 4-bit set is ~25 GB [S]. Not viable on 16 GB.
- **Qwen-Image-2.1** (2026-09-20, 7.1B + 8B text encoder, Turbo 8 steps, editing with up to 10 references, masks, RGBA) [V mflux]: licence changed to the **Qwen Research Licence**, non-commercial [S, several sources]. Measured peaks are 46 GB bf16 and 27 GB for a `-q 8` ControlNet run [V]; a `--small-text-encoder` option exists. Optional candidate only.

### Others considered and excluded

- **FIBO 2 / Edit Turbo** (Bria, Oct 2026): masked edits, 4-step Edit Turbo, but CC BY-NC 4.0 and 18.3 GB peak at `-q 4` [V].
- **FLUX.1 Kontext [dev] / Fill**: superseded by FLUX.2 klein (mflux marks it legacy), 34 GB downloads, non-commercial [V/S].
- **HiDream-E1.1** (MIT), **OmniGen2** (Apache 2.0), **Step1X-Edit** (Apache 2.0): too large for 16 GB (OmniGen2 ~17 GB VRAM natively, HiDream-E1 runs out of memory on a 24 GB GPU unquantized) [S]; no maintained MLX port found.
- **SD 3.5 / SDXL inpainting**: fit easily and SDXL supports circular padding for tileable output, but quality and instruction following are a generation behind; a fallback if all FLUX candidates fail.
- **Krea 2, Ideogram 4, ERNIE-Image, Lens, Ming-Image, MOSS-Image, Boogu, Iris-3B** (all in mflux): text-to-image models without an instruction-edit mode in mflux [V]; Krea 2 peaks at 27+ GB [V]. Iris-3B (Apache 2.0, 4.4 GB peak at `-q 4` [V]) is an option for text-to-image only.

### Runtimes

- **mflux** (MIT, Python + MLX, `uv tool install mflux`) [V]: covers FLUX.2 klein, FLUX 3 Klein, Z-Image, Qwen-Image(-Edit), Qwen-Image-2.1, FIBO 2 and FLUX.1 Kontext/Fill with quantisation (3–8 bit), `--low-ram`, LoRAs and a scriptable CLI. Very active (0.19 → 0.24 between Aug and Oct 2026). **Chosen for the benchmark**: one install covers every candidate, and it is the runtime a planner feature would call (a Python helper started by the server).
- **Draw Things** (free macOS app, own Metal engine) [S]: supports FLUX.2 klein, Z-Image, Qwen-Image, SDXL; very memory-efficient and good for Jan to try by hand. Not used for the benchmark because it is GUI-first; a scripted run would need its HTTP API, whose current support for these models I could not verify.
- **ComfyUI on MPS** (PyTorch): supports everything via nodes (and seamless-tiling nodes), but MPS is slower than MLX and fragile: a reported ComfyUI update made a Qwen-Image-Edit run go from 80 s to 10 min on an M1 Max because of MPS bf16 [S]. Heavier to install and script.
- **stable-diffusion.cpp** (MIT, GGUF, Metal) [V README]: supports FLUX.2 klein, Qwen-Image-Edit, Z-Image, FLUX.1 Kontext; attractive for a product (single binary, no Python), but slower than MLX on Apple GPUs [E] and I found no seamless-tiling flag.
- **Core ML / DiffusionKit**: Apple's Core ML path is mature for SD/SDXL only; a community Core ML port of FLUX.2 klein 4B exists on Hugging Face but is unverified [S]. DiffusionKit (Argmax) covers SD3/FLUX.1 and looks inactive for the new models [E].

### Tileable backgrounds

Transformer models (FLUX, Qwen, Z-Image) do not tile by a padding switch the way SD/SDXL UNets do (circular convolution padding) [S]. A third-party FLUX.2 klein 4B pattern generator gets true wrap-around with "toroidal RoPE + circular VAE" [S, Replicate], which mflux does not offer. The benchmark therefore uses a model-agnostic method:

1. Generate the star field from text.
2. Shift it by half its size, which puts the wrap seams in the middle as a visible cross (the outer edges then tile by construction).
3. Ask the same model to remove the seam cross ("seam repair"), as an instruction edit.
4. Measure the seam: the script compares the pixel difference across the wrap edge with the difference between neighbouring interior columns and rows (ratio ≈ 1.0 means seamless) and writes a 2×2 tiled preview to judge by eye.

Note: the planner already draws a procedural, exactly tileable `starfield` filler; a generative star field only earns its place if it looks clearly better. Clouds are the harder and more useful case.

### Product notes (if the benchmark is good)

- A local engine would sit next to `src/edits/openai.ts` as a third engine: the server starts the mflux CLI (or a small Python helper) with the image and prompt, exactly like the OpenAI job; outputs go through the same checks and `edits/` flow.
- Weights on demand: Apache 2.0 weights can be fetched from Hugging Face on first use (~15 GB for FLUX.2 klein 4B, plus quantisation to ~5–8 GB with `mflux-save`). The disk need matters: a 256 GB MacBook Air may not have room; offer a model folder location.
- Python/MLX is a new dependency for the desktop app (uv-managed environment, installed on demand); this would need an ADR.

## Sources

Primary (read for this note):

- mflux README and model READMEs: [README](https://github.com/filipstrand/mflux), [FLUX.2](https://github.com/filipstrand/mflux/blob/main/src/mflux/models/flux2/README.md), [FLUX 3](https://github.com/filipstrand/mflux/blob/main/src/mflux/models/flux3/README.md), [Qwen](https://github.com/filipstrand/mflux/blob/main/src/mflux/models/qwen/README.md), [Qwen 2.1](https://github.com/filipstrand/mflux/blob/main/src/mflux/models/qwen21/README.md), [Z-Image](https://github.com/filipstrand/mflux/blob/main/src/mflux/models/z_image/README.md), [FIBO 2](https://github.com/filipstrand/mflux/blob/main/src/mflux/models/fibo2/README.md), [Iris](https://github.com/filipstrand/mflux/blob/main/src/mflux/models/iris/README.md), [Krea 2](https://github.com/filipstrand/mflux/blob/main/src/mflux/models/krea2/README.md), [FLUX.1](https://github.com/filipstrand/mflux/blob/main/src/mflux/models/flux/README.md), [common flags](https://github.com/filipstrand/mflux/blob/main/src/mflux/models/common/README.md)
- [mflux on PyPI](https://pypi.org/project/mflux/) (0.24.0, 2026-10-27; Python ≥ 3.11)
- [stable-diffusion.cpp README](https://github.com/leejet/stable-diffusion.cpp)
- [BFL: FLUX 3 Image Klein](https://bfl.ai/blog/flux-3-image-klein)

Secondary:

- FLUX.2 klein licences: [Vercel AI Gateway model page](https://vercel.com/ai-gateway/models/flux-2-klein-4b/about), [base 4B card mirror](https://huggingface.co/Zyx06/FLUX.2-klein-base-4B)
- FLUX.2 klein on Macs: [4-bit mflux build (M3 Pro timing)](https://huggingface.co/Runpod/FLUX.2-klein-4B-mflux-4bit), [M1 Max write-up](https://lilting.ch/en/articles/flux2-klein-4b-mflux-iris-m1-max), [Core ML port](https://huggingface.co/mlboydaisuke/FLUX.2-klein-4B-CoreAI), [seamless pattern generator](https://replicate.com/okgodoit-repos/mindprint-flux2-klein)
- FLUX 3 Klein licence: [VentureBeat](https://venturebeat.com/technology/black-forest-labs-opens-flux-3-image-klein-weights-with-free-commercial-use-limited-to-smaller-businesses), [The Decoder](https://the-decoder.com/black-forest-labs-open-weights-image-model-flux-3-image-klein-runs-on-consumer-gpus-with-just-8-gb-of-vram/), [eesel.ai](https://www.eesel.ai/blog/flux-3-klein)
- Qwen-Image-2.1 licence: [MarkTechPost](https://www.marktechpost.com/2026/09/21/alibaba-qwen-releases-qwen-image-2-1/), [efsora](https://efsora.com/insights/qwen-image-2-1-alibaba-gave-back-the-weights-and-kept-the-business-rights)
- Qwen on 16 GB Macs: [Qwen-Image 2.1 on a 16 GB Mac mini (736 s per image in ComfyUI)](https://huggingface.co/tillknuesting/qwen-image-2.1-mlx-fast), [Qwen-Image-Edit mflux 4-bit set](https://huggingface.co/fcreait/Qwen-Image-Edit-mflux), [ComfyUI MPS bf16 slowdown](https://lilting.ch/en/articles/comfyui-qwen-mps-bf16-slowdown)
- FIBO 2 licence: [Digital Applied](https://www.digitalapplied.com/blog/bria-fibo-2-image-control-commercial-licence), [ComfyUI wiki](https://comfyui-wiki.com/en/news/2026-10-20-fibo-2-0)
- Z-Image Edit status: [Local AI Master](https://localaimaster.com/blog/z-image-base-edit-guide)
- OmniGen2, HiDream-E1: [OmniGen2 card mirror](https://huggingface.co/Azily/Macro-OmniGen2/blob/main/README.md), [ComfyUI HiDream-E1 docs](https://docs.comfy.org/ja/tutorials/image/hidream/hidream-e1)
- Draw Things model support: [Bitdoze guide (es)](https://www.bitdoze.com/es/imagenes-ia-mac/)
- Seamless tiling nodes: [ComfyUI seamless tiling](https://www.runcomfy.com/comfyui-nodes/ComfyUI-seamless-tiling)

Not reachable from the cloud session (blocked hosts): huggingface.co model cards, modelfit.io, lilting.ch, jsDelivr. Licence lines marked [S] should be confirmed on the official Hugging Face cards before anything ships.
