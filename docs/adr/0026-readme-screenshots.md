# ADR 0026: README screenshots in git, generated from the sample project

- Status: accepted (2026-11-15, Jan: "ja, sonst können sie in der readme nicht angezeigt werden")
- Context: the repository goes public as it is, history included (Jan, 2026-11-15). A README for strangers needs pictures of the planner, and GitHub only shows images in a README reliably when they live in the repository. The rule "no images in git" (`PROJECT_BRIEF.md` §12) exists to keep Jan's photos, reference images and exports out of the repo; it had one exception so far, the generated background tiles (ADR 0019).

## Decision

- **A second exception: `docs/screenshots/*.webp`.** The pre-commit guard (`scripts/check-binaries.mjs`) and `.gitignore` allow WebP files directly in that folder, at most 500 KB each. PNG, JPEG, subfolders and anything larger are still refused.
- **Only generated, only from the sample.** `npm run screenshots` (`scripts/screenshots.ts`) starts the planner's server on a free local port with a hand-built environment (no `TATTOO_DATA_DIR`, no OpenAI key, a throwaway settings folder) and never reads `.env`, so it cannot open a real project. It opens the read-only sample in `samples/demo` (motifs drawn at runtime) and photographs a fixed list of views with Playwright at 1440 × 900, rendered at 2× and scaled down, re-encoded to WebP.
- **Playwright** (`playwright`, devDependency) drives the browser. It needs a Chromium once: `npx playwright install chromium`; `SCREENSHOTS_CHROMIUM` points it at another binary (containers, CI). WebGL runs through SwiftShader where there is no GPU.

## Consequences

- Screenshots go stale when the UI changes; re-run `npm run screenshots` and commit the result. Runs are close to, but not byte-for-byte, identical (WebGL anti-aliasing, encoder).
- Never add a screenshot of a real project, a photo or a reference image to `docs/screenshots/`, even if it fits the limits.
