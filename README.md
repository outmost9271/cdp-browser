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

`scripts/windows/start-ungoogled-cdp.vbs` launches a Windows
ungoogled-chromium (or any Chromium build) from its own folder with a remote
CDP endpoint enabled. Copy it next to `chrome.exe`, review the `CDP_PORT` /
`CDP_ADDRESS` constants at the top, then run it.

Key points:

- It keeps a dedicated `UserData` folder; Chrome 136+ ignores
  `--remote-debugging-port` when the default profile directory is used.
- Fully quit existing `chrome.exe` processes for that profile before running it,
  otherwise the new flags are ignored by the already-running instance.
- The endpoint is reachable as `http://<windows-ip>:<CDP_PORT>`; verify with
  `curl http://<windows-ip>:9222/json/version` and use that URL as the
  `cdp.endpoint` in the config above.
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
