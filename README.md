# Tattoo Planner

Plan a tattoo on a 3D body before you see the artist: place images, patterns, bands and lines on a 2D unwrap of an arm, a leg or the torso, see them live in 3D, and export a PDF handout. The output is a **sketch, not a finished design**: the artist designs the tattoo. Everything runs locally on your computer.

## Start

**Desktop app from a checkout** (Node ≥ 22.18 and npm):

```sh
git clone <this repository>
cd tattoo-planner
npm ci              # install (install scripts are disabled by .npmrc)
npm run desktop     # builds and opens the app; the first run downloads Electron (~100 MB)
```

**In the browser** (development, hot reload):

```sh
npm run dev         # http://127.0.0.1:4320, in a current Chrome, Edge or Firefox
```

**DMG (macOS):** download it from the repository's GitHub Releases (Apple Silicon: `arm64`, Intel: `x64`) and drag **Tattoo Planner** into Applications. The app is not signed yet: on the first start right-click it → **Open** → **Open** (or System Settings → Privacy & Security → **Open Anyway**). Build the DMGs yourself with `npm run dist:mac`.

On the start screen, **Open sample project** shows a ready-made, read-only project; or create your own project folder.

## What it does

- **Body regions:** left and right arm, left and right leg, torso, on a female or male sample body; your own measurements (optional, with a measuring wizard) adjust it.
- **Layout editor:** figures (reference images), existing tattoos, pattern fillers, bands and freehand lines on a 2D unwrap; drag, resize, rotate, layer, undo. The 3D view follows every change, also with the elbow bent and as a full body.
- **Blockout and reference modes**, a cm grid, and **coverage** per zone (how much skin stays open).
- **Compare** two variants side by side.
- **Existing tattoos** projected onto the body from a few photos (guided setup).
- **Image studio:** clean up a reference image with built-in operations, or redraw it with OpenAI's GPT Image using your own key.
- **Handout:** a PDF with every view, the unwrap, an element table and the open points, plus PNGs, saved into your project folder.

## Your project and privacy

A project is one folder you choose (YAML files and images: layouts, measurements, the image catalogue, exports). The planner's server listens on `127.0.0.1` only; there is no account, cloud storage or telemetry. Only a generative image edit that you start sends the image and your instruction to OpenAI, with your key. Details: [docs/privacy.md](docs/privacy.md).

## Documentation

- [docs/usage.md](docs/usage.md): feature reference (every tab, the project folder, image generation, patterns, export, layout fields, configuration files).
- [docs/development.md](docs/development.md): setup for git users (`TATTOO_DATA_DIR`, `.env`, `npm run migrate`), desktop app builds and signing, the server API, commands, code layout, UI conventions and status.
- [docs/measuring.md](docs/measuring.md): how to measure and photograph the arm (German).
- [docs/jans-sleeve.md](docs/jans-sleeve.md): Jan's own sleeve (asset ids, the Anubis projection).
- [docs/adr/](docs/adr/): technical decisions; [docs/product/roadmap.md](docs/product/roadmap.md): the product plan; `PROJECT_BRIEF.md`: the original brief; [docs/claude-decisions.md](docs/claude-decisions.md): decisions Claude made for review.

## Development in short

```sh
npm run hooks       # enable the pre-commit guard (once per clone)
npm run check       # lint, typecheck, tests and the binary guard
```

Images, PDFs and exports never go into git (`.gitignore`, the pre-commit guard `scripts/check-binaries.mjs` and CI). More in [docs/development.md](docs/development.md).
