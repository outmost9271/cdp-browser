import { parseArgvDescriptor } from "./argv-descriptor.js";
import { needsManagedSession } from "./command-policy.js";
import { loadAgentBrowserConfigSync } from "./config.js";

/**
 * Remote CDP endpoint configuration for cdp-browser.
 *
 * Resolution order (highest priority first):
 * 1. Explicit per-call argv: `--cdp <url|port>` or the `connect <url|port>` command.
 * 2. Project config: `<cwd>/.pi/config/cdp-browser/config.json` -> `cdp.endpoint`.
 * 3. Global config: `~/.pi/config/cdp-browser/config.json` -> `cdp.endpoint`.
 *
 * The bundled browser never launches locally: when no endpoint is configured,
 * browser-backed calls fail with an actionable error instead of falling back to
 * a local Chrome.
 */

export interface CdpEndpointConfig {
	endpoint?: string;
	timeoutMs?: number;
	globalConfigPath: string;
	projectConfigPath: string;
	errors: string[];
}

export const CDP_ENDPOINT_OVERRIDE_ENV = "PI_CDP_BROWSER_CDP_ENDPOINT";

const INSPECTION_FLAGS = new Set(["--help", "-h", "--version", "-V"]);

export function getCdpEndpointConfig(options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): CdpEndpointConfig {
	const state = loadAgentBrowserConfigSync({ cwd: options.cwd, env: options.env });
	const envOverride = options.env?.[CDP_ENDPOINT_OVERRIDE_ENV]?.trim();
	return {
		endpoint: envOverride || state.config.cdp?.endpoint?.trim() || undefined,
		timeoutMs: state.config.cdp?.timeoutMs,
		globalConfigPath: state.paths.global,
		projectConfigPath: state.paths.project,
		errors: state.errors,
	};
}

export function hasExplicitCdpTarget(args: readonly string[]): boolean {
	for (const token of args) {
		if (token === "--cdp" || token.startsWith("--cdp=")) return true;
	}
	if (args.includes("-p") || hasFlagToken(args, "--auto-connect") || hasFlagToken(args, "--provider")) return true;
	const descriptor = parseArgvDescriptor([...args]);
	return descriptor.commandInfo.command === "connect";
}

function hasFlagToken(tokens: readonly string[], flag: string): boolean {
	return tokens.some((token) => token === flag || token.startsWith(`${flag}=`));
}

export interface CdpArgvInjection {
	args: string[];
	error?: string;
}

/**
 * Inject the configured remote CDP endpoint into browser-backed argv.
 * Sessionless commands (help/version/doctor/skills/...) and explicit per-call
 * targets are left untouched.
 */
export function injectRemoteCdpArgs(args: string[], options: { cwd: string; env?: NodeJS.ProcessEnv }): CdpArgvInjection {
	const descriptor = parseArgvDescriptor(args);
	if (!needsManagedSession(descriptor)) return { args };
	if (args.some((token) => INSPECTION_FLAGS.has(token))) return { args };
	if (hasExplicitCdpTarget(args)) return { args };
	const config = getCdpEndpointConfig({ cwd: options.cwd, env: options.env });
	if (config.errors.length > 0) {
		return { args, error: `cdp-browser configuration is invalid: ${config.errors[0]}` };
	}
	if (!config.endpoint) {
		return {
			args,
			error: `cdp-browser: no remote CDP endpoint configured. Set "cdp": { "endpoint": "http://<host>:<port>" } in ${config.globalConfigPath} (global) or ${config.projectConfigPath} (project), or pass --cdp <url|port> / connect <url|port> for a single call.`,
		};
	}
	return { args: ["--cdp", config.endpoint, ...args] };
}
