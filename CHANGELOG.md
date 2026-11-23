# Changelog

This file tracks only `cdp-browser` releases. See [Upstream changelog](UPSTREAM_CHANGELOG.md) for inherited `pi-agent-browser-native` release notes. Keep upstream version headings out of this file: Pi reads it to build the package's startup update notice.

## 0.2.1 - 2026-10-27

### Fixed

- Correct the direct CLI guide: `--headless` is not a global flag, `--timeout` is command-scoped, `--bail` belongs to `batch`, `find` supports `fill` rather than `type`, `--enable` is global, and storage reads use the generic form.
- Document that a project-level `autoload: false` filter must include `skills: ["+skills/cdp-browser"]` when the global package entry disables skills.

## 0.2.0 - 2026-10-27

### Added

- Expose the bundled binary on the Pi bash `PATH` as `agent-browser` through a private, idempotent shim directory. The shim forwards argv unchanged; it adds no endpoint, JSON, or session defaults.
- Ship a Pi skill, `cdp-browser`, with detailed references for tool parameter shapes, direct CLI use, and error recovery.
- Ship `docs/AGENT_BROWSER_CLI.md` covering PATH exposure, global options, command families, batch input, sessions, artifacts, state/auth, network diagnostics, common errors, and tool-to-CLI mapping.
- Register the skill through `pi.skills` so installing the package makes it discoverable.

### Changed

- Direct `agent-browser` bash calls are no longer blocked. The system prompt now prefers the native tool for structured results while documenting that the CLI is a supported direct surface.
- Add regression coverage for shim creation, PATH precedence, executable mode, skill and documentation packaging, and prompt guidance.

### Validation

- Build, typecheck, focused unit tests, and a real CLI smoke (`agent-browser --version`) against the packaged binary.

## 0.1.1 - 2026-10-27

### Changed

- Add always-on `cdp_browser` prompt guidance explaining CDP control and remote browser host boundaries: a non-local endpoint IP must not be treated as the Pi host's browser, localhost, filesystem, or desktop. Note that proxies and tunnels can obscure the actual browser host.
- Document the host distinction without changing endpoint routing or artifact storage behavior.

### Tests

- Cover the guidance with and without companion web search, in registered tool metadata, and in the compiled extension; retain a bounded prompt budget.
- Verified build, typecheck, 19 focused tests, command-reference baseline, package contents, and the actual Pi system prompt through RPC without model or browser calls.
- Full-suite and live-browser/platform checks were not run for this prompt-only change. The existing playbook-doc check remains blocked because this fork's README omits the upstream generated block markers.
