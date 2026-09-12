# Fork notes

This repository is a maintenance fork of
[fitchmultz/pi-agent-browser-native](https://github.com/fitchmultz/pi-agent-browser-native),
based on upstream `v0.6.10`.

## Changes

### Renamed to `host-browser`

The fork was renamed from `pi-agent-browser-native` to `host-browser` so the name reflects the
local (on-host) browser and no longer reads as an upstream `pi-agent` mirror:

- GitHub repository: `outmost9271/host-browser`
- `package.json` `name`: `host-browser`
- package bins: `host-browser-config`, `host-browser-doctor`
- package config paths: `.pi/config/host-browser/config.json` (global and project)
- local state prefixes: `host-browser-*` / `.host-browser-*`

Stable internal identifiers intentionally kept: the `agent_browser` tool name, `AGENT_BROWSER_*`
environment variables, `PI_AGENT_BROWSER_CONFIG`, `PI_AGENT_BROWSER_ALLOW_DIRECT_BASH`,
`PIAB_SCRIPT_NODE`, `piab-script-*` session names, and the `-piab.<n>` release-tag suffix.

### Resolve a real Node runtime for the script sandbox worker

Upstream `script` mode starts its sandbox worker with `spawn(process.execPath, ...)`. When the
host Pi is a Node single executable application (SEA), `process.execPath` points at the Pi binary
instead of a Node runtime, so the worker never signals `ready` and every `script` call runs until
it times out.

This fork resolves the worker runtime before spawning:

1. `PIAB_SCRIPT_NODE` when it points at an executable file;
2. `process.execPath` when its basename already is `node`/`nodejs` (no behavior change for
   regular Node hosts);
3. `/pi/node/tool/fnm/aliases/default/bin/node`, then `/usr/local/bin/node`, then `/usr/bin/node`;
4. fallback to `process.execPath`.

The runtime change is limited to `extensions/agent-browser/lib/input-modes/script.ts`.

## Installing this fork

```bash
pi install git:github.com/outmost9271/host-browser@v0.6.10-piab.2
```

## License

MIT, see [LICENSE](LICENSE).
