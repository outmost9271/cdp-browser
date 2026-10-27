# `cdp_browser` parameter reference

This file is the working reference for the native tool schema. Read it when a call failed validation or when you are unsure which field belongs at the top level.

## Top-level fields

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `args` | `string[]` | one mode | Exact argv after the `agent-browser` binary. No binary name, no `--json`, no shell operators. |
| `script` | `string` | one mode | One-shot JavaScript orchestration, max 64 KiB. Mutually exclusive with `sessionMode` and top-level `stdin`. |
| `semanticAction` | `object` | one mode | Locator shorthand compiled to `find`, direct `click`/`check`/`fill`, or `select`. |
| `job` | `object` | one mode | Constrained linear workflow compiled to `batch --bail` by default. |
| `qa` | `object` | one mode | URL or attached-session smoke/QA preset. |
| `electron` | `object` | one mode | Desktop Electron lifecycle (`list`, `launch`, `status`, `probe`, `cleanup`). |
| `sourceLookup` | `object` | one mode | Experimental UI-to-source candidates. |
| `networkSourceLookup` | `object` | one mode | Experimental failed-request-to-source candidates. |
| `stdin` | `string` | optional | Only for `batch`, `eval --stdin`, `auth save --password-stdin`, or wrapper-generated batch modes. Rejected with `electron`. |
| `outputPath` | `string` | optional | Durable result file outside the transcript. Must not reuse an artifact destination. |
| `timeoutMs` | positive integer | optional | Wrapper subprocess watchdog. Defaults are mode-specific. |
| `sessionMode` | `"auto" \| "fresh"` | optional | `auto` reuses the managed session; `fresh` starts a new one so launch flags apply. |

Exactly one mode field may be present. Combining two, for example `args` + `job`, is a validation error.

## `args` rules

Correct:

```json
{ "args": ["open", "https://example.com"] }
{ "args": ["snapshot", "-i"] }
{ "args": ["fill", "@e1", "user@example.com"] }
{ "args": ["--profile", "Default", "open", "https://example.com"], "sessionMode": "fresh" }
```

Incorrect and why:

```json
{ "args": "open https://example.com" }
```

`args` must be an array, not a command string.

```json
{ "args": ["agent-browser", "open", "https://example.com"] }
```

Do not include the binary name.

```json
{ "args": ["--json", "get", "title"] }
```

The wrapper injects `--json`; a manual flag changes the output contract.

```json
{ "args": ["eval", "--stdin", "document.title"] }
```

The snippet belongs in `stdin`:

```json
{ "args": ["eval", "--stdin"], "stdin": "document.title" }
```

## `stdin` rules

Allowed pairings:

```json
{ "args": ["batch", "--bail"], "stdin": "[[\"open\",\"https://example.com\"],[\"snapshot\",\"-i\"]]" }
{ "args": ["eval", "--stdin"], "stdin": "({ title: document.title })" }
{ "args": ["auth", "save", "name", "--password-stdin"], "stdin": "<secret>" }
```

Also generated internally by `job`, `qa`, `sourceLookup`, and `networkSourceLookup`; do not pass your own `stdin` alongside those modes.

Rejected:

- `stdin` with `electron`
- `stdin` with `job`, `qa`, `semanticAction`, `script`, `sourceLookup`, or `networkSourceLookup`
- `stdin` with a non-stdin command such as `open`

## `semanticAction` fields

| Field | Applies to | Notes |
| --- | --- | --- |
| `action` | all | `click`, `fill`, `check`, `select` |
| `locator` | click/fill/check/select | `role`, `text`, `label`, `placeholder`, `alt`, `title`, `testid` |
| `value` | locator modes | Locator argument, for example role token, label text, or option value |
| `role` | `locator: "role"` | Alternative to `value`; if both are set they must match |
| `name` | `locator: "role"` | Accessible name; compiles to `--name` |
| `selector` | direct modes | `@eN` or CSS; do not combine with locator/value/role/name |
| `text` | `fill` | Required and non-empty |
| `values` | `select` | One or more option values |
| `session` | all | Named upstream session; prepended as `--session` |

Valid:

```json
{ "semanticAction": { "action": "click", "locator": "role", "role": "button", "name": "Continue" } }
{ "semanticAction": { "action": "fill", "locator": "label", "value": "Email", "text": "a@b.c" } }
{ "semanticAction": { "action": "fill", "selector": "@e1", "text": "hello" } }
{ "semanticAction": { "action": "select", "selector": "#flavor", "value": "chocolate" } }
```

Invalid:

```json
{ "semanticAction": { "action": "fill", "selector": "@e1" } }
```

Missing `text`.

```json
{ "semanticAction": { "action": "fill", "selector": "@e1", "text": "x", "locator": "label", "value": "Email" } }
```

`selector` conflicts with locator fields.

```json
{ "semanticAction": { "action": "uncheck", "selector": "@e2" } }
```

`uncheck` is not exposed; use `args`.

## `job` fields

Top-level shape:

```json
{ "job": { "failFast": true, "steps": [ ... ] } }
```

`steps` must be a non-empty array. Supported actions:

| Action | Fields | Compiles to |
| --- | --- | --- |
| `open` | `url`, optional `loadState` | `open <url>` plus optional `wait --load <state>` |
| `click` | `selector` or locator fields | `click` or `find ...` |
| `fill` | `selector` + `text`, or locator fields + `text` | `fill` or `find ... fill` |
| `type` | `text`, optional `selector`, `delayMs`, `press` | focus, per-character typing, optional key |
| `select` | `selector` + `value`/`values` | `select <selector> <value...>` |
| `wait` | `milliseconds` | fixed wait |
| `assertText` | `text` only | `wait --text <text>` |
| `assertUrl` | `url` (exact or `*`/`**` glob) | `wait --url <pattern>` |
| `waitForDownload` | `path` | `wait --download <path>` |
| `snapshot` | none | `snapshot -i` |
| `screenshot` | `path` | screenshot |

Rules:

- `assertText` takes only `text`; adding `selector` is a schema error.
- `assertUrl` must distinguish the expected state from the starting page.
- `delayMs` typing is capped at 200 characters per step.
- Re-snapshot after steps that can rerender before reusing refs.

## `qa` fields

URL form:

```json
{
  "qa": {
    "url": "https://example.com",
    "expectedText": "Example Domain",
    "expectedSelector": "#main",
    "loadState": "domcontentloaded",
    "checkNetwork": true,
    "checkConsole": true,
    "checkErrors": true,
    "screenshotPath": "/tmp/qa.png"
  }
}
```

Attached form:

```json
{ "qa": { "attached": true, "expectedText": "Dashboard", "checkErrors": true } }
```

Rules:

- `url` and `attached` are alternatives.
- `qa.attached` rejects `url` and `sessionMode: "fresh"`.
- For attached QA, diagnostic checks default to `false`; opt in explicitly.
- `loadState` accepts `domcontentloaded`, `load`, or `networkidle`.
- Do not pass `stdin` with `qa`.

## `script` fields

```json
{
  "script": "const r = await browser({ args: ['get', 'title'] }); if (!r.ok) throw new Error(r.error); emit(r.data.title ?? r.data.result);"
}
```

Rules:

- `browser()` accepts `args`, optional `stdin`, optional `timeoutMs`.
- Each result has `{ ok, data, error, details, failureCategory, nextActions, resultCategory, summary, text }`.
- `emit()` accepts JSON-compatible data.
- Up to 25 inner calls.
- Isolated session; no host filesystem, network, timers, imports, or caller session controls.
- Requires a persisted Pi session (not `--no-session`).
- Mutually exclusive with top-level `stdin` and `sessionMode`.

## `electron` fields

| Action | Fields |
| --- | --- |
| `list` | `query?`, `maxResults?` |
| `launch` | exactly one of `appPath`, `appName`, `bundleId`, `executablePath`; optional `appArgs`, `handoff`, `targetType`, `timeoutMs`, `allow`, `deny` |
| `status` | `launchId?` or `all: true`; optional `timeoutMs` |
| `cleanup` | `launchId?` or `all: true`; optional `timeoutMs` |
| `probe` | `launchId?`, `timeoutMs?` |

Rules:

- `handoff`: `snapshot` (default), `tabs`, or `connect`.
- `targetType`: `page` (default), `webview`, or `any`.
- `launch` does not reuse the app's signed-in profile.
- Always `cleanup` a launch you created.
- `stdin` is rejected.

## `sessionMode`

| Value | Behavior |
| --- | --- |
| `auto` (default) | Reuse the extension-managed session and inject it when appropriate |
| `fresh` | Start a new managed session so launch-scoped flags apply |

Launch-scoped flags include `--profile`, `--executable-path`, `--cdp`, `--headed`, `--device`, `--enable`, `--webgpu`, `--no-webmcp`, `--restore`, `--state`, `--auto-connect`, `--provider`, and others. If the session is already active, passing them with `auto` returns a recovery hint instead of silently ignoring them.

Do not pass `--session-mode` inside `args`; it is not an upstream flag.

## `timeoutMs` and `outputPath`

- `timeoutMs` controls the wrapper watchdog for the browser subprocess. Managed-session policy inspection has its own fixed budget.
- `outputPath` writes a durable result file. It must not point at a screenshot, download, recording, or other artifact target.
- On timeout, inspect `details.timeoutPartialProgress`; do not blindly replay mutating steps.

## Result fields to check

| Field | Meaning |
| --- | --- |
| `resultCategory` | `success` or `failure` |
| `successCategory` / `failureCategory` | Why the call ended that way |
| `details.nextActions` | Exact follow-up payloads; prefer these over guessing |
| `details.artifactVerification` | Whether requested files exist |
| `details.refSnapshot` | Latest refs and page target |
| `details.refSnapshotInvalidation` | Why prior refs were invalidated |
| `details.pageChangeSummary` | Navigation/mutation/confirmation signal |
| `details.sessionName` / `details.usedImplicitSession` | Which session ran |
| `details.managedSessionOutcome` | Fresh-session transition outcome |
| `details.compiledJob` / `compiledQaPreset` / `compiledSemanticAction` | Exact compiled argv |

A `failure` category is patched to `isError: true` in the Pi transcript even when the tool returned normally.
