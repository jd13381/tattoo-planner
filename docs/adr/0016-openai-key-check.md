# ADR 0016: OpenAI key entry, check and startup check

- Status: accepted (2026-11-06). Jan's test note: the key must be settable in Settings and checked at once; a key that stopped working must be reported at startup, with what that means. Jan approved one small startup request to OpenAI (no images) with a switch to turn it off.
- Context: ADR 0008 (generative edits, key from `.env`), ADR 0015 (desktop app, key in the Keychain through `safeStorage`). Until now a planner run from git could only take the key from `.env`, and nobody learned that a key was broken until a generative edit failed. Jan runs from git with the key only in `.env`; that must keep working untouched.

## Decision

### Where the key comes from

`server/settings.ts` (`OpenAIKeys`) resolves the key on every use, first match wins:

1. **Desktop app:** the Keychain key from `desktop/keyStore.ts` (unchanged, ADR 0015).
2. **Saved in Settings, run from git:** a plain-text file `openai-key` next to the user config (`~/.config/tattoo-planner/openai-key`, or under `$XDG_CONFIG_HOME`), mode 0600 in a 0700 folder, written atomically. The desktop app never reads or writes this file.
3. **Environment:** `TATTOO_OPENAI_API_KEY` (or `OPENAI_API_KEY`) from the shell or the checkout's `.env`.

A key entered in the UI wins over `.env` because it is the newer, deliberate choice; **Remove** deletes only the saved key, so the `.env` key is used again. The planner never writes `.env`. The overview tells the user which source is active ("from .env", "from the environment", "saved in the planner's settings", "saved in the macOS Keychain") and shows the last four characters only; the key never goes to the page. A key from the shell and one from `.env` are told apart by checking whether the shell has the same value (Vite and `readEnv()` merge `.env` under the shell).

### The check

`src/edits/keyCheck.ts` (framework-free, unit-tested with a mocked `fetch`) sends one `GET https://api.openai.com/v1/models/<model>` with the key as bearer token, the image model in use (`TATTOO_OPENAI_MODEL`, default `gpt-image-2.5-sunburst`), and a 10 s timeout. It is authenticated, has no body, creates nothing and costs nothing. Classification:

| Answer                                                         | Status            | Meaning for the user                                                        |
| -------------------------------------------------------------- | ----------------- | --------------------------------------------------------------------------- |
| 2xx                                                            | `valid`           | works                                                                       |
| 401                                                            | `invalid`         | key wrong, revoked or deleted                                               |
| 403 / 404                                                      | `no-model-access` | key works, but not for the image model (verification, project restrictions) |
| 429 `insufficient_quota` (or "quota"/"billing" in the message) | `quota`           | no credit / limit reached                                                   |
| 429 otherwise                                                  | `rate-limited`    | transient, the key is fine                                                  |
| no answer (DNS, offline, proxy, timeout)                       | `network`         | says nothing about the key                                                  |
| 5xx, anything else                                             | `error`           | OpenAI trouble, try later                                                   |

OpenAI's error message is appended, with anything that looks like a key (`sk-…`, also OpenAI's masked echo) redacted.

### API (`server/openaiKeyApi.ts`, `/api/openai-key`)

`GET /` overview (source, hint, model, canSave, startupCheck, last check), `GET /startup` (the startup check), `POST /test` (`{ key? }`: a given key or the one in use, always fresh), `PUT /` (check, then save; refused with 422 only when OpenAI rejects the key, saved otherwise, including offline), `DELETE /`, `PUT /settings` (`{ startupCheck }`). Writes refuse cross-site requests like the other handlers. In the desktop app `PUT`/`DELETE /` answer 409: the page checks a new key with `POST /test { key }` first and, unless rejected, stores it through the preload bridge as before.

### Startup check

The page asks `GET /api/openai-key/startup` once when the app shell mounts. The server checks the key in use the first time and caches the result for the run (per key, a pending check shared), so reloads and several tabs cause one request per start. With no key, or the switch off, no request is made. The switch is `openaiStartupCheck` in the user config (`config.json`; default on; other keys are kept).

A failed check shows a dismissible notice floating under the top bar (`src/settings/KeyCheckNotice.tsx`), text from `startupNotice()`: for `invalid`, `no-model-access` and `quota` an error saying generative features in the Image studio (Generate, Edit with GPT) won't work until the key is fixed in Settings → Image generation, and that everything else works; for `network` and `error` a softer warning that the key could not be checked and that this does not mean it is broken. `valid` and `rate-limited` show nothing. Dismissal is kept per check in `sessionStorage`. A passing check in Settings clears the notice.

## Alternatives

- **Write the key into `.env`:** one place for git users, but rewriting a hand-edited file risks losing comments or the key Jan has there, and `.env` sits inside the checkout. Rejected.
- **Encrypt the saved key (OS keyring via a native module):** a new native dependency with install scripts for the browser mode; the file is owner-only like `~/.netrc` or OpenAI's own CLI config. The desktop app keeps the Keychain.
- **Check with `GET /v1/models` (the list):** proves the key but not access to the image model; the single-model lookup answers both and is as cheap.
- **A tiny image request:** would detect missing credit, but costs money and sends data. Rejected; missing credit is therefore only detected when OpenAI returns 429 for the lookup, otherwise the first generative edit reports it.
- **Check in the page or in the desktop main process:** the server is the one place that has the key in every mode and already talks to OpenAI.

## Consequences

- The planner now makes one network request per start when a key is set; `docs/privacy.md` and the roadmap principle say so, and Settings has the switch.
- `keyProblem()` moved from `desktop/keyStore.ts` to `src/edits/keyCheck.ts` (re-exported), so the server validates the format the same way.
- Untested here: the real OpenAI answers for the image model (this container cannot reach `api.openai.com`), and the desktop flow in Electron.
