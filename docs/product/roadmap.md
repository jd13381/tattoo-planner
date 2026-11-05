# From personal planner to open-source product: roadmap

- Status: draft (2026-11-05), waiting for Jan's answers to the open questions at the end
- Context: market scan "Tattoo Planner: market scan and publishing options" (Claude Doc, 2026-11-05) found no comparable tool. Jan decided to publish the planner as an open-source project with a Mac DMG.

This document is the plan for the next steps. `PROJECT_BRIEF.md` stays the source of truth for Jan's own sleeve; this file is the source of truth for the product work. Decisions taken along the way become ADRs in `docs/adr/`.

## 1. Goal

An open-source, local-first tattoo planner that anyone can download as a Mac app or run from git. It is a showcase project for Jan's CV, so code quality, documentation and a clean public history matter as much as features.

It stays a **sketch tool, not a design tool**: it helps people plan placement, size and balance and brief their artist; the artist designs the tattoo.

### Target feature set (Jan, 2026-11-05)

| #   | Feature                                                                              | Notes                                             |
| --- | ------------------------------------------------------------------------------------ | ------------------------------------------------- |
| P1  | Open source, DMG download from the repo's GitHub Releases                            | Also runs with `npm ci && npm run dev`            |
| P2  | Bring your own key (BYOK) for image generation                                       | Optional; the app is fully usable without a key   |
| P3  | All body parts plus a full-body view mode                                            | See §4.1 for how body parts and the editor relate |
| P4  | 100% local                                                                           | Defined in §2                                     |
| P5  | Sample bodies by default (one female, one male); measuring your own body is optional | Own measurements adjust the sample body           |
| P6  | Guided projection of your own existing tattoos                                       | Replaces today's hand calibration                 |
| P7  | Every feature reviewed; complexity cut to what is needed                             | §3                                                |

## 2. Principles

- **Local-first.** No server of our own, no account, no telemetry, no remote fonts or CDNs. Projects are plain folders the user picks. The only network calls are ones the user starts: a generative image request to the provider whose key they entered, and (later, opt-in) an update check. Each upload shows what is sent and to whom. "100% local" in the README means exactly this.
- **Sketch, not design.** No feature that claims to produce a finished tattoo design.
- **Fewer, finished features** over many half-finished ones. A feature ships with docs and tests or it does not ship.
- **Same code path for git and DMG.** The desktop shell only wraps what `npm run dev` runs.
- **No personal data in the public repo.** No photos, no real measurements, no personal layouts, ever, also not in history.

## 3. Feature review (proposal)

Today's features and what happens to them in the product. "Keep" still means review the UX; "Rework" means the idea stays but the implementation changes substantially.

| Feature today                                                     | Where                                 | Proposal       | Why                                                                                              |
| ----------------------------------------------------------------- | ------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------ |
| Unwrap editor with figure, filler, band, line, existing elements  | Layout tab, `src/editor`              | Keep           | The core of the product                                                                          |
| Blockout and reference modes                                      | Layout tab, `src/render`              | Keep           | Main way to judge balance                                                                        |
| Procedural patterns (scales, hatching, starfield, meander, lotus) | `src/render/patterns`                 | Simplify       | Keep two or three generic fillers and one band; the rest are specific to Jan's sleeve            |
| Coverage metrics per zone                                         | `src/metrics`                         | Keep, smaller  | One compact panel; zones come from the body part                                                 |
| Red-line brush                                                    | Layout tab                            | Keep as "line" | Generic: a brush stroke with a chosen colour                                                     |
| Layout variants (save as) and Compare tab                         | `src/compare`                         | Merge          | Variants stay; Compare becomes a side-by-side mode inside the layout view instead of its own tab |
| 3D viewer with fixed views and elbow bend                         | Arm tab, `src/viewer`, `src/arm/bend` | Rework         | Viewer stays; poses come from the sample body's rig (§4.1)                                       |
| Parametric arm from tape measurements (loft)                      | `src/arm`                             | Rework         | Replaced by sample bodies adjusted by measurements (§4.1); the loft maths may survive for limbs  |
| Measurements panel and `docs/measuring.md`                        | Arm tab                               | Rework         | Becomes the optional "measure yourself" wizard                                                   |
| Multi-photo projection of an existing tattoo, hand-calibrated     | Projection tab, `src/projection`      | Rework         | Becomes the guided projection wizard (P6)                                                        |
| Asset browser and manifest                                        | `src/assets`                          | Simplify       | Images live inside the project folder; import by drag and drop; no hand-edited manifest          |
| ideas.pdf ingestion (`npm run ingest`, mupdf, AGPL)               | `scripts/assets.ts`                   | Cut            | Specific to Jan; mupdf's AGPL licence would force the whole product to AGPL                      |
| Image studio: local edits via `claude -p`                         | `src/edits`                           | Cut            | Needs Claude Code installed and signed in; not something end users have                          |
| Image studio: generative edit and create via OpenAI               | `src/edits/openai.ts`                 | Keep (BYOK)    | P2; one engine, sessions and version strip as built in ADR 0010                                  |
| PDF and PNG handout for the artist                                | `src/export`                          | Keep           | Strong differentiator                                                                            |
| Data folder tab and `TATTOO_DATA_DIR`                             | `src/data`                            | Rework         | Becomes "open project folder"; the env var stays for git users                                   |
| Pre-commit and CI guard against binaries                          | `.githooks`, `scripts/check-binaries` | Keep           | Even more important in a public repo                                                             |

## 4. Architecture changes

### 4.1 Bodies and body parts

The current arm is a loft of measured cross-sections. It is precise for one arm but cannot model a torso, back or full body.

Proposal:

- **Sample bodies** from an open, permissively licensed source (MakeHuman / MPFB exports are CC0), one female and one male, shipped with the app. Rigged, so poses (arm bent, arm raised) come for free.
- **Regions with their own UV islands:** left/right arm, left/right leg, torso front, back, neck. Each region has a cm-true unwrap like today's arm (ADR 0002 generalised). The unwrap editor edits one region at a time.
- **Full-body view mode** shows all regions together in 3D, read-only or with click-to-select a region. Designs that run across regions (shoulder into chest) are out of scope for v1.
- **Own measurements** (optional) adjust the sample body: circumferences and lengths drive shape keys or per-region scaling. Unmeasured values keep the sample's proportions.
- Decide in an ADR whether the loft generator survives for limbs (higher precision) or everything moves to the mesh.

### 4.2 Project format

One folder per project, chosen by the user (local disk, iCloud Drive, Seafile):

```
<project>/
├── project.yaml        name, body (female/male sample), units, schema version
├── measurements.yaml   optional, per region
├── layouts/            one YAML per variant, per region
├── existing/           existing tattoos: photos + projection calibration
├── images/             imported references and generated images
└── exports/            PDF / PNG handouts
```

Versioned schema with migrations, so old projects keep opening. Jan's current data moves into one such project.

### 4.3 Backend and desktop shell

- Move the request handlers out of the Vite plugins (`src/*/server`) into a framework-free `server/` module of plain Node HTTP handlers. The Vite plugin mounts it in dev; the desktop shell mounts it in the app.
- **Electron** as the shell (market scan: the Node backend moves over almost unchanged; bundled Chromium avoids the Safari WebGL issues). Record in an ADR.
- Build, sign and notarise in GitHub Actions on a macOS runner with electron-builder; publish the DMG to GitHub Releases, never commit it.
- **BYOK:** a settings screen; the key is stored in the macOS Keychain via Electron `safeStorage`, kept in the main process, sent only to the provider. Git users can keep `.env`. Show the cost estimate before each request.

## 5. Phases

Order matters: the feature review comes first, so no time goes into polishing what will be cut or rebuilt.

### Phase A: Agree the target (now)

- Jan answers the open questions in §7.
- This roadmap is updated and accepted; the feature review table becomes binding.
- **Done when:** every row in §3 has an agreed verdict.

### Phase B: Polish the flows that survive (this repo, Jan's project)

- Jan uses the planner for his sleeve and lists what bothers him; fix those in features marked Keep or Simplify (editor, blockout/reference, export, Image studio with OpenAI).
- Do not invest in features marked Cut or Rework.
- **Done when:** Jan is happy with the editing flow from empty layout to handout.

### Phase C: Generalise (this repo)

1. Project format and folder picker (§4.2); Jan's data becomes a project.
2. Server extraction (§4.3).
3. Sample bodies, regions, full-body view (§4.1).
4. Optional measuring wizard.
5. Guided projection wizard for existing tattoos.
6. Cuts and simplifications from §3.
7. Electron shell, BYOK in the Keychain, DMG build in CI.
8. Sample project with placeholder content (no copyrighted art), README, screenshots, privacy page.

- **Done when:** a new user on a clean Mac installs the DMG, opens the sample project, places three elements on an arm and a back, and exports a handout without reading code; and Jan's own sleeve still works as a project.

### Phase D: Public repo

- New public repository with the finished code as its first commit (fresh history: the current history contains Jan's measurements and brief).
- Jan's personal project stays in a private folder or repo, outside the public one.
- Licence file, README, CONTRIBUTING, issue templates, ADRs carried over (personal parts removed).
- Branch protection on `main`: PRs only, CI green required, squash merges, no direct pushes; Conventional Commits; tagged releases with a changelog; release builds from tags.
- **Done when:** v1.0.0 is tagged, the DMG is on GitHub Releases and the README shows how to run it from git.

## 6. Risks

- **Full body is the largest item** (mesh, rig, UV islands, per-region editor). If it threatens the timeline, ship v1 with arms and legs and add torso and back in v1.x.
- **Unsigned DMG:** without an Apple Developer account, macOS blocks the app until the user allows it in System Settings. Acceptable for a portfolio project, but it costs downloads.
- **Licences:** sample bodies, fonts, patterns and every dependency must allow redistribution under the chosen licence. No MTG card art or other copyrighted references in the sample project.

## 7. Open questions for Jan

1. Apple Developer account (99 USD per year) for a signed, notarised DMG, or unsigned with install instructions?
2. Agree to cut the `claude -p` engine and the ideas.pdf ingestion (§3)?
3. Editor per body region, with full body as a 3D view only, for v1?
4. Your own sleeve moves to the new body model; the arm may look slightly different from today's loft. OK?
5. Licence: MIT (proposal) or something else?
6. UI language: English only for v1?
7. Name: keep "Tattoo Planner", or find a more distinctive name for the public repo (checked for clashes)?
8. Start the public repo when Phase C is done (proposal), or only after more polish?
