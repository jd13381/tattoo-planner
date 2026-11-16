#!/usr/bin/env bash
# Attaches the build provenance of a release's DMGs to the release as a file (docs/adr/0028).
# Usage: scripts/release-provenance.sh v1.2.3   (needs GH_TOKEN and GH_REPO; run by CI)
#
# Downloads the release's DMGs, verifies each attestation against this repository's desktop.yml,
# downloads the attestations and uploads them as Tattoo-Planner-<version>.intoto.jsonl, so tools
# that only read release files (OpenSSF Scorecard's Signed-Releases check) see them too.
set -euo pipefail
tag="${1:?usage: release-provenance.sh vX.Y.Z}"
if ! [[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "::error::Tag must look like v1.2.3, got: $tag"
  exit 1
fi
: "${GH_REPO:?GH_REPO must be set}"
work="$(mktemp -d)"
out="Tattoo-Planner-${tag#v}.intoto.jsonl"
cd "$work"
gh release download "$tag" --pattern '*.dmg'
: > "$out"
for dmg in *.dmg; do
  gh attestation verify "$dmg" --repo "$GH_REPO" --signer-workflow "$GH_REPO/.github/workflows/desktop.yml"
  gh attestation download "$dmg" --repo "$GH_REPO"
  cat sha256:*.jsonl >> "$out"
  rm sha256:*.jsonl
done
wc -l "$out"
gh release upload "$tag" "$out" --clobber
