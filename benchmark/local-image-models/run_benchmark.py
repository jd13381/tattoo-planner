# /// script
# requires-python = ">=3.11"
# dependencies = ["pillow==12.3.0"]
# ///
"""Benchmark local image models (mflux on Apple Silicon) against GPT Image for small edits.

Research context: docs/research/local-image-models.md. Usage: README.md next to this file.

Runs three cases on every candidate and writes images, timings and peak memory to a results
folder OUTSIDE the repository (default ~/tattoo-benchmark-results):

  1. bg-clouds  instruction edit of your image: replace the background with clouds
  2. snakes     instruction edit of your image: add two snakes winding around the figure
  3. stars      text-to-image: seamless tileable star field, then a seam check and, for models
                that can edit, a "seam repair" pass on the half-shifted image

The input image is yours (from your data folder) and is passed by path; this script never copies
it anywhere except a resized working copy inside the results folder.
"""

from __future__ import annotations

import argparse
import base64
import csv
import json
import os
import platform
import re
import shlex
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime
from pathlib import Path

from PIL import Image, ImageChops, ImageStat

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_OUT = Path.home() / "tattoo-benchmark-results"
DEFAULT_SEED = 42

# ---------------------------------------------------------------------------------------------
# Cases. The same wording goes to every engine, so the comparison is fair.
# ---------------------------------------------------------------------------------------------

CASES: dict[str, dict[str, str]] = {
    "bg-clouds": {
        "kind": "edit",
        "prompt": (
            "Replace the background with soft drifting clouds. Keep the figure, its line work, "
            "shading and style exactly as they are. No text, no frame, no watermark."
        ),
    },
    "snakes": {
        "kind": "edit",
        "prompt": (
            "Add two snakes winding around the figure, drawn in the same tattoo style, line work "
            "and shading as the figure. Keep everything else as it is. No text, no frame."
        ),
    },
    "stars": {
        "kind": "t2i",
        "prompt": (
            "Seamless tileable star field pattern for a tattoo background: small scattered stars "
            "and dots of different sizes, black ink on a plain light skin-tone background, flat "
            "even lighting, uniform density across the whole image, no horizon, no planets, "
            "no text, no border."
        ),
    },
}

SEAM_REPAIR_PROMPT = (
    "This star field has a visible straight seam cross through the middle: one vertical and one "
    "horizontal line where the pattern does not match. Remove the seams so the stars continue "
    "naturally across them. Keep the style and density. Do not change anything near the outer edges."
)

CASE_ORDER = ["bg-clouds", "snakes", "stars"]

# ---------------------------------------------------------------------------------------------
# Candidates. Edit this table to try other settings; flags are mflux 0.24.0 (see README).
# `max_side` is the long side of the working image and of the text-to-image output.
# ---------------------------------------------------------------------------------------------


@dataclass(frozen=True)
class Candidate:
    name: str
    label: str
    licence: str
    t2i: list[str] | None  # command prefix for text-to-image
    edit: list[str] | None  # command prefix for an instruction edit (takes --image-paths)
    steps: int | None
    max_side: int = 1024
    default: bool = True


CANDIDATES: dict[str, Candidate] = {
    c.name: c
    for c in [
        Candidate(
            name="flux2-klein-4b",
            label="FLUX.2 [klein] 4B, -q 8",
            licence="Apache-2.0",
            t2i=["mflux-generate-flux2", "--model", "flux2-klein-4b", "-q", "8"],
            edit=["mflux-generate-flux2-edit", "--model", "flux2-klein-4b", "-q", "8"],
            steps=4,
        ),
        Candidate(
            name="flux2-klein-9b",
            label="FLUX.2 [klein] 9B, -q 4 --low-ram --small-decoder",
            licence="FLUX Non-Commercial",
            t2i=[
                "mflux-generate-flux2",
                "--model",
                "flux2-klein-9b",
                "-q",
                "4",
                "--low-ram",
                "--small-decoder",
            ],
            edit=[
                "mflux-generate-flux2-edit",
                "--model",
                "flux2-klein-9b",
                "-q",
                "4",
                "--low-ram",
                "--small-decoder",
            ],
            steps=4,
        ),
        Candidate(
            name="flux3-klein",
            label="FLUX 3 Image Klein, -q 4 --low-ram, 768 px",
            licence="FLUX Kommunity v1.0 (gated)",
            t2i=["mflux-generate-flux3", "--model", "flux3-image-klein", "-q", "4", "--low-ram"],
            edit=[
                "mflux-generate-flux3-edit",
                "--model",
                "flux3-image-klein",
                "-q",
                "4",
                "--low-ram",
            ],
            steps=None,  # model default (16)
            max_side=768,
        ),
        Candidate(
            name="z-image-turbo",
            label="Z-Image-Turbo, pre-quantized 4-bit (text-to-image only)",
            licence="Apache-2.0",
            t2i=[
                "mflux-generate-z-image-turbo",
                "--model",
                "filipstrand/Z-Image-Turbo-mflux-4bit",
            ],
            edit=None,
            steps=9,
            default=False,
        ),
        Candidate(
            name="qwen21-turbo",
            label="Qwen-Image-2.1 Turbo, -q 4 (edit with small text encoder)",
            licence="Qwen Research Licence",
            t2i=["mflux-generate-qwen-2.1", "--model", "qwen-image-2.1-turbo", "-q", "4"],
            edit=[
                "mflux-generate-qwen-2.1-edit",
                "--model",
                "qwen-image-2.1-turbo",
                "-q",
                "4",
                "--small-text-encoder",
            ],
            steps=8,
            default=False,
        ),
    ]
}

OPENAI_NAME = "gpt-image"
OPENAI_EDITS_URL = "https://api.openai.com/v1/images/edits"
OPENAI_GENERATIONS_URL = "https://api.openai.com/v1/images/generations"
# Same default model and prices as the planner (src/edits/openai.ts, ADR 0008).
OPENAI_DEFAULT_MODEL = "gpt-image-2.5-sunburst"
USD_PER_M = {"text_in": 5.0, "image_in": 8.0, "image_out": 30.0}

# ---------------------------------------------------------------------------------------------
# Results
# ---------------------------------------------------------------------------------------------


@dataclass
class Result:
    candidate: str
    case: str
    ok: bool
    seconds: float | None = None
    peak_footprint_gb: float | None = None
    max_rss_gb: float | None = None
    swap_before_mb: float | None = None
    swap_after_mb: float | None = None
    output: str | None = None
    seam_x: float | None = None
    seam_y: float | None = None
    cost_usd: float | None = None
    command: str | None = None
    error: str | None = None
    extra: dict[str, object] = field(default_factory=dict)


def log(msg: str) -> None:
    print(f"[{datetime.now():%H:%M:%S}] {msg}", flush=True)


# ---------------------------------------------------------------------------------------------
# Machine and memory helpers (macOS)
# ---------------------------------------------------------------------------------------------


def sh(cmd: list[str]) -> str:
    try:
        return subprocess.run(cmd, capture_output=True, text=True, check=False).stdout.strip()
    except OSError:
        return ""


def machine_info() -> dict[str, str]:
    mem = sh(["sysctl", "-n", "hw.memsize"])
    mflux_line = next(
        (line for line in sh(["uv", "tool", "list"]).splitlines() if line.startswith("mflux ")),
        "mflux: not found via `uv tool list`",
    )
    return {
        "model": sh(["sysctl", "-n", "hw.model"]),
        "chip": sh(["sysctl", "-n", "machdep.cpu.brand_string"]),
        "memory_gb": f"{int(mem) / 2**30:.0f}" if mem.isdigit() else "?",
        "macos": sh(["sw_vers", "-productVersion"]),
        "python": platform.python_version(),
        "mflux": mflux_line,
        "power": sh(["pmset", "-g", "batt"]).splitlines()[0] if sh(["pmset", "-g", "batt"]) else "",
    }


def swap_used_mb() -> float | None:
    """`sysctl vm.swapusage` → used swap in MB (macOS)."""
    m = re.search(r"used = ([\d.]+)([MG])", sh(["sysctl", "-n", "vm.swapusage"]))
    if not m:
        return None
    value = float(m.group(1))
    return value * 1024 if m.group(2) == "G" else value


def parse_time_l(stderr: str) -> tuple[float | None, float | None]:
    """Peak memory footprint and max RSS (GB) from macOS `/usr/bin/time -l` output.

    The footprint includes the GPU (Metal) memory MLX allocates in unified memory, so it is the
    number to compare against the 16 GB of the machine.
    """

    def grab(label: str) -> float | None:
        m = re.search(rf"^\s*(\d+)\s+{label}\s*$", stderr, re.MULTILINE)
        return int(m.group(1)) / 2**30 if m else None

    return grab("peak memory footprint"), grab("maximum resident set size")


def run_measured(cmd: list[str], log_file: Path, dry_run: bool) -> Result:
    """Runs one command and measures wall time, peak memory and swap growth."""
    printable = shlex.join(cmd)
    if dry_run:
        print(f"    {printable}")
        return Result("", "", ok=True, command=printable)
    timer = ["/usr/bin/time", "-l"] if Path("/usr/bin/time").exists() and sys.platform == "darwin" else []
    swap_before = swap_used_mb()
    start = time.monotonic()
    try:
        proc = subprocess.run(timer + cmd, capture_output=True, text=True, check=False)
    except FileNotFoundError as err:
        return Result("", "", ok=False, command=printable, error=f"not installed: {err.filename}")
    seconds = time.monotonic() - start
    swap_after = swap_used_mb()
    log_file.write_text(f"$ {printable}\n\n--- stdout\n{proc.stdout}\n--- stderr\n{proc.stderr}\n")
    peak, rss = parse_time_l(proc.stderr)
    ok = proc.returncode == 0
    error = None
    if not ok:
        tail = [line for line in proc.stderr.strip().splitlines() if line.strip()][-3:]
        error = f"exit {proc.returncode}: " + " | ".join(tail)
    return Result(
        "",
        "",
        ok=ok,
        seconds=round(seconds, 1),
        peak_footprint_gb=round(peak, 2) if peak else None,
        max_rss_gb=round(rss, 2) if rss else None,
        swap_before_mb=swap_before,
        swap_after_mb=swap_after,
        command=printable,
        error=error,
    )


# ---------------------------------------------------------------------------------------------
# Images: working copy, seam score, tile preview
# ---------------------------------------------------------------------------------------------


def fit_size(w: int, h: int, max_side: int) -> tuple[int, int]:
    """Scales (w, h) so the long side is max_side, both sides a multiple of 16."""
    scale = max_side / max(w, h)
    return max(16, round(w * scale / 16) * 16), max(16, round(h * scale / 16) * 16)


def prepare_input(src: Path, dest: Path, max_side: int) -> tuple[int, int]:
    """Writes an RGB PNG copy (transparency flattened on white) scaled to max_side."""
    with Image.open(src) as im:
        im.load()
        if im.mode in ("RGBA", "LA", "P"):
            rgba = im.convert("RGBA")
            flat = Image.new("RGB", rgba.size, "white")
            flat.paste(rgba, mask=rgba.getchannel("A"))
            im = flat
        else:
            im = im.convert("RGB")
        w, h = fit_size(im.width, im.height, max_side)
        im.resize((w, h), Image.Resampling.LANCZOS).save(dest)
    return w, h


def seam_scores(path: Path) -> tuple[float, float]:
    """How visible the wrap-around seam is, per axis: mean difference across the wrap edge divided
    by the mean difference between neighbouring interior columns (x) or rows (y).
    About 1.0 means it tiles without a visible seam; 2 or more is usually visible."""
    with Image.open(path) as im:
        g = im.convert("L")
    w, h = g.size
    dx = ImageChops.difference(g, ImageChops.offset(g, 1, 0))  # column 0 = |p[0] - p[w-1]|
    dy = ImageChops.difference(g, ImageChops.offset(g, 0, 1))
    wrap_x = ImageStat.Stat(dx.crop((0, 0, 1, h))).mean[0]
    inner_x = ImageStat.Stat(dx.crop((1, 0, w, h))).mean[0]
    wrap_y = ImageStat.Stat(dy.crop((0, 0, w, 1))).mean[0]
    inner_y = ImageStat.Stat(dy.crop((0, 1, w, h))).mean[0]
    return round(wrap_x / max(inner_x, 0.5), 2), round(wrap_y / max(inner_y, 0.5), 2)


def shifted_half(src: Path, dest: Path) -> None:
    """Moves the wrap seams into the middle (the outer edges then tile by construction)."""
    with Image.open(src) as im:
        rgb = im.convert("RGB")
    ImageChops.offset(rgb, rgb.width // 2, rgb.height // 2).save(dest)


def tile_preview(src: Path, dest: Path) -> None:
    """2 × 2 tiling at half size, to judge seams by eye."""
    with Image.open(src) as im:
        tile = im.convert("RGB")
    tile = tile.resize((max(1, tile.width // 2), max(1, tile.height // 2)), Image.Resampling.LANCZOS)
    sheet = Image.new("RGB", (tile.width * 2, tile.height * 2))
    for x in (0, tile.width):
        for y in (0, tile.height):
            sheet.paste(tile, (x, y))
    sheet.save(dest)


# ---------------------------------------------------------------------------------------------
# mflux runs
# ---------------------------------------------------------------------------------------------


def mflux_cmd(
    c: Candidate, kind: str, prompt: str, out: Path, size: tuple[int, int], seed: int, image: Path | None = None
) -> list[str] | None:
    prefix = c.t2i if kind == "t2i" else c.edit
    if prefix is None:
        return None
    cmd = [
        *prefix,
        "--prompt",
        prompt,
        "--seed",
        str(seed),
        "--width",
        str(size[0]),
        "--height",
        str(size[1]),
        "--output",
        str(out),
    ]
    if c.steps is not None:
        cmd += ["--steps", str(c.steps)]
    if image is not None:
        cmd += ["--image-paths", str(image)]
    return cmd


def warm_up(c: Candidate, run_dir: Path, dry_run: bool) -> None:
    """One tiny image first, so the download and the first load are not in the timings."""
    prefix_kind = "t2i" if c.t2i else "edit"
    if prefix_kind == "edit":
        return  # edit-only candidates warm up on their first case
    cmd = mflux_cmd(c, "t2i", "a small black star on white", run_dir / c.name / "warmup.png", (256, 256), 1)
    assert cmd is not None
    if "--steps" in cmd:
        cmd[cmd.index("--steps") + 1] = "1"
    else:
        cmd += ["--steps", "1"]
    log(f"{c.name}: warm-up (downloads the weights on the first run)")
    res = run_measured(cmd, run_dir / c.name / "warmup.log", dry_run)
    if not res.ok:
        log(f"{c.name}: warm-up failed: {res.error}")


def run_candidate(
    c: Candidate,
    cases: list[str],
    inputs: dict[int, tuple[Path, tuple[int, int]]],
    run_dir: Path,
    seed: int,
    dry_run: bool,
    cooldown: int,
) -> list[Result]:
    results: list[Result] = []
    (run_dir / c.name).mkdir(parents=True, exist_ok=True)
    warm_up(c, run_dir, dry_run)
    for case in cases:
        spec = CASES[case]
        out = run_dir / c.name / f"{case}.png"
        if spec["kind"] == "edit":
            image, size = inputs[c.max_side]
            cmd = mflux_cmd(c, "edit", spec["prompt"], out, size, seed, image)
        else:
            cmd = mflux_cmd(c, "t2i", spec["prompt"], out, (c.max_side, c.max_side), seed)
        if cmd is None:
            log(f"{c.name}: {case} skipped (no {spec['kind']} mode)")
            results.append(Result(c.name, case, ok=False, error=f"no {spec['kind']} mode"))
            continue
        log(f"{c.name}: {case}")
        res = run_measured(cmd, run_dir / c.name / f"{case}.log", dry_run)
        res.candidate, res.case = c.name, case
        if res.ok and not dry_run:
            res.output = str(out)
        results.append(res)
        log_result(res)
        if case == "stars" and res.ok and not dry_run:
            results.extend(stars_follow_up(c, out, run_dir, seed, dry_run, res))
        if cooldown and not dry_run:
            time.sleep(cooldown)
    return results


def stars_follow_up(c: Candidate, stars: Path, run_dir: Path, seed: int, dry_run: bool, res: Result) -> list[Result]:
    """Seam score of the raw star field, tile preview, and a seam-repair edit if possible."""
    res.seam_x, res.seam_y = seam_scores(stars)
    tile_preview(stars, stars.with_name("stars-tiled-2x2.png"))
    if c.edit is None:
        return []
    shifted = stars.with_name("stars-shifted.png")
    shifted_half(stars, shifted)
    with Image.open(shifted) as im:
        size = (im.width, im.height)
    out = stars.with_name("stars-repaired.png")
    cmd = mflux_cmd(c, "edit", SEAM_REPAIR_PROMPT, out, size, seed, shifted)
    assert cmd is not None
    log(f"{c.name}: stars seam repair")
    rep = run_measured(cmd, stars.with_name("stars-repaired.log"), dry_run)
    rep.candidate, rep.case = c.name, "stars-repair"
    if rep.ok:
        rep.output = str(out)
        rep.seam_x, rep.seam_y = seam_scores(out)
        tile_preview(out, out.with_name("stars-repaired-tiled-2x2.png"))
    log_result(rep)
    return [rep]


def log_result(r: Result) -> None:
    if r.command and r.seconds is None and r.ok:
        return  # dry run
    if r.ok:
        swap = ""
        if r.swap_before_mb is not None and r.swap_after_mb is not None:
            swap = f", swap +{max(0.0, r.swap_after_mb - r.swap_before_mb):.0f} MB"
        peak = f", peak {r.peak_footprint_gb} GB" if r.peak_footprint_gb else ""
        log(f"  ok in {r.seconds} s{peak}{swap}")
    else:
        log(f"  FAILED: {r.error}")


# ---------------------------------------------------------------------------------------------
# OpenAI reference (GPT Image)
# ---------------------------------------------------------------------------------------------


def multipart(fields: dict[str, str], file_field: str, file_path: Path) -> tuple[bytes, str]:
    boundary = uuid.uuid4().hex
    parts: list[bytes] = []
    for k, v in fields.items():
        parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode())
    parts.append(
        f'--{boundary}\r\nContent-Disposition: form-data; name="{file_field}"; '
        f'filename="{file_path.name}"\r\nContent-Type: image/png\r\n\r\n'.encode()
    )
    parts.append(file_path.read_bytes())
    parts.append(f"\r\n--{boundary}--\r\n".encode())
    return b"".join(parts), f"multipart/form-data; boundary={boundary}"


def openai_request(url: str, body: bytes, content_type: str, key: str) -> dict[str, object]:
    req = urllib.request.Request(
        url, data=body, method="POST", headers={"Authorization": f"Bearer {key}", "Content-Type": content_type}
    )
    try:
        with urllib.request.urlopen(req, timeout=600) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as err:
        try:
            return json.loads(err.read())
        except ValueError:
            return {"error": {"message": f"HTTP {err.code}"}}


def openai_cost(usage: dict[str, object] | None) -> float | None:
    if not isinstance(usage, dict):
        return None
    details = usage.get("input_tokens_details") or {}
    text_in = float(details.get("text_tokens", 0)) if isinstance(details, dict) else 0.0
    image_in = float(details.get("image_tokens", 0)) if isinstance(details, dict) else 0.0
    out = float(usage.get("output_tokens", 0) or 0)
    usd = (text_in * USD_PER_M["text_in"] + image_in * USD_PER_M["image_in"] + out * USD_PER_M["image_out"]) / 1e6
    return round(usd, 3)


def openai_run(kind: str, prompt: str, out: Path, key: str, model: str, image: Path | None, dry_run: bool) -> Result:
    if dry_run:
        print(f"    POST {OPENAI_EDITS_URL if kind == 'edit' else OPENAI_GENERATIONS_URL} model={model}")
        return Result(OPENAI_NAME, "", ok=True, command=f"openai {kind}")
    start = time.monotonic()
    if kind == "edit":
        assert image is not None
        fields = {
            "model": model,
            "prompt": prompt,
            "n": "1",
            "size": "auto",
            "quality": "high",
            "output_format": "png",
            "input_fidelity": "high",
        }
        body, ctype = multipart(fields, "image", image)
        answer = openai_request(OPENAI_EDITS_URL, body, ctype, key)
        err = answer.get("error")
        if isinstance(err, dict) and "input_fidelity" in str(err.get("message", "")):
            fields.pop("input_fidelity")  # some models refuse the field (same fallback as the planner)
            body, ctype = multipart(fields, "image", image)
            answer = openai_request(OPENAI_EDITS_URL, body, ctype, key)
    else:
        payload = {
            "model": model,
            "prompt": prompt,
            "n": 1,
            "size": "1024x1024",
            "quality": "high",
            "output_format": "png",
        }
        answer = openai_request(OPENAI_GENERATIONS_URL, json.dumps(payload).encode(), "application/json", key)
    seconds = round(time.monotonic() - start, 1)
    err = answer.get("error")
    data = answer.get("data")
    if err or not isinstance(data, list) or not data or not isinstance(data[0], dict):
        msg = err.get("message") if isinstance(err, dict) else "no image in the answer"
        return Result(OPENAI_NAME, "", ok=False, seconds=seconds, error=f"OpenAI: {msg}")
    out.write_bytes(base64.b64decode(str(data[0].get("b64_json", ""))))
    usage = answer.get("usage")
    return Result(
        OPENAI_NAME,
        "",
        ok=True,
        seconds=seconds,
        output=str(out),
        cost_usd=openai_cost(usage if isinstance(usage, dict) else None),
        command=f"openai {kind} {model}",
    )


def run_openai(cases: list[str], image: Path | None, run_dir: Path, dry_run: bool) -> list[Result]:
    key = os.environ.get("TATTOO_OPENAI_API_KEY") or os.environ.get("OPENAI_API_KEY") or ""
    model = os.environ.get("TATTOO_OPENAI_MODEL", "").strip() or OPENAI_DEFAULT_MODEL
    if not key and not dry_run:
        log("gpt-image: skipped, TATTOO_OPENAI_API_KEY is not set")
        return [Result(OPENAI_NAME, c, ok=False, error="no API key") for c in cases]
    folder = run_dir / OPENAI_NAME
    folder.mkdir(parents=True, exist_ok=True)
    results: list[Result] = []
    for case in cases:
        spec = CASES[case]
        log(f"gpt-image ({model}): {case}")
        out = folder / f"{case}.png"
        r = openai_run(
            spec["kind"], spec["prompt"], out, key, model, image if spec["kind"] == "edit" else None, dry_run
        )
        r.candidate, r.case = OPENAI_NAME, case
        results.append(r)
        log_result(r)
        if case == "stars" and r.ok and not dry_run:
            r.seam_x, r.seam_y = seam_scores(out)
            tile_preview(out, folder / "stars-tiled-2x2.png")
            shifted = folder / "stars-shifted.png"
            shifted_half(out, shifted)
            log("gpt-image: stars seam repair")
            rep = openai_run("edit", SEAM_REPAIR_PROMPT, folder / "stars-repaired.png", key, model, shifted, dry_run)
            rep.candidate, rep.case = OPENAI_NAME, "stars-repair"
            if rep.ok and rep.output:
                rep.seam_x, rep.seam_y = seam_scores(Path(rep.output))
                tile_preview(Path(rep.output), folder / "stars-repaired-tiled-2x2.png")
            results.append(rep)
            log_result(rep)
    return results


# ---------------------------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------------------------


def fmt(v: object) -> str:
    return "" if v is None else str(v)


def write_reports(run_dir: Path, info: dict[str, str], results: list[Result], args: argparse.Namespace) -> None:
    (run_dir / "results.json").write_text(
        json.dumps(
            {
                "machine": info,
                "seed": args.seed,
                "cases": CASES,
                "seam_repair_prompt": SEAM_REPAIR_PROMPT,
                "results": [asdict(r) for r in results],
            },
            indent=2,
        )
    )
    cols = [
        "candidate",
        "case",
        "ok",
        "seconds",
        "peak_footprint_gb",
        "max_rss_gb",
        "swap_before_mb",
        "swap_after_mb",
        "seam_x",
        "seam_y",
        "cost_usd",
        "output",
        "error",
        "command",
    ]
    with (run_dir / "results.csv").open("w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(cols)
        for r in results:
            w.writerow([fmt(getattr(r, c)) for c in cols])
    lines = [
        f"# Benchmark run {run_dir.name}",
        "",
        f"Machine: {info.get('model')} · {info.get('chip')} · {info.get('memory_gb')} GB · "
        f"macOS {info.get('macos')} · {info.get('mflux')}",
        "",
        "Scores 1-5, see scoring-rubric.md in the repo. Fill in the empty columns.",
        "",
        "| Candidate | Case | OK | Time (s) | Peak (GB) | Swap + (MB) | Seam x/y | Cost ($) "
        "| Faithful | Prompt | Quality | Tattoo fit | Notes |",
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    for r in results:
        swap = ""
        if r.swap_before_mb is not None and r.swap_after_mb is not None:
            swap = f"{max(0.0, r.swap_after_mb - r.swap_before_mb):.0f}"
        seam = f"{r.seam_x}/{r.seam_y}" if r.seam_x is not None else ""
        note = (r.error or "").replace("|", "/")[:120]
        lines.append(
            f"| {r.candidate} | {r.case} | {'yes' if r.ok else 'no'} | {fmt(r.seconds)} | "
            f"{fmt(r.peak_footprint_gb)} | {swap} | {seam} | {fmt(r.cost_usd)} |  |  |  |  | {note} |"
        )
    (run_dir / "results.md").write_text("\n".join(lines) + "\n")


# ---------------------------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------------------------


def inside_repo(path: Path) -> bool:
    try:
        path.resolve().relative_to(REPO_ROOT)
        return True
    except ValueError:
        return False


def cmd_list(_: argparse.Namespace) -> int:
    for c in CANDIDATES.values():
        modes = "+".join(m for m, p in (("t2i", c.t2i), ("edit", c.edit)) if p)
        print(f"{c.name:16} {'default ' if c.default else 'optional'} {modes:9} {c.licence:28} {c.label}")
    print(f"{OPENAI_NAME:16} --openai  t2i+edit  API (paid)                   reference column")
    return 0


def cmd_seams(args: argparse.Namespace) -> int:
    for p in args.images:
        x, y = seam_scores(Path(p))
        print(f"{p}: seam x {x}, y {y} (about 1.0 = seamless)")
    return 0


def cmd_run(args: argparse.Namespace) -> int:
    out_root = Path(args.out).expanduser()
    if inside_repo(out_root):
        print(f"Refusing to write results inside the repository ({REPO_ROOT}). Use --out elsewhere.")
        return 2
    names = args.candidates.split(",") if args.candidates else [c.name for c in CANDIDATES.values() if c.default]
    unknown = [n for n in names if n not in CANDIDATES]
    if unknown:
        print(f"Unknown candidate(s): {', '.join(unknown)}. See `list`.")
        return 2
    cases = args.cases.split(",") if args.cases else CASE_ORDER
    if any(c not in CASES for c in cases):
        print(f"Unknown case. Cases: {', '.join(CASE_ORDER)}")
        return 2
    needs_image = any(CASES[c]["kind"] == "edit" for c in cases)
    src = Path(args.image).expanduser() if args.image else None
    if needs_image and (src is None or not src.is_file()):
        print("The edit cases need --image PATH (your own reference image, e.g. from your data folder).")
        return 2
    if src is not None and inside_repo(src):
        print("Note: the input image is inside the repository; images must never be committed.")

    run_dir = out_root / datetime.now().strftime("%Y%m%d-%H%M%S")
    run_dir.mkdir(parents=True, exist_ok=True)
    info = machine_info()
    log(f"results → {run_dir}")
    log(f"machine: {info}")

    inputs: dict[int, tuple[Path, tuple[int, int]]] = {}
    if src is not None and needs_image:
        (run_dir / "inputs").mkdir(exist_ok=True)
        for side in sorted({CANDIDATES[n].max_side for n in names} | {1024}):
            dest = run_dir / "inputs" / f"input-{side}.png"
            inputs[side] = (dest, prepare_input(src, dest, side))

    results: list[Result] = []
    for name in names:
        results.extend(run_candidate(CANDIDATES[name], cases, inputs, run_dir, args.seed, args.dry_run, args.cooldown))
        write_reports(run_dir, info, results, args)
    if args.openai:
        results.extend(run_openai(cases, inputs[1024][0] if inputs else None, run_dir, args.dry_run))
    write_reports(run_dir, info, results, args)
    log(f"done: {run_dir / 'results.md'}")
    return 0


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="command", required=True)
    sub.add_parser("list", help="show the candidates").set_defaults(func=cmd_list)
    s = sub.add_parser("seams", help="seam score of tileable images (e.g. made in Draw Things)")
    s.add_argument("images", nargs="+")
    s.set_defaults(func=cmd_seams)
    r = sub.add_parser("run", help="run the cases")
    r.add_argument("--image", help="your input image for the edit cases (PNG/JPEG/WebP)")
    r.add_argument("--candidates", help="comma-separated names (default: the three default candidates)")
    r.add_argument("--cases", help=f"comma-separated subset of {','.join(CASE_ORDER)}")
    r.add_argument("--openai", action="store_true", help="add the GPT Image reference (TATTOO_OPENAI_API_KEY)")
    r.add_argument("--out", default=str(DEFAULT_OUT), help=f"results folder (default {DEFAULT_OUT})")
    r.add_argument("--seed", type=int, default=DEFAULT_SEED)
    r.add_argument("--cooldown", type=int, default=20, help="seconds to rest between runs (fanless Air)")
    r.add_argument("--dry-run", action="store_true", help="print the commands without running them")
    r.set_defaults(func=cmd_run)
    args = p.parse_args(argv)
    if shutil.which("mflux-generate-flux2") is None and getattr(args, "command", "") == "run" and not args.dry_run:
        log("warning: mflux not found on PATH (install: see README); mflux candidates will fail")
    return int(args.func(args))


if __name__ == "__main__":
    sys.exit(main())
