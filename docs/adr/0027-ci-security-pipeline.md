# ADR 0027: CI and security pipeline

- Status: accepted (2026-11-15, Jan asked for a pipeline that follows current best practice, "z.B. SAST und DAST scanning", before the repository goes public)
- Context: until now CI ran lint, typecheck, unit tests, the build and the binary guard. The repository becomes public; the pipeline should show the standard security checks of a small TypeScript web app with a local server, without turning into maintenance work.

## Decision

Three workflows plus Dependabot, every third-party action pinned to a full commit SHA, every job with `persist-credentials: false` and the least `permissions` it needs (the workflow default is `contents: read`).

| Workflow / job              | What it checks                                                                                                                                                                                                                      | Fails on                                                |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `ci.yml` check              | ESLint + Prettier, `tsc -b`, Vitest, Vite build, binary guard; Node 22 and 25                                                                                                                                                       | any error                                               |
| `ci.yml` e2e                | `npm run screenshots` in a real Chromium: opens the sample project, walks Home, Layout, Image studio, Assets; screenshots kept as an artifact                                                                                       | a view that does not render                             |
| `security.yml` sast         | **CodeQL** with the `security-extended` suite on `javascript-typescript` and on `actions` (the workflows)                                                                                                                           | results appear in code scanning (public repo)           |
| `security.yml` secrets      | **Gitleaks** over the pushed / pull-request commits; the weekly run walks the whole history                                                                                                                                         | any finding                                             |
| `security.yml` dependencies | `npm audit --audit-level=high`, `npm audit signatures` (registry signatures and provenance), a **CycloneDX SBOM** of the runtime dependencies as an artifact, **dependency review** on pull requests (vulnerabilities and licences) | high/critical advisories, bad signatures, GPL/AGPL/SSPL |
| `security.yml` workflows    | **zizmor**: static analysis of the workflows (template injection, credential persistence, cache poisoning, unpinned actions, excessive permissions)                                                                                 | any finding of low or above                             |
| `security.yml` dast         | **OWASP ZAP baseline** (passive scan plus spider) against the production build served by `server/standalone.ts` on `127.0.0.1:4322`, without a project or key; HTML and JSON report as an artifact                                  | any warning not listed in `.zap/rules.tsv`              |
| `scorecard.yml`             | **OpenSSF Scorecard** of the repository's practices, published for the README badge; skipped while the repository is private                                                                                                        | (report only)                                           |
| `.github/dependabot.yml`    | monthly grouped npm and Actions updates with a 7-day cooldown (as `.npmrc`'s `min-release-age`); security updates as advisories appear                                                                                              | n/a                                                     |

`security.yml` runs on pushes to `main`, on pull requests, weekly (new advisories and rules reach unchanged code) and by hand.

**Security headers, found by the DAST design.** The standalone server (and so the desktop app) now sends a Content-Security-Policy, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, a `Permissions-Policy` that turns off camera, microphone, location, payment, USB and serial, `Cross-Origin-Opener-Policy` and `Cross-Origin-Resource-Policy: same-origin` on every response (`server/securityHeaders.ts`, tested in `tests/standalone.test.ts`). The CSP is the one the desktop shell already used; it moved from `desktop/navigation.ts` to the server module, which both import. The Vite dev server does not send them.

**Accepted ZAP findings** are listed with the reason in `.zap/rules.tsv`: informational alerts (cacheable content, bundle comments and numbers, "modern web app") and two trade-offs: `style-src 'unsafe-inline'` (React and three.js set style attributes; scripts stay `'self'` only) and no `Cross-Origin-Embedder-Policy` (everything is same-origin on loopback).

## Consequences

- Code scanning results (CodeQL, Scorecard) and dependency review need a public repository; while private, CodeQL keeps its SARIF as a run artifact and the other two are skipped.
- A new high or critical advisory in any dependency fails `security.yml` until it is updated; the weekly run surfaces it even without commits.
- The DAST scan covers the HTTP surface (headers, cookies, error pages, the API's answers without a project). It does not log in or fuzz: the planner has no accounts, and its API only listens on loopback and checks `Host`.
