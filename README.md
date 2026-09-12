# cdp-browser

A Pi extension that drives a **remote Chrome over CDP** as a native `cdp_browser` tool.

This is a remote-only fork of [`pi-agent-browser-native`](https://github.com/fitchmultz/pi-agent-browser-native): the extension bundles a prebuilt upstream [`agent-browser`](https://agent-browser.dev/) CLI (v0.37.1, Linux x64) inside `vendor/agent-browser/` and spawns it by its packaged path instead of resolving `agent-browser` from `PATH`. No local browser, no Docker bridge, no system-wide CLI install.

## Requirements

| Dependency | Notes |
| --- | --- |
| Pi ≥ 0.84.0 | Pi provides the `@earendil-works/pi-*` peer packages |
| Node ≥ 22.19 | Host runtime for the extension |
| Remote Chrome with DevTools enabled | `chrome --remote-debugging-port=9222 --user-data-dir=<dir>` |
| `ffmpeg` | Optional; only for `record` video capture (on the CLI host) |

Bundled binary: `vendor/agent-browser/agent-browser-linux-x64` (agent-browser 0.37.1, SHA256 recorded in `vendor/agent-browser/manifest.json`).

## Install

```bash
pi install git:github.com/outmost9271/cdp-browser@v0.1.0
```

Fully quit and restart Pi after installing or upgrading.

## Configure the remote endpoint

Resolution order (highest priority first):

1. Per-call argv — `--cdp <url|port>` or the `connect <url|port>` command.
2. Project config — `<cwd>/.pi/config/cdp-browser/config.json`.
3. Global config — `~/.pi/config/cdp-browser/config.json`.

```json
{
  "version": 1,
  "cdp": {
    "endpoint": "http://192.168.1.10:9222"
  }
}
```

Accepted endpoint forms: `http://host:port`, `ws://host:port/devtools/browser/<id>`, or a bare port. Browser-backed calls without any endpoint fail with `validation-error` instead of starting a local browser.

Security: the CDP port has no authentication. Prefer an SSH tunnel (`ssh -N -L 9222:127.0.0.1:9222 user@remote`) and configure `http://127.0.0.1:9222`; never expose the port to untrusted networks.

## Usage

```json
{ "args": ["open", "https://example.com"] }
{ "args": ["snapshot", "-i"] }
{ "args": ["click", "@e2"] }
{ "args": ["eval", "--stdin"], "stdin": "document.title" }
```

Typical flow: `open` → `snapshot -i` → act on current `@refs` → re-snapshot after navigation. Use `connect http://host:9222` once, verify with `get url`, then keep using the same session.

## Remote Windows Chromium helper

`scripts/windows/start-ungoogled-cdp.vbs` starts a Windows Chromium build
(ungoogled-chromium and friends) from its own folder with a local CDP endpoint,
and — when `gost.exe` is present next to it — also exposes that endpoint to the
LAN for a configured lifetime:

```
LAN  0.0.0.0:9223 (gost, optional)  ->  127.0.0.1:9222 (Chromium DevTools)
```

Setup:

1. Copy the script next to `chrome.exe` (it uses `<script dir>\UserData` as the
   dedicated profile) and run it.
2. For LAN access, download **gost v3.3.0** (single static binary, no runtime
   dependencies) from <https://github.com/go-gost/gost/releases>:
   `gost_3.3.0_windows_amd64.zip`,
   SHA256 `cc8ac946f86994a3aed47ef1f838cfb6b7649d9245c91fcb9899654b33d61170`.
   Unzip `gost.exe` next to the script. Ports live in the `CDP_PORT` /
   `FORWARD_PORT` constants at the top of the script.

The script owns the full lifecycle: it starts Chromium, waits for the debug
port owner, starts the hidden `gost.exe` forwarder, then keeps watching that
browser process and terminates the forwarder as soon as the browser fully
exits. Without `gost.exe` it still works, but only `127.0.0.1:9222` is
reachable.

Notes:

- Current Chromium builds always bind DevTools to `127.0.0.1`
  (`--remote-debugging-address` is ignored) — that is why the forwarder exists.
- Keep `--user-data-dir` dedicated; Chrome 136+ ignores
  `--remote-debugging-port` with the default profile directory.
- Fully quit every `chrome.exe` of that profile before starting; an already
  running instance keeps its old command line and never opens the debug port.
- Verify from the LAN with `curl http://<windows-ip>:9223/json/version` and use
  that URL as `cdp.endpoint`. If Chrome advertises `ws://127.0.0.1:...` in the
  version payload, pass the explicit
  `ws://<windows-ip>:<FORWARD_PORT>/devtools/browser/<id>` instead.
- CDP has no authentication and grants full control of the browser profile.
  Restrict the port with a firewall rule or tunnel when the network is shared.

## Differences from upstream pi-agent-browser-native

- Tool name is `cdp_browser` (not `agent_browser`), so both packages can coexist.
- The upstream CLI is **vendored** and spawned by packaged path; `PATH`, Docker, and local browser installs are not used.
- Every browser-backed call gets the configured `--cdp <endpoint>` injected unless the call already selects a connection (`--cdp`, `connect`, `--auto-connect`, `--provider`, `-p`).
- Local-only flags such as `--headed` intentionally operate against the remote browser; the extension never launches a local Chrome.
- State/daemon isolation: separate artifacts directory (`.cdp-browser-artifacts`), env prefix (`PI_CDP_BROWSER_*`), and socket directory (`/tmp/cdpb*`), so it can run alongside `host-browser` / `pi-agent-browser-native`.
- Advanced overrides: `PI_CDP_BROWSER_BINARY` (replace the bundled CLI path) and `PI_CDP_BROWSER_CDP_ENDPOINT` (endpoint override for this process).

## Development

```bash
npm install          # installs dev dependencies and builds dist/
npm run build
npm test             # full suite (some upstream-host failures exist in the baseline)
```

The upstream CLI is shipped per platform. This release only bundles `linux-x64`; extend `BINARY_BY_PLATFORM` in `extensions/agent-browser/lib/agent-browser-binary.ts` and `vendor/agent-browser/` for more platforms.

## License

MIT — see [LICENSE](LICENSE). Upstream `agent-browser` is distributed by its own project; the bundled binary keeps its original license terms.
