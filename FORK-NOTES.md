# Fork notes

`cdp-browser` is a remote-only fork of
[fitchmultz/pi-agent-browser-native](https://github.com/fitchmultz/pi-agent-browser-native)
(based on upstream `v0.6.10`), maintained by [outmost9271](https://github.com/outmost9271).

## Goals

- Drive a **remote** Chrome over CDP only; never launch a local browser.
- Bundle the upstream `agent-browser` CLI so runtime does not depend on `PATH`,
  Docker, or a system-wide install.
- Stay fully isolated from the sibling `host-browser` / `pi-agent-browser-native`
  installation (tool name, env prefix, artifacts, daemon namespace/socket).

## Changes from upstream

### Vendored upstream CLI

`vendor/agent-browser/agent-browser-linux-x64` (agent-browser 0.37.1) is shipped
with the package plus `vendor/agent-browser/manifest.json` (source URL, size,
SHA256). All CLI invocations resolve the bundled binary by packaged path in
`extensions/agent-browser/lib/agent-browser-binary.ts`.

- The process layer accepts an explicit `cliPath`; orchestration code resolves the
  vendored binary and passes it down.
- `PI_CDP_BROWSER_BINARY` may override the path (tests, advanced setups).
- Auxiliary calls (version probe, daemon inspection, session state) use the same
  vendored path through `tryResolveAgentBrowserBinary()`.

### Remote CDP endpoint injection

New `extensions/agent-browser/lib/cdp-config.ts` resolves the endpoint from, in
order: per-call argv (`--cdp` / `connect`), project config
(`<cwd>/.pi/config/cdp-browser/config.json`), global config
(`~/.pi/config/cdp-browser/config.json`), with `PI_CDP_BROWSER_CDP_ENDPOINT` as an
explicit process override. An injection hook in `browser-run/index.ts` prepends
`--cdp <endpoint>` to browser-backed calls. Missing configuration fails the tool
with `validation-error`; no local fallback exists.

### Renamed for isolation

- Tool: `cdp_browser` (web-search companion keeps `cdp_browser_web_search`).
- Config paths: `.pi/config/cdp-browser/config.json` (global and project).
- Env prefix: `PI_CDP_BROWSER_*`; session prefixes `cdpb-*`; socket dir `/tmp/cdpb*`.
- Package name: `cdp-browser`; binaries: `cdp-browser-config`, `cdp-browser-doctor`.

### Retained from the previous fork

The script-mode sandbox worker resolves a real Node runtime before spawning
(`PI_CDP_BROWSER_SCRIPT_NODE`, fnm alias, `/usr/local/bin/node`, `/usr/bin/node`,
then `process.execPath`), fixing the Node SEA host case.

## License

MIT, see [LICENSE](LICENSE).
