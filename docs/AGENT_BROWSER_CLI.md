# Direct `agent-browser` CLI guide

This package ships the upstream [`agent-browser`](https://agent-browser.dev/) binary and puts a stable `agent-browser` entry point on the `PATH` that Pi's `bash` tool uses. This document covers that direct CLI surface. For the native `cdp_browser` tool contract, see [`TOOL_CONTRACT.md`](TOOL_CONTRACT.md).

## Contents

- [Which entry point to use](#which-entry-point-to-use)
- [How PATH exposure works](#how-path-exposure-works)
- [First connection](#first-connection)
- [Global options](#global-options)
- [Core loop and refs](#core-loop-and-refs)
- [Command reference](#command-reference)
- [Output formats](#output-formats)
- [Batch execution](#batch-execution)
- [Sessions and namespaces](#sessions-and-namespaces)
- [Artifacts](#artifacts)
- [State, auth, and profiles](#state-auth-and-profiles)
- [Network and diagnostics](#network-and-diagnostics)
- [Built-in skills](#built-in-skills)
- [Common errors](#common-errors)
- [Mapping to `cdp_browser` parameters](#mapping-to-cdp_browser-parameters)

## Which entry point to use

| Need | Use |
| --- | --- |
| Ordinary agent browser work (open, snapshot, click, fill, extract, screenshot) | Native `cdp_browser` tool |
| Raw upstream flags, shell pipelines, `jq`, loops over many pages, or CLI debugging | Direct `agent-browser` in `bash` |
| Compact structured metadata (`details`, `nextActions`, artifact verification) | Native `cdp_browser` tool |
| Reproducing an upstream bug against the exact bundled version | Direct `agent-browser` |
| One explicit multi-step plan without shell quoting | `cdp_browser` `job` or `batch` |

The tool is not a wrapper that hides the CLI; it is a second, richer surface over the same binary. Direct CLI calls do **not** get these wrapper behaviors:

- configured `--cdp <endpoint>` injection
- implicit managed sessions
- `--json` injection
- result categorization, `nextActions`, artifact verification, or spill handling
- stale-ref preflight and page-target validation
- `details` metadata and Pi transcript error patching

Because of that, the CLI is the right tool when you explicitly want raw behavior, and the wrong tool when you want those guarantees.

## How PATH exposure works

At session start the extension resolves the packaged binary and creates a private shim directory under the system temporary directory:

```text
<tmp>/cdp-browser-cli-<platform>-<sha256-prefix>/
├── agent-browser          # POSIX shim (also usable from Git Bash on Windows)
└── agent-browser.cmd      # Windows cmd wrapper
```

The shim simply forwards all arguments:

```sh
#!/bin/sh
exec "<package>/vendor/agent-browser/agent-browser-linux-x64" "$@"
```

The directory is prepended to `process.env.PATH`; Pi's bash tool rebuilds its child environment from `process.env` for every command, so the entry point is available without replacing the built-in bash tool.

Properties:

- The shim adds **no** default arguments. It is byte-for-byte upstream behavior.
- Creation is idempotent and re-created on each Pi start because the temp directory may be cleaned.
- The directory is created with mode `0700`; the shim is `0755`.
- If the packaged binary is missing, the extension reports the failure but does not block tool registration or bash.

Verify inside a Pi session:

```bash
command -v agent-browser
agent-browser --version
```

Expected version for this package is recorded in `vendor/agent-browser/manifest.json` (currently `0.37.1`).

If `command -v` returns nothing, the extension did not start its session hook (for example, it was not loaded), or the temporary directory is not executable on this host (`noexec` mount). Use the native tool in that case; do not download a different `agent-browser` over the packaged one.

## First connection

This fork is remote-only: the CLI never launches a local Chrome by itself. Supply a CDP endpoint on every browser-backed command unless you have connected the named session first.

Per-call endpoint:

```bash
agent-browser --cdp http://127.0.0.1:9222 open https://example.com
agent-browser --cdp 9222 snapshot -i
```

Explicit connect:

```bash
agent-browser connect http://127.0.0.1:9222
agent-browser get url
agent-browser snapshot -i
```

Accepted endpoint forms: `http://host:port`, `ws://host:port/devtools/browser/<id>`, or a bare port.

The configured endpoint can also be read with the package helper:

```bash
cdp-browser-config status
```

Tunnel pattern (recommended when Chrome runs on another machine):

```bash
ssh -N -L 9222:127.0.0.1:9222 user@remote-host
agent-browser --cdp http://127.0.0.1:9222 open https://example.com
```

CDP has no authentication. Never expose the port to an untrusted network.

## Global options

Global options go **before** the command word. Exact upstream spelling matters.

| Option | Purpose |
| --- | --- |
| `--cdp <url\|port>` | Remote CDP endpoint for this call |
| `--session <name>` | Named browser session (daemon identity) |
| `--namespace <name>` | Isolate daemon sockets and restore state |
| `--profile <name>` | Chrome profile to launch (only meaningful for a local launch; this fork is remote-only) |
| `--auto-connect` | Attach to a running debug-enabled browser |
| `--headed` | Ask upstream to show the browser window where it can launch one |
| `--executable-path <path>` | Chromium-compatible executable for a launch |
| `--user-agent <value>` | Custom user agent |
| `--device <name>` | Device emulation |
| `--restore [key]` | Restore cookies/localStorage/sessionStorage |
| `--restore-save <policy>` | Control automatic restore saves |
| `--state <path>` | Load a saved state file |
| `--init-script <path>` | Inject a script before navigation |
| `--enable <feature>` | Enable an upstream feature (for example `react-devtools`) |
| `--no-webmcp` | Disable WebMCP discovery |
| `--allowed-domains <list>` | Restrict navigation domains |
| `-p`, `--provider <name>` | Provider-backed browser |
| `--json` | Structured output where supported |

`--timeout` is command-scoped (`wait --timeout`, `read --timeout`, `webmcp invoke --timeout`), not a global option. `--bail` belongs to `batch` and must appear immediately after the command word.

Use one endpoint-selection mode per session. Do not stack `--cdp`, `connect`, `--auto-connect`, and `-p` and expect predictable behavior.

## Core loop and refs

```bash
agent-browser --cdp 9222 open https://example.com
agent-browser --cdp 9222 snapshot -i
agent-browser --cdp 9222 click @e3
agent-browser --cdp 9222 snapshot -i
```

Rules that prevent most failures:

1. `snapshot -i` returns interactive elements with `@eN` refs.
2. Refs are **page-scoped** and **snapshot-scoped**. Navigation, scrolling that loads new content, rerendering, tab switching, and form submissions can invalidate them.
3. After any of those events, take a fresh `snapshot -i` before reusing a ref.
4. `@e1`, `e1`, and `ref=e1` are accepted spellings in many commands; prefer the `@e1` form shown by the snapshot.
5. A ref is not a CSS selector and must not be quoted into another selector language.
6. When the target must survive ref churn, use `find` with role/text/label/placeholder/alt/title/testid.

Useful snapshot variants:

```bash
agent-browser --cdp 9222 snapshot -i                  # interactive only (default for agent work)
agent-browser --cdp 9222 snapshot -i --urls           # include link URLs
agent-browser --cdp 9222 snapshot --compact           # denser tree
agent-browser --cdp 9222 snapshot --depth 3           # bound depth
agent-browser --cdp 9222 snapshot --selector "#main"  # scope to a region
agent-browser --cdp 9222 snapshot --cursor            # include cursor/focus context
```

The native tool additionally supports wrapper-only `--search`, `--filter role=...`, `--viewport`, and `--diff`. Those are stripped before upstream spawn and are not raw CLI features.

## Command reference

The table below is the practical subset for agent work. The full generated list lives in [`COMMAND_REFERENCE.md`](COMMAND_REFERENCE.md).

### Navigation and page state

```bash
agent-browser --cdp 9222 open <url>
agent-browser --cdp 9222 open            # open a blank page / start the daemon
agent-browser --cdp 9222 back
agent-browser --cdp 9222 forward
agent-browser --cdp 9222 reload
agent-browser --cdp 9222 get url
agent-browser --cdp 9222 get title
agent-browser --cdp 9222 pushstate <url> # SPA history navigation
agent-browser --cdp 9222 read <url>      # readable text without needing an active page
agent-browser --cdp 9222 read             # rendered text of the active tab
```

### Interaction

```bash
agent-browser --cdp 9222 click <selector|@ref>
agent-browser --cdp 9222 click <selector> --new-tab
agent-browser --cdp 9222 fill <selector|@ref> <text>
agent-browser --cdp 9222 type <selector> <text>
agent-browser --cdp 9222 keyboard type <text>
agent-browser --cdp 9222 keyboard inserttext <text>
agent-browser --cdp 9222 press <key>
agent-browser --cdp 9222 keydown <key>
agent-browser --cdp 9222 keyup <key>
agent-browser --cdp 9222 select <selector> <value...>
agent-browser --cdp 9222 check <selector|@ref>
agent-browser --cdp 9222 uncheck <selector|@ref>
agent-browser --cdp 9222 hover <selector|@ref>
agent-browser --cdp 9222 scroll <up|down|left|right> [px|percent]
agent-browser --cdp 9222 scroll <selector> <direction> [px|percent]
agent-browser --cdp 9222 scrollintoview <selector|@ref>
agent-browser --cdp 9222 drag <source> <target>
agent-browser --cdp 9222 upload <selector> <path>
```

Notes:

- `type` needs both a selector and text. To type into the focused element, use `keyboard type`.
- `press` accepts exactly one key token (`Enter`, `Escape`, `ArrowDown`, …).
- For native `<select>`, use `select`, not a click on an option ref.
- `keyboard inserttext` is paste-like; framework-controlled editors may not update their state. Prefer real key events (`keyboard type`) when the app must react.

### Semantic locators

```bash
agent-browser --cdp 9222 find role button click --name "Sign in"
agent-browser --cdp 9222 find text "Continue" click
agent-browser --cdp 9222 find label "Email" fill "user@example.com"
agent-browser --cdp 9222 find placeholder "Search" fill "agent-browser"
agent-browser --cdp 9222 find testid "submit" click
```

Supported `find` actions are `click`, `fill`, `check`, `hover`, and `text`. There is no runtime `find ... uncheck`.

### Reading page data

```bash
agent-browser --cdp 9222 get text <selector|@ref>
agent-browser --cdp 9222 get html <selector|@ref>
agent-browser --cdp 9222 get value <selector|@ref>
agent-browser --cdp 9222 get count <selector>
agent-browser --cdp 9222 get attr <selector|@ref> <name>
agent-browser --cdp 9222 eval --stdin            # JavaScript from stdin
agent-browser --cdp 9222 eval "document.title"   # simple expression
```

`eval --stdin` reads the snippet from standard input. Return the value you need instead of relying on `console.log`:

```bash
printf '%s' '({ title: document.title, url: location.href })' \
  | agent-browser --cdp 9222 eval --stdin
```

Top-level `const`/`let`/`function` declarations persist in the page global scope across calls and can produce redeclaration errors. Wrap multi-statement snippets in an IIFE.

### Waiting

```bash
agent-browser --cdp 9222 wait --text "Dashboard"
agent-browser --cdp 9222 wait --url "**/dashboard"
agent-browser --cdp 9222 wait --load networkidle
agent-browser --cdp 9222 wait --fn "() => document.querySelector('#ready')"
agent-browser --cdp 9222 wait --download <path>
agent-browser --cdp 9222 wait 1500
```

Prefer a real condition over a fixed delay. A payload such as `"waited":"timeout"` means elapsed time, not success.

### Tabs

```bash
agent-browser --cdp 9222 tab list
agent-browser --cdp 9222 tab new [url]
agent-browser --cdp 9222 tab <tN|label|targetId>
agent-browser --cdp 9222 tab close [tN|label]
```

CDP target ids from `tab list --json` are accepted as tab refs and are more stable than positional ids across daemon restarts.

### Dialogs and frames

```bash
agent-browser --cdp 9222 dialog status
agent-browser --cdp 9222 dialog accept
agent-browser --cdp 9222 dialog dismiss
agent-browser --cdp 9222 frame <selector>
agent-browser --cdp 9222 frame main
```

### Artifacts

```bash
agent-browser --cdp 9222 screenshot [selector] [path]
agent-browser --cdp 9222 screenshot --full <path>
agent-browser --cdp 9222 screenshot --annotate <path>
agent-browser --cdp 9222 pdf <path>
agent-browser --cdp 9222 download <selector> <path>
agent-browser --cdp 9222 record start <path> [url]
agent-browser --cdp 9222 record stop
agent-browser --cdp 9222 trace start
agent-browser --cdp 9222 trace stop [path]
agent-browser --cdp 9222 profiler start
agent-browser --cdp 9222 profiler stop [path]
```

Recording requires `ffmpeg` on the CLI host. A started recording is not finished output until `record stop` writes the file.

### Sessions

```bash
agent-browser --cdp 9222 --session work open https://example.com
agent-browser --cdp 9222 --session work snapshot -i
agent-browser --cdp 9222 session info --json
agent-browser --cdp 9222 session list
agent-browser --cdp 9222 close
agent-browser --cdp 9222 --session work close
agent-browser --cdp 9222 close --all
```

Run `close` (or `close --all`) when finished. The daemon may otherwise idle out and, without a restore key, discard transient tabs and cookies.

## Output formats

Most commands support `--json`:

```bash
agent-browser --cdp 9222 --json get title
agent-browser --cdp 9222 --json snapshot -i
agent-browser --cdp 9222 --json batch --bail
```

Use JSON when piping into `jq` or another program. Plain text is optimized for model context but is not a stable machine format.

Common envelope fields: `success`, `data`, `error`. Always check `success`/`error`; a zero exit code alone is not a semantic success guarantee for every command.

## Batch execution

`batch` reads a JSON array of argv arrays from stdin:

```bash
printf '%s' '[["open","https://example.com"],["snapshot","-i"],["screenshot","/tmp/example.png"]]' \
  | agent-browser --cdp 9222 --json batch --bail
```

Rules:

- One command per row; each row is the argv **after** the binary.
- Use `--bail` (exact token) for fail-fast. Do not use `--bail=true` or `--bail=false`.
- Put `get url` before `snapshot -i` after a step that may navigate, when target identity is uncertain.
- Do not put `record start` after `close`/`quit`/`exit` in the same batch; upstream can report success without starting a recording.
- Raw batch paths should be absolute: the daemon working directory may differ from Pi's.
- A `screenshot` row inherits top-level flags such as `--annotate` only when they are global, for example `agent-browser --cdp 9222 --annotate batch`.

## Sessions and namespaces

- A session name selects one daemon/browser identity. Reusing the same name continues the same page.
- The native tool manages an implicit session for you. A direct CLI call without `--session` uses upstream's default identity, which may collide with tool work.
- For direct CLI experiments, pass a distinct name:

```bash
agent-browser --cdp 9222 --session cli-debug open https://example.com
agent-browser --cdp 9222 --session cli-debug snapshot -i
agent-browser --cdp 9222 --session cli-debug close
```

- `--namespace` isolates daemon sockets and restore-state directories. Canonical names are lowercase/sanitized.
- Multiple Pi sessions or agents can each use a different namespace; do not assume they share tabs.

## Artifacts

- Prefer absolute paths for CLI calls and batch rows.
- Create parent directories explicitly when using raw CLI; the native tool creates them for direct and stdin artifact paths.
- Verify the file exists before reporting success:

```bash
test -s /tmp/example.png && echo ok
```

- Closing the browser does not delete explicit files.

## State, auth, and profiles

```bash
agent-browser --cdp 9222 --restore open https://example.com
agent-browser --cdp 9222 state save /tmp/state.json
agent-browser --cdp 9222 state load /tmp/state.json
agent-browser --cdp 9222 state list
agent-browser --cdp 9222 cookies set --curl cookies.txt
agent-browser --cdp 9222 storage local
agent-browser --cdp 9222 storage session
agent-browser --cdp 9222 auth save <name> --password-stdin
agent-browser --cdp 9222 profiles
```

Credentials, cookies, and storage writes are sensitive. Do not echo them into transcripts or commit state files.

This fork never launches a local browser, so `--profile`, `--executable-path`, and `--headed` only make sense when upstream has a browser process it can launch or attach to. With a remote CDP endpoint, the remote browser and its profile determine login state.

## Network and diagnostics

```bash
agent-browser --cdp 9222 network requests
agent-browser --cdp 9222 network request <requestId>
agent-browser --cdp 9222 network har start
agent-browser --cdp 9222 network har stop /tmp/capture.har
agent-browser --cdp 9222 network route <url> --abort
agent-browser --cdp 9222 console
agent-browser --cdp 9222 errors
agent-browser --cdp 9222 console --clear
agent-browser --cdp 9222 a11y
agent-browser --cdp 9222 vitals
agent-browser --cdp 9222 --enable react-devtools react tree
```

HAR files can contain authorization headers and response bodies. Do not share them unredacted.

## Built-in skills

The binary ships version-matched skills:

```bash
agent-browser skills list
agent-browser skills get core --full
agent-browser skills get electron
agent-browser skills get dogfood
agent-browser skills get derive-client
agent-browser skills get webmcp-gen
agent-browser skills path core
```

`skills` subcommands are stateless and do not require a browser. They are the authoritative source for upstream behavior at the installed version. The same content is reachable through the native tool:

```json
{ "args": ["skills", "get", "core", "--full"] }
```

Prefer reading targeted sections. `core --full` is large.

## Common errors

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `command not found: agent-browser` | Extension not loaded, or temp dir not executable | Use `cdp_browser`; check `command -v agent-browser`; avoid `noexec` temp roots |
| `Failed to connect to CDP` | Endpoint wrong, Chrome not running with `--remote-debugging-port`, or tunnel down | `curl http://host:port/json/version`; restart Chrome with a dedicated `--user-data-dir` |
| `No active page` | No tab selected, or previous tab closed | `tab list`, `tab <id>`, then `snapshot -i` |
| `stale-ref` / element not found | Refs invalidated by navigation or rerender | Fresh `snapshot -i`, then use new refs |
| `selector-not-found` | CSS/semantic target absent or hidden | `snapshot -i`, `find` with role/text/label, or a more specific selector |
| Click succeeded but nothing happened | Event not handled, overlay, or wrong target | Check for overlays, re-snapshot, use `find`, or inspect with `eval --stdin` |
| `fill` appears to work but value is empty | Framework-controlled input | Focus the field, use `keyboard type`, verify with `get value` |
| `record` starts but no file | No `record stop`, or `ffmpeg` missing | Run `record stop`, verify `ffmpeg -version` |
| Screenshot reported but file absent | Relative path resolved against daemon cwd | Use an absolute path and verify with `test -s` |
| `tab_gone` | Bound tab was closed | `tab list` then `tab new <url>` or select another tab |
| `429` from a search API | Rate/plan limit | Stop and report; do not retry in a loop |
| `batch` stops early | `--bail` behavior | Split the batch or place recovery steps before risky rows |

When the native tool is available, `details.nextActions` usually contains the exact retry payload. Prefer it over guessing from prose.

## Mapping to `cdp_browser` parameters

The CLI token list maps to the tool's `args` array one-to-one:

```bash
agent-browser --cdp 9222 --json click @e3
```

```json
{ "args": ["click", "@e3"] }
```

The tool adds `--json`, the configured `--cdp`, and its managed session for you. Do **not** pass `--json` in `args`; the wrapper injects it.

CLI stdin maps to the tool's `stdin` field, and only for these shapes:

```json
{ "args": ["batch", "--bail"], "stdin": "[[\"open\",\"https://example.com\"]]" }
{ "args": ["eval", "--stdin"], "stdin": "document.title" }
{ "args": ["auth", "save", "name", "--password-stdin"], "stdin": "<secret>" }
```

`stdin` is rejected with `electron`, and it is not a general-purpose field for other modes.

Do not translate CLI global flags by hand when a top-level tool field exists:

| CLI | Tool field |
| --- | --- |
| `--session-mode` (not a real upstream flag) | `sessionMode: "auto" \| "fresh"` |
| `--json` | injected automatically |
| wrapper timeout | `timeoutMs` |
| durable result file | `outputPath` |
| seed for a fresh managed session | `sessionMode: "fresh"` |

## See also

- [Tool contract](TOOL_CONTRACT.md) — exact `cdp_browser` parameters and result fields
- [Command reference](COMMAND_REFERENCE.md) — full upstream command inventory
- [Architecture](ARCHITECTURE.md) — session, ref, and result design
- Upstream docs: <https://agent-browser.dev/>
- Upstream skills: `agent-browser skills list`
