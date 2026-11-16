# Install the Tattoo Planner on a Mac

Download the DMG for your Mac from the [latest release](https://github.com/jd13381/tattoo-planner/releases/latest):

| Your Mac                                          | File                                 |
| ------------------------------------------------- | ------------------------------------ |
| Apple Silicon (M1 or newer; most Macs since 2021) | `Tattoo-Planner-<version>-arm64.dmg` |
| Intel                                             | `Tattoo-Planner-<version>-x64.dmg`   |

Not sure? Apple menu → **About This Mac**: "Chip Apple M…" means Apple Silicon. macOS 12 or newer is needed.

Open the DMG and drag **Tattoo Planner** into **Applications**.

## Why macOS blocks the app at first

The app is **not signed with an Apple Developer ID and not notarised by Apple**. That takes a paid Apple Developer account (99 USD a year), which this personal, unmaintained project doesn't have. The app is only ad-hoc signed, so macOS can't confirm who made it and blocks it the first time with a message like _"Apple could not verify 'Tattoo Planner' is free of malware"_ or _"'Tattoo Planner' cannot be opened because the developer cannot be verified"_.

This is the normal behaviour for unsigned open-source apps, not a sign that the file is damaged. You can check what you are running instead of trusting a signature:

- The DMGs are built by GitHub Actions from this repository's source ([desktop.yml](https://github.com/jd13381/tattoo-planner/blob/main/.github/workflows/desktop.yml)); the release run's log shows every step.
- `SHA256SUMS.txt` in the release lists the checksum of each DMG: `shasum -a 256 Tattoo-Planner-*.dmg` must print the same.
- Each DMG has a signed build provenance attestation that ties it to this repository and workflow: `gh attestation verify Tattoo-Planner-<version>-arm64.dmg --repo jd13381/tattoo-planner`. The same attestations are in the release as `Tattoo-Planner-<version>.intoto.jsonl`.

## Allow it once

**macOS 15 Sequoia and newer**

1. Open **Tattoo Planner** from Applications. macOS shows the warning; click **Done** (not "Move to Trash").
2. Open **System Settings → Privacy & Security** and scroll down to **Security**. It says _"'Tattoo Planner' was blocked to protect your Mac."_
3. Click **Open Anyway**, confirm with your password or Touch ID, then click **Open Anyway** in the dialog that follows.

**macOS 12 to 14**

1. In Applications, **right-click** (or Control-click) **Tattoo Planner** → **Open**.
2. Click **Open** in the dialog.

After that the app opens normally, like any other. You do this once per installed version.

**If macOS says the app "is damaged"**, the quarantine flag of the download got in the way. Remove it in Terminal and open the app again:

```sh
xattr -dr com.apple.quarantine "/Applications/Tattoo Planner.app"
```

## What the app does and doesn't do

Everything runs on your Mac: no account, no telemetry, no update check. The only network access is an optional generative image edit with your own OpenAI key. Details: [privacy](https://github.com/jd13381/tattoo-planner/blob/main/docs/privacy.md). The project is published as is and not maintained; see the [README](https://github.com/jd13381/tattoo-planner#readme).

## Uninstall

Drag **Tattoo Planner** from Applications to the Bin. Its settings live in `~/Library/Application Support/Tattoo Planner`; your project folders stay wherever you saved them.
