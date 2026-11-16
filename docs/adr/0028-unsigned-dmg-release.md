# ADR 0028: Unsigned DMG releases built by CI

- Status: accepted (2026-11-15, Jan: a DMG so that people don't have to clone the repo, unsigned for now, with a download page that explains why macOS blocks the app and how to allow it)
- Context: ADR 0015 added the Electron app and a workflow that could build DMGs, but it had never run and only made draft releases. Signing needs an Apple Developer account (99 USD a year, roadmap §7 open point 1), which Jan doesn't want for an unmaintained project. Without it macOS Gatekeeper blocks the app on first start; since macOS 15 the old right-click → Open shortcut no longer works and users have to go through System Settings.

## Decision

- **Release from CI only.** `.github/workflows/desktop.yml` builds both DMGs (arm64, x64) on a macOS runner, runs `npm run check` first, checks every DMG (`hdiutil verify`) and the app's signature (`codesign --verify --deep --strict`), and writes `SHA256SUMS.txt`. A manual run on `main` with **release** ticked (or a pushed tag `v<version>`) creates the tag and a published GitHub Release with the DMGs and checksums. The version comes from `package.json`; a tag that disagrees fails the build.
- **Ad-hoc signed, not notarised.** Unchanged from ADR 0015: Apple Silicon needs at least an ad-hoc signature to start the app. Signing and notarisation switch on by themselves once the repository secrets exist.
- **Trust without a Developer ID:** the release run's log is public, the checksums are in the release, and `actions/attest-build-provenance` signs a provenance attestation for each DMG (Sigstore, verifiable with `gh attestation verify … --repo jd13381/tattoo-planner`). Attestations need a public repository, so a build of the private repository skips that step. The attestations are also attached to the release as `Tattoo-Planner-<version>.intoto.jsonl` (`scripts/release-provenance.sh`, run by the release job and, for an existing tag, by hand through `.github/workflows/release-provenance.yml`; Jan, 2026-11-16), so tools that only read release files, such as OpenSSF Scorecard's Signed-Releases check, see them too. The script verifies them against `desktop.yml` before uploading.
- **Download page:** `docs/install-macos.md` is both the guide in the repository and the release text (`--notes-file`). It says which DMG to pick, why macOS blocks the app, how to check the download, how to allow it on macOS 15+ (Privacy & Security → Open Anyway) and on 12–14 (right-click → Open), and the `xattr` fallback for "is damaged".
- **Jobs and permissions:** the build job only reads the repository (plus `id-token`/`attestations` for the attestation); a separate release job on Linux gets `contents: write`. No npm cache in release builds (cache poisoning, zizmor).

## Consequences

- Each release asks users for one extra step on first start; the README and the release text say so up front.
- The first version is 1.0.0 (`package.json`), the state Jan published on 2026-11-15.
- Moving to a signed, notarised app later needs only the five secrets; the workflow and config already handle them, and `enableEmbeddedAsarIntegrityValidation` should then be switched on (ADR 0015).
