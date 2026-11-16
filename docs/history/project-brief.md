# Tattoo Planner — Project Brief

> **Purpose of this document:** This is the founding document of the `tattoo-planner` repository. It summarises a long planning conversation (held in German, 2026-11-03) about a full left-arm tattoo sleeve and describes the plan for a small software tool that lets us visualise the sleeve on a 3D model of the arm. It is written for two readers: Jan (the owner) and Claude Code (the agent that will build the tool). Treat it as the single source of truth until it is split into `docs/`.
>
> **Historical note (2026-11-15):** this is the founding brief, kept as it was written when the repository was private. The tool has since grown into a general planner (`docs/product/roadmap.md`) and the repository was made public with its history; statements about a private repo or "no public deployment" describe that time. The planner itself still runs only locally.
>
> **Naming (Jan, 2026-11-03):** the project and tool are called **Tattoo Planner** and the data folder variable is **`TATTOO_DATA_DIR`**. The left-arm sleeve is the first use case; the scope may grow later.

---

## Table of contents

1. [Goals](#1-goals)
2. [Existing tattoos and constraints](#2-existing-tattoos-and-constraints)
3. [The sleeve concept](#3-the-sleeve-concept)
4. [Style strategy](#4-style-strategy)
5. [Motif catalogue](#5-motif-catalogue)
6. [Magic: The Gathering card catalogue](#6-magic-the-gathering-card-catalogue)
7. [Fillers and patterns](#7-fillers-and-patterns)
8. [Decision log](#8-decision-log)
9. [Open design questions](#9-open-design-questions)
10. [The tool: requirements](#10-the-tool-requirements)
11. [The tool: architecture](#11-the-tool-architecture)
12. [Data, storage and rights](#12-data-storage-and-rights)
13. [Data model](#13-data-model)
14. [Implementation phases](#14-implementation-phases)
15. [Conventions for Claude Code](#15-conventions-for-claude-code)
16. [Tasks for Jan](#16-tasks-for-jan)
17. [Risks and mitigations](#17-risks-and-mitigations)

---

## 1. Goals

### 1.1 The tattoo goal
Jan's **left arm** will become a **full sleeve** (wrist to shoulder). One piece already exists (Anubis on the inner forearm); a Medusa on the upper arm is decided. The remaining areas — mainly the **back (outer side) of the forearm** and the **inner upper arm** — need motifs that fit thematically, plus fillers that tie everything together.

### 1.2 The tool goal
Build a **structural sketch / 3D preview** of the sleeve so that Jan can:

- see roughly how the sleeve could look from all sides,
- judge the **balance between figures and fillers** (the primary question),
- try variants quickly and compare them,
- hand the tattoo artist a **sketch package** (PDF with views) that communicates the idea clearly **while leaving the artist creative freedom**.

The output is explicitly **a sketch, not a finished design**. The artist designs the actual tattoo.

### 1.3 Non-goals
- No photorealistic rendering of the final tattoo.
- No public deployment (rights issues, see §12).
- No replacement for the artist's own design work.

---

## 2. Existing tattoos and constraints

### 2.1 Left forearm — Anubis (existing)
- Location: **inner forearm**, roughly from the wrist up towards the middle/upper forearm.
- Composition: **half figure** (head, torso, arms) of Anubis **in profile, facing left** (from the viewer's perspective with the palm facing up). Eyes closed, serene expression. Long **flowing fabric/bandage ribbons** curl around the figure and trail down towards the wrist.
- Style: **illustrative black & grey**, built from **fine line hatching** (engraving / etching look), solid black for Anubis' skin, **lots of open skin**, **no background**.
- Consequence: the rest of the sleeve has to connect to this piece. It cannot be changed, but red elements can be added *next to* it later (see §4.3).

### 2.2 Right arm — trash polka sleeve (existing)
- Style: **black & grey trash polka** with **red** accents: a realistic owl on the forearm, abstract black geometric shapes and brush strokes on the shoulder, circuit-board lines, a short typewriter-style quote, red brush strokes running vertically.
- Consequence: the left arm should share the same **"grammar"** (realism + graphic elements + red) so both arms belong together, **without copying the right arm's specific graphic motifs** (circuits, typewriter text). The left arm tells its own story with Egyptian/Greek patterns instead.

### 2.3 Chest (planned, out of scope)
A "Satanic Goat" motif is planned for the chest. Not part of this project, but the shoulder area should not be designed in a way that blocks a later connection.

### 2.4 Hard constraints
| Constraint | Source |
|---|---|
| The **same tattoo artist** who did the Anubis does the whole sleeve. | Jan |
| **Medusa** on the upper arm is decided and will be **realistic**. | Jan |
| Medusa gets **red highlights**; red may run across the whole arm. | Jan |
| The **skull** should be **realistic**. | Jan |
| **Rhonas** (MTG card, see §6) must look **like on the card** — recognisability is the point. | Jan |
| The MTG reference should **not be obvious** to people who don't know the card. | Jan |

---

## 3. The sleeve concept

### 3.1 Theme
**Death, the underworld, guardians and snakes**, drawn from **Egyptian and Greek mythology**. Anubis and Medusa are both threshold figures between life and death: Anubis guides the dead, Medusa turns the living to stone. Snakes are the visual connector between both worlds (Medusa's hair, Egyptian cobra deities, Apep, the ouroboros).

### 3.2 Current working layout (proposal, not final)

| Zone | Content | Style | Status |
|---|---|---|---|
| Inner forearm | **Anubis** (existing) | illustrative hatching | fixed |
| Outer / back forearm | **Rhonas the Indomitable** (full figure with staff, as on the card) | hatching, slightly more depth than Anubis | strong favourite |
| Forearm edges (ulna/radius sides) | fillers only — fabric ribbons from Anubis flowing into Rhonas' robe, snake scales | hatching | proposal |
| Elbow / lower upper arm | **realistic skull** with **snake**, and a **dagger** through it (dagger could be Perseus' harpe, Chrysaor's sword, or the Whip of Erebos instead) | realistic, edges dissolving into hatching | proposal |
| Elbow point | round ornament (sun disc, wings or mandala) | graphic | proposal |
| Outer upper arm | **Medusa** | realistic, red highlights | fixed |
| Inner upper arm | candidates: **Pegasus** rising from Medusa, **Athreos** (ferryman), **Scale of Ma'at**, **Ouroboros**, **winged scarab**, **death's-head hawkmoth** | realistic | open |
| Shoulder | transition / cap — Mäander band, Pegasus wings, or open | graphic / realistic | open |
| Wrist | closing band (Mäander or lotus frieze) | graphic | proposal |
| Whole arm | 1–2 **red strokes** running wrist → shoulder, plus red accents | graphic | proposal |

### 3.3 Narrative threads
- **Medusa → Pegasus → blade:** When Perseus beheaded Medusa, Pegasus and his brother **Chrysaor** ("golden sword") sprang from her blood. The dagger can be Perseus' **harpe** (the sickle-sword that killed her) or Chrysaor's sword — then the upper arm tells one continuous story.
- **Anubis → Ma'at:** Anubis performs the **weighing of the heart** against the feather of Ma'at. A scale on the arm would link directly to the existing tattoo. Bontu (see §6) adds an MTG layer to this story via Ammit, the devourer of unworthy souls.
- **Psychopomps:** Anubis (Egyptian) and **Athreos/Charon** (Greek ferryman) are both guides of the dead — a mirrored pair across the two mythologies.
- **Snakes everywhere:** Rhonas (cobra god), Medusa's hair, the skull's snake, Apep, the ouroboros, snake-scale filler texture.

---

## 4. Style strategy

### 4.1 The problem
The existing Anubis is **illustrative hatching**; Medusa and the skull will be **realistic**. Mixing both without a plan would make the arm look like a collection of unrelated stickers.

### 4.2 The solution: a style gradient
**Illustrative at the wrist → realistic towards the shoulder.**

1. **Forearm:** Anubis and Rhonas in hatching style. Rhonas may get a little more depth and softer shading than Anubis — the first step of the transition. Rhonas keeps the card's **pose, cobra head with hood, staff with crescent blade and robe shape**; the card's gold and painted surfaces are **translated into the same hatching** as Anubis (contrast: Anubis' solid black skin vs. Rhonas' lighter, metallic-hatched head). The card's background (temple, guards, sky) is dropped — Rhonas stands free on the skin like Anubis.
2. **Elbow / lower upper arm:** the realistic skull is the **turning point** of the gradient; its edges can dissolve into hatching so it connects downwards.
3. **Upper arm:** Medusa and the inner-upper-arm piece fully realistic.

This mirrors the logic of trash polka (realism next to graphic elements), which already exists on the right arm.

### 4.3 Red as the bracket
Red is **style-neutral**: a red brush stroke looks the same over hatching and over realism, so it bridges the style break.

- **Continuous lines:** one or two red strokes from wrist to shoulder, connecting all motifs (echoing the right arm).
- **Targeted accents:** Medusa's eyes; Rhonas' glowing eye (green on the card — rendered red, it becomes an insider detail); blood on the dagger blade; red fabric ribbons.
- **Integrating Anubis without touching it:** add red elements next to it (a stroke behind it, a red ribbon continuing its fabric).

### 4.4 Fillers must respect the open look
Anubis' strength is its airy, open composition. **Dense smoke backgrounds would destroy that.** Fillers should be **sparse**, in the same hatching language on the forearm, getting denser only towards the realistic upper arm.

### 4.5 Two figures on the forearm
Two figures (Anubis inner, Rhonas outer) are normal for a sleeve — both sides are rarely seen at once. The risk is not the number but **similarity** (two animal-headed Egyptian gods, both upright). Mitigations already present: Anubis is a **half figure in profile facing left**, Rhonas a **full figure with staff, head turned the other way**. Additional rules:
- vary framing (full figure vs. half figure) ✔
- vary direction and posture ✔
- shared connective elements (fabric ribbons crossing the forearm edge)
- keep the forearm **edges free of important detail** — fillers only.

---

## 5. Motif catalogue

Status legend: **fixed** = decided · **favourite** = strong candidate · **candidate** = on the table · **parked** = discussed, currently not preferred.

### 5.1 Figures
| Motif | Mythology | Notes | Status |
|---|---|---|---|
| Anubis | Egyptian | existing, inner forearm | fixed |
| Medusa | Greek | upper arm, realistic, red highlights; could be modelled on **Hythonia the Cruel** (MTG gorgon) as a hidden MTG nod | fixed |
| Rhonas the Indomitable | MTG (Egyptian-inspired) | outer forearm; must look like the card | favourite |
| Realistic skull + snake | — | Jan's own idea; snake links to Medusa | favourite |
| Dagger (alone or through skull) | — | Jan's own idea; can become harpe / Chrysaor's sword | favourite |
| Pegasus | Greek | born from Medusa's blood — direct narrative link; vertical rearing pose fits inner upper arm; can be darkened (rising from blood/smoke, tattered or skeletal wings, high-contrast B&G) | candidate |
| Perseus' harpe | Greek | sickle-sword that killed Medusa; dagger alternative | candidate |
| Chrysaor's sword | Greek | Pegasus' brother, "golden sword"; dagger alternative | candidate |
| Athreos / Charon | Greek / MTG | ferryman of the dead, Greek counterpart to Anubis; veiled figure with crooked staff; coins (obolos) on a skull's eyes as a detail | candidate |
| Scale of Ma'at | Egyptian | heart vs. feather — Anubis' role; strongest content link to the existing tattoo | candidate |
| Ouroboros | Egyptian & Greek | originally Egyptian, adopted by the Greeks — a literal bridge between both; works as a frame/circle | candidate |
| Winged scarab (Khepri) | Egyptian | rebirth as counterweight to death motifs; symmetric, suits inner upper arm | candidate |
| Death's-head hawkmoth | — | real moth with skull pattern; memento mori without another skull | candidate |
| Apep (Apophis) | Egyptian | chaos serpent; massive realistic snake body wrapped around the forearm | parked (Rhonas took the slot) |
| Wadjet / uraeus cobra | Egyptian | real-mythology basis of Rhonas | parked |
| Eye of Horus | Egyptian | small element or pattern component | candidate (filler-sized) |
| Hourglass | — | memento mori | parked |

### 5.2 Density warning
With Anubis, Rhonas, Medusa, Pegasus, skull and dagger the arm becomes figure-heavy. If Rhonas is in, the rest should lean towards **patterns and fillers** to avoid overload. **Checking this balance is exactly what the tool is for.**

---

## 6. Magic: The Gathering card catalogue

Jan has wanted an MTG tattoo for a long time — one that **doesn't read as MTG** to outsiders. Rhonas is one of his favourite cards. The Egyptian-inspired plane **Amonkhet** and the Greek-inspired plane **Theros** fit the sleeve's theme perfectly.

Links go to Scryfall (exact-name search).

### 6.1 The favourite
- **[Rhonas the Indomitable](https://scryfall.com/search?q=%21%22Rhonas%20the%20Indomitable%22)** — cobra-headed god of strength (Amonkhet, art by Chase Stone). Based on real Egyptian cobra deities (Wadjet, Renenutet), so outsiders read it as an Egyptian god. Tall, narrow figure with a strong vertical staff line → outer forearm.
  - **Invocations version:** [Rhonas, Amonkhet Invocations #28](https://scryfall.com/card/mp2/28) (art by Jack Wang). Premium foil with a special Egyptian-styled frame — its ornamentation could inspire band/frieze fillers. *(Link built from set code + collector number; fall back to the [all-prints search](https://scryfall.com/search?q=%21%22Rhonas%20the%20Indomitable%22&unique=prints) if it fails.)*

### 6.2 Egyptian (Amonkhet block)
| Card | Why it fits |
|---|---|
| [Hazoret the Fervent](https://scryfall.com/search?q=%21%22Hazoret%20the%20Fervent%22) | jackal-headed — the MTG counterpart of Anubis. Redundant next to the existing Anubis, but a nice thought: the Anubis is already "half MTG". |
| [God-Eternal Rhonas](https://scryfall.com/search?q=%21%22God-Eternal%20Rhonas%22) | undead Rhonas: after the Scorpion God killed him he was coated in lazotep and raised as an Eternal. Fits the death theme maybe better than the original. Variant idea: a lazotep skeleton with cobra skull (all that remained of him in the end). |
| [Hapatra, Vizier of Poisons](https://scryfall.com/search?q=%21%22Hapatra%2C%20Vizier%20of%20Poisons%22) | Rhonas' vizier, master of poisons, bonded to snakes — companion figure to Rhonas. |
| [The Scarab God](https://scryfall.com/search?q=%21%22The%20Scarab%20God%22) | corrupted god with an azure scarab carapace as head; links to the scarab idea. |
| [The Scorpion God](https://scryfall.com/search?q=%21%22The%20Scorpion%20God%22) | dark, insectoid; his role was to kill the other gods (including Rhonas). |
| [The Locust God](https://scryfall.com/search?q=%21%22The%20Locust%20God%22) | dark, insectoid. |
| [Bontu the Glorified](https://scryfall.com/search?q=%21%22Bontu%20the%20Glorified%22) | crocodile-headed; possibly also inspired by Ammit, who devoured unworthy souls after the weighing of the heart → pairs with the Ma'at idea. |
| [Kefnet the Mindful](https://scryfall.com/search?q=%21%22Kefnet%20the%20Mindful%22) | ibis-headed (Thoth). Less dark. |
| [Oketra the True](https://scryfall.com/search?q=%21%22Oketra%20the%20True%22) | cat-headed (Bastet). Less dark. |

### 6.3 Greek (Theros block)
| Card | Why it fits |
|---|---|
| [Hythonia the Cruel](https://scryfall.com/search?q=%21%22Hythonia%20the%20Cruel%22) | legendary **gorgon** with deathtouch (art by Chris Rahn). **Recommended:** let the planned Medusa be inspired by Hythonia → the upper arm becomes a hidden MTG nod too. Trivia: originally not meant to be legendary; it became legendary because the art was loved. |
| [Athreos, God of Passage](https://scryfall.com/search?q=%21%22Athreos%2C%20God%20of%20Passage%22) / [Athreos, Shroud-Veiled](https://scryfall.com/search?q=%21%22Athreos%2C%20Shroud-Veiled%22) | ferries the dead into Erebos' underworld — the Greek answer to Anubis. Veiled figure with crooked staff; narrow and vertical like Rhonas. |
| [Erebos, God of the Dead](https://scryfall.com/search?q=%21%22Erebos%2C%20God%20of%20the%20Dead%22) / [Erebos, Bleak-Hearted](https://scryfall.com/search?q=%21%22Erebos%2C%20Bleak-Hearted%22) | ruler of death and the underworld. |
| [Pharika, God of Affliction](https://scryfall.com/search?q=%21%22Pharika%2C%20God%20of%20Affliction%22) | goddess of poison and medicine with snake-loving priests — Greek snake link to Rhonas. |
| [Polukranos, Unchained](https://scryfall.com/search?q=%21%22Polukranos%2C%20Unchained%22) | black-green hydra; many snake heads fill large areas well. |

### 6.4 Objects (dagger slot)
| Card | Why it fits |
|---|---|
| [Whip of Erebos](https://scryfall.com/search?q=%21%22Whip%20of%20Erebos%22) | legendary enchantment artifact — the death god's weapon; can wind around the skull instead of / in addition to the snake. |

### 6.5 Recommended MTG combination
Rhonas (or God-Eternal Rhonas) on the outer forearm, Medusa modelled on Hythonia on the upper arm, Athreos as ferryman on the inner upper arm; snake scales and red strokes fill the gaps. Outsiders see an arm about death and the underworld; insiders see three Magic cards.

### 6.6 Note on artwork
The artist should **redraw** card figures in the sleeve's style rather than copy paintings 1:1 — artistically better for the composition and fairer to the original illustrators. Card art is used in this project **only as private reference** (see §12).

---

## 7. Fillers and patterns

| Filler | Use | Notes |
|---|---|---|
| **Snake-scale texture** | gaps between figures | most important filler — visually merges Rhonas, Medusa and the skull's snake into one body |
| **Fabric ribbons** | forearm edges | continue Anubis' ribbons into Rhonas' robe — connects both forearm sides |
| **Red strokes** | wrist → shoulder | the bracket across all styles (§4.3) |
| **Mäander (Greek key)** | bands at wrist / elbow / shoulder | Greek side |
| **Lotus / papyrus friezes** | bands | Egyptian side |
| **Hieroglyph bands** | bands | Egyptian side; avoid copying the right arm's typewriter text |
| **Cartouche** | small element | Egyptian name ring — room for a hidden message (e.g. Jan's name in hieroglyphs) |
| **Starfield** | background accents | subtle MTG nod (Theros' gods live in the starry realm Nyx) and fits the Egyptian sky goddess Nut |
| **Obelisk / column fragments** | structure | lore link: the Scorpion God was impaled on an obelisk |
| **Wings / sun disc / mandala** | elbow point | elbow is hard to tattoo; a round ornament solves it cleanly |
| **Smoke (B&G)** | upper arm only | keep sparse on the forearm (§4.4) |
| **Single blue accent** | optional | lazotep is Amonkhet's lapis lazuli — strong insider hint if any colour beyond red is allowed |

---

## 8. Decision log

| # | Decision | Rationale |
|---|---|---|
| D1 | Left arm becomes a full sleeve, themed on Egyptian + Greek mythology. | Builds on Anubis + Medusa. |
| D2 | Medusa on the upper arm, realistic, with red highlights. | Jan's decision. |
| D3 | Same artist for the whole sleeve. | Consistency with Anubis. |
| D4 | Style gradient: illustrative hatching at the wrist → realism at the shoulder. | Reconciles existing Anubis with realistic Medusa/skull. |
| D5 | Red runs across the whole arm as the connecting element. | Style-neutral bridge; links to the right arm's trash polka. |
| D6 | Rhonas must look like on the card (pose, head, staff, robe); style translated to hatching, background dropped. | Recognisability vs. sleeve cohesion. |
| D7 | Left arm shares the right arm's grammar (realism + graphic + red) but not its motifs (no circuits/typewriter text). | Two arms that belong together but tell different stories. |
| D8 | Fillers stay sparse on the forearm. | Preserve the open look of Anubis. |
| D9 | Build a custom 3D preview tool (Three.js web viewer, "Way 4"). | Best fit for checking figure/filler balance; Jan is comfortable with code and has time. Alternatives considered below. |
| D10 | Code on GitHub (private), all images/data on Seafile. | Rights issues with Instagram/Pinterest screenshots, card art, personal photos; same pattern as Jan's Job Radar project. |
| D11 | The arm is generated **parametrically from Jan's measurements**. | Correct proportions + clean UV unwrap (avoids decal distortion). |
| D12 | All repository documentation in **English**. | Jan's rule. |

### 8.1 Visualisation approaches considered (for D9)
1. **Flat 2D arm template** (Figma/Photopea/paper) — fast, but the wrap-around has to be imagined.
2. **Procreate on iPad** — supports 3D models since v5.2; arm models for sleeve design exist. Good for drawing by hand, needs iPad + manual work.
3. **Blender** — powerful (arm models with tattoo PSD templates exist) but steep learning curve; overkill for a sketch.
4. **Custom Three.js web viewer** ✅ — chosen. Editable 2D unwrap mapped live onto a 3D arm, blockout + reference modes, versioned in Git, PDF export.

---

## 9. Open design questions

1. Inner upper arm: Pegasus, Athreos, Scale of Ma'at, Ouroboros, scarab or moth?
2. Rhonas or God-Eternal Rhonas?
3. Medusa modelled on Hythonia — yes/no?
4. Dagger type: generic dagger, harpe, Chrysaor's sword, or Whip of Erebos?
5. Exact position of the skull (elbow crease vs. lower outer upper arm vs. back of the elbow).
6. Shoulder treatment and transition towards the planned chest piece.
7. Amount and path of red strokes.
8. Any colour other than black, grey and red (e.g. a single lazotep blue accent)?
9. How dense may fillers become on the upper arm?

The tool should make it cheap to try answers to all of these.

---

## 10. The tool: requirements

### 10.1 Functional
- **F1 – Parametric arm:** generate a 3D left arm (wrist to shoulder, optionally hand stub and shoulder cap) from Jan's measurements (§13.1).
- **F2 – Orbit viewer:** rotate/zoom freely; **four fixed views**: front (palm up / inner), back (outer), medial (inner side towards body), lateral (outer side); plus elbow-bent view if feasible.
- **F3 – Unwrap editor:** a 2D canvas representing the arm's skin surface (UV unwrap with clearly marked seam, ideally on the inner-arm line where it disturbs least). Elements are placed, moved, scaled, rotated, layered on this canvas and appear **live on the 3D arm**.
- **F4 – Element types:**
  - *figure* (e.g. Rhonas), *filler* (e.g. scales), *band* (e.g. Mäander ring around the arm), *line* (e.g. red stroke, a polyline/brush path), *existing* (Anubis — locked).
- **F5 – Blockout mode:** each element rendered as a flat coloured shape by type (figures dark grey, fillers light grey, bands hatched/mid grey, red lines red, existing tattoo outlined). Shows **balance** at a glance.
- **F6 – Reference mode:** elements rendered with their reference image (with transparency/masking; optional grayscale + hatching-like filter for the forearm), red as overlay.
- **F7 – Coverage metrics:** % of skin covered by figures / fillers / open skin, per zone (forearm inner/outer, elbow, upper arm inner/outer, shoulder). This quantifies "balance".
- **F8 – Variants:** layouts stored as YAML in the repo; switching between variants in the UI; Git history = design history.
- **F9 – Existing tattoo:** Anubis placed from a photo (and measured position), locked against edits.
- **F10 – Export:** PNGs of all fixed views + the unwrap, and a **PDF handout** for the artist (views, unwrap, legend, short notes per element, "this is a sketch — creative freedom welcome" note). The export must work with images from Seafile and must **never be written into the repo**.
- **F11 – Ideas PDF ingestion:** split `ideas.pdf` (on Seafile) into individual images + extracted text notes, catalogued in a manifest (§12.3).

### 10.2 Non-functional
- Runs **locally** only (dev server); no hosting.
- Fast iteration: hot reload; layout edits via UI **and** via YAML.
- Deterministic: same YAML + same measurements + same assets → same output.
- Works on Jan's machine (OS to be confirmed in Phase 1).
- Reasonable code quality: TypeScript, linting, a few tests for geometry/UV maths and YAML schema validation.

---

## 11. The tool: architecture

### 11.1 Stack
- **Preferred:** Vite + TypeScript + **Three.js**, UI either plain TS + a small UI lib or React + **React Three Fiber / drei**.
- **Rule:** check the stack of Jan's existing Claude Code projects (Job Radar, Is it cool, Porcellano). If one fits (e.g. React + Vite + TS), reuse its conventions (tooling, lint config, folder layout, Seafile integration). Otherwise choose what does the job best. Record the choice in an ADR (`docs/adr/0001-stack.md`).
- YAML parsing + schema validation (e.g. `yaml` + `zod`).
- PDF export: browser-side (e.g. `jspdf`) or a small Node script using a headless browser — decide in Phase 5.
- PDF ingestion: a small script (Node or Python, e.g. `pdfimages`/PyMuPDF) — decide in Phase 4.

### 11.2 Arm geometry approach
- The arm is modelled as a **loft of cross-sections** (ellipses or superellipses, optionally slightly flattened on the inner side) along a **centre curve** from wrist to shoulder, with a flexible elbow region.
- Cross-sections are defined at the measured landmarks (§13.1) and smoothly interpolated (e.g. Catmull-Rom / monotone spline for radii).
- **UV mapping:** U = angle around the arm (0…1, seam on the inner line), V = arc length along the arm (0…1), scaled so that **1 unit in UV ≈ the same number of cm in both directions** at a reference circumference → minimal distortion. Store a cm-per-UV mapping so the editor can show real-world sizes (e.g. "Rhonas: 22 cm tall").
- Optional later: replace with a **photogrammetry scan** of Jan's arm (smartphone scan app) if the parametric arm looks too abstract — the editor stays UV-based.

### 11.3 Rendering
- The unwrap canvas (2D, e.g. an offscreen canvas at 4096×2048) is used as the **arm's texture**; re-rendered whenever the layout changes.
- Skin base colour neutral; optional subtle ambient-occlusion lighting for shape readability.
- Blockout vs. reference mode = two render passes of the same layout.

### 11.4 Suggested repository layout
```
tattoo-planner/
├── PROJECT_BRIEF.md          # this file (later: split into docs/)
├── CLAUDE.md                 # agent rules (see §15)
├── README.md                 # setup + usage
├── .env.example              # TATTOO_DATA_DIR=...
├── .gitignore                # .env, exports/, any image formats, node_modules
├── docs/
│   ├── concept.md            # §3–§7 split out
│   ├── decisions.md          # §8
│   ├── mtg-cards.md          # §6
│   └── adr/
├── config/
│   ├── measurements.yaml     # §13.1 (numbers only — no photos)
│   └── layouts/
│       ├── v1-baseline.yaml  # §13.2
│       └── ...
├── src/
│   ├── arm/                  # parametric geometry + UV
│   ├── editor/               # 2D unwrap editor
│   ├── viewer/               # 3D scene, fixed views
│   ├── render/               # blockout + reference renderers
│   ├── metrics/              # coverage calculation
│   ├── export/               # PNG + PDF
│   └── data/                 # asset resolution via TATTOO_DATA_DIR, schemas
├── scripts/
│   └── ingest-ideas-pdf.*    # split ideas.pdf into images + notes
└── tests/
```

---

## 12. Data, storage and rights

### 12.1 Why the split
Reference images come from **Instagram and Pinterest screenshots**; there is **MTG card art** and there are **photos of Jan's own arm and tattoos**. None of this may be published or pushed to GitHub. Therefore:

- **GitHub (private repo):** code, docs, YAML configs (measurements as numbers, layouts referencing asset IDs/paths), manifests **without** image content.
- **Seafile:** every image, the ideas PDF, extracted images, exports (PNG/PDF).

This is the same pattern as Jan's **Job Radar** project (data on Seafile, code on GitHub). **Phase 1 should inspect Job Radar's implementation and reuse it** (env variable name, path resolution, `.gitignore` rules).

### 12.2 Seafile location
- Jan created the Seafile data folder under **`Your Secure Cloud/Protected Jan`** (exact local mount path depends on the OS and the Seafile/SeaDrive client — **to be resolved in Phase 1**).
- The repo reads it via **`TATTOO_DATA_DIR`** in a git-ignored `.env`.
- `ideas.pdf` is **already in that folder**.

### 12.3 Suggested folder structure on Seafile
```
<TATTOO_DATA_DIR>/
├── ideas.pdf                 # Jan's collected ideas (exists)
├── ideas/                    # generated: images + notes extracted from ideas.pdf
│   ├── page-03-img-01.png
│   └── ...
├── refs/                     # Instagram / Pinterest screenshots (source in filename or sidecar .txt)
├── cards/                    # MTG card art (Rhonas, Hythonia, Athreos, ...)
├── existing/                 # photos of existing tattoos (Anubis, right arm)
├── arm-photos/               # Jan's left arm from 4 sides with tape measure
├── manifest.yaml             # asset catalogue (could also live in the repo if it contains no image data — decide in Phase 1)
└── exports/                  # generated PNG/PDF handouts
```

### 12.4 Asset manifest (proposal)
```yaml
assets:
  - id: rhonas-card
    file: cards/rhonas-the-indomitable.jpg
    kind: card-art
    source: "Scryfall / Wizards of the Coast, art by Chase Stone"
    tags: [rhonas, figure, egyptian, mtg]
  - id: ideas-p03-01
    file: ideas/page-03-img-01.png
    kind: reference
    source: "ideas.pdf p.3 (original source: Pinterest, unknown)"
    notes: "text found next to the image on that page"
    tags: []
```
Asset IDs are what layouts reference. Whether the manifest lives in the repo or on Seafile is decided in Phase 1 (it contains no image data, but file names/notes may be sensitive).

### 12.5 Rules
- Never commit images, PDFs or exports. Enforce via `.gitignore` **and** a pre-commit check (reject `*.png|*.jpg|*.jpeg|*.webp|*.heic|*.pdf` outside an explicit allow-list such as UI icons).
- No public deployment. If sharing is ever needed, it is done via the exported PDF on Seafile.

---

## 13. Data model

### 13.1 `config/measurements.yaml` (Jan fills in the numbers)
All values in **cm**, left arm, relaxed and straight, measured at the listed landmarks.

```yaml
arm: left
units: cm
lengths:
  shoulder_to_elbow: null      # acromion (shoulder point) to elbow tip
  elbow_to_wrist: null         # elbow tip to wrist crease
circumferences:
  wrist: null
  forearm_mid: null
  forearm_max: null            # thickest point just below the elbow
  elbow: null
  above_elbow: null
  biceps_mid: null             # relaxed
  armpit_level: null
  shoulder: null               # around the deltoid, as far as measurable
existing:
  anubis:
    distance_from_wrist: null  # wrist crease to the lowest point of the tattoo
    height: null
    width: null
    side: inner
notes: ""
```

### 13.2 `config/layouts/<variant>.yaml` (proposal)
```yaml
name: v1-baseline
description: "Rhonas outer forearm, skull at elbow, Medusa upper arm, Pegasus inner upper arm"
elements:
  - id: anubis
    type: existing
    asset: anubis-photo
    locked: true
    position: { u: 0.50, v: 0.12 }   # u = around (0.5 = inner centre line), v = along (0 = wrist)
    size_cm: { h: null, w: null }

  - id: rhonas
    type: figure
    asset: rhonas-card
    position: { u: 0.00, v: 0.18 }   # outer centre line
    size_cm: { h: 22 }
    rotation_deg: 0
    style: hatching

  - id: skull
    type: figure
    asset: skull-ref-01
    position: { u: 0.85, v: 0.50 }
    size_cm: { h: 12 }
    style: realistic

  - id: medusa
    type: figure
    asset: medusa-ref-01
    position: { u: 0.10, v: 0.72 }
    size_cm: { h: 18 }
    style: realistic
    red_accents: true

  - id: scales-forearm
    type: filler
    pattern: snake-scales
    region: { u: [0.25, 0.35], v: [0.05, 0.45] }
    density: 0.3

  - id: wrist-band
    type: band
    pattern: meander
    v: 0.02
    width_cm: 2

  - id: red-stroke-1
    type: line
    color: red
    points: [ {u: 0.05, v: 0.0}, {u: 0.15, v: 0.4}, {u: 0.10, v: 1.0} ]
    width_cm: 1.5
```
The schema is a proposal; Claude Code should refine it (zod schema + validation errors shown in the UI).

---

## 14. Implementation phases

Each phase ends with a working state, a commit, and an update of `README.md`.

### Phase 0 — Bootstrap (Jan + Claude Code, first session)
- Put this file into the repo, create `CLAUDE.md` from §15.
- Confirm OS, Node version, local Seafile mount path.
- **Acceptance:** repo pushed, `.env.example`, `.gitignore`, `CLAUDE.md` in place.

### Phase 1 — Stack check & scaffold
- Inspect Jan's existing projects (Job Radar first, for the Seafile pattern; Is it cool / Porcellano for frontend conventions) — Jan provides paths or repo names.
- Decide stack (ADR 0001), scaffold Vite + TS (+ React/R3F if chosen), lint/format/test tooling.
- Implement `TATTOO_DATA_DIR` resolution + a sanity page listing assets found on Seafile.
- Add pre-commit image guard.
- **Acceptance:** `npm run dev` shows a page listing Seafile assets; committing an image is rejected.

### Phase 2 — Parametric arm + viewer
- Geometry from `measurements.yaml` (use placeholder defaults until Jan's numbers arrive, clearly flagged in the UI).
- UV unwrap with cm scale; a debug checker texture (cm grid) to verify low distortion.
- Orbit controls + four fixed views + screenshot button.
- **Acceptance:** arm with a cm grid that looks evenly spaced in all four views; changing a measurement updates the arm.

### Phase 3 — Unwrap editor + blockout mode
- 2D editor (pan/zoom), element CRUD, drag/scale/rotate, layer order, lock.
- Load/save layout YAML; schema validation.
- Blockout renderer; live mapping onto the 3D arm.
- Coverage metrics per zone (F7).
- **Acceptance:** `v1-baseline.yaml` (§13.2) renders as blockout on the 3D arm; metrics panel shows figure/filler/open-skin %.

### Phase 4 — Assets, ideas PDF, reference mode
- Ingestion script: split `ideas.pdf` into individual images (+ page text) into `<TATTOO_DATA_DIR>/ideas/`, write/update the manifest. Keep page/position info so images can be traced back.
- Asset browser in the UI (by tag/kind).
- Reference renderer: images with masks/cut-outs (simple rectangle + feather first; optional background removal later), optional grayscale/hatching filter, red overlay.
- Anubis placed from photo.
- Procedural fillers: snake scales, Mäander band, lotus frieze, hatching, starfield.
- **Acceptance:** baseline layout in reference mode with real images; switching modes is instant.

### Phase 5 — Export for the artist
- PNG export of all views + unwrap at high resolution.
- PDF handout: cover note, four views (blockout + reference side by side), unwrap with cm grid, legend, element notes (from YAML), open questions.
- Exports go to `<TATTOO_DATA_DIR>/exports/<layout>-<date>.pdf`.
- **Acceptance:** one-click PDF for any layout, nothing written into the repo.

### Phase 6 — Iteration & polish (open-ended)
- Variant switcher + side-by-side comparison of two layouts.
- Elbow-bent pose.
- Optional: photogrammetry arm scan; right arm preview (both arms side by side to check the overall look).
- Optional: simple brush tool for drawing red strokes directly on the 3D arm.

---

## 15. Conventions for Claude Code

To be copied into `CLAUDE.md`:

- **Documentation, code comments, commit messages: English.** (Conversation with Jan may be German.)
- **Never commit images, PDFs or exports.** All binary/visual data lives in `TATTOO_DATA_DIR` (Seafile). Respect the pre-commit guard; never bypass it.
- Read paths only via `TATTOO_DATA_DIR`; never hard-code Jan's absolute paths in committed files.
- No public deployment; the planner stays local. Sending an image to an image-edit service (OpenAI, for generative edits; Jan, 2026-11-04) is fine; never put data-folder files into a git repo or anywhere public.
- Prefer small, reviewable commits per phase step; keep `README.md` current.
- Record significant technical choices as ADRs in `docs/adr/`.
- When in doubt about design intent (motifs, placement, style), consult `PROJECT_BRIEF.md` §3–§9; ask Jan rather than inventing design decisions. The tool visualises Jan's ideas — it does not design the tattoo.
- Keep the layout YAML human-editable and stable (Jan may edit it by hand).

---

## 16. Tasks for Jan

- [x] Create private GitHub repo.
- [x] Create Seafile folder (`Your Secure Cloud/Protected Jan`) and put `ideas.pdf` in it.
- [ ] Put this file into the repo root as `PROJECT_BRIEF.md`.
- [ ] Tell Claude Code: OS, local Seafile mount path, location/name of the Job Radar repo (and optionally Is it cool / Porcellano).
- [ ] Measure the left arm (§13.1) — can happen in parallel; Phase 2 starts with placeholders.
- [ ] Photograph the left arm from four sides, straight, with a tape measure visible → `arm-photos/`.
- [ ] Photograph the Anubis straight-on with a tape measure → `existing/`.
- [ ] Collect references into `refs/` and `cards/` (Rhonas incl. Invocations version, Hythonia, Athreos, skull/Medusa/Pegasus references). Note the source in the filename or a sidecar `.txt`.

---

## 17. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Parametric arm looks too abstract | Ambient occlusion + realistic proportions first; optional photogrammetry scan later; editor is UV-based so the mesh can be swapped. |
| UV distortion around elbow/shoulder | cm-grid debug texture; adjust seam/parametrisation; accept some distortion at the shoulder cap. |
| Reference images with backgrounds look messy | Start with blockout mode as the main view; simple masks; optional background removal later. |
| Images accidentally committed | `.gitignore` + pre-commit guard + CLAUDE.md rule. |
| Scope creep (it's a holiday project) | Phases with acceptance criteria; Phase 3 already answers the core question (balance). |
| The sketch over-specifies the design for the artist | Blockout mode as the primary handout view; PDF explicitly invites the artist's interpretation. |
