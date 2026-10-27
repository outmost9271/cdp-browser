import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

import { resolveAgentBrowserBinary } from "./agent-browser-binary.js";

/**
 * Expose the vendored `agent-browser` binary on PATH for direct CLI use.
 *
 * The package binary is named per platform (for example `agent-browser-linux-x64`),
 * so a stable `agent-browser` entry point is generated in a private temporary
 * directory and prepended to the Pi process PATH. The shim only forwards argv to
 * the already-resolved binary; it adds no defaults, endpoint injection, or
 * session handling. Direct CLI calls therefore remain native upstream behavior.
 */

export const AGENT_BROWSER_CLI_SHIM_NAME = "agent-browser";
export const AGENT_BROWSER_CLI_SHIM_DIRECTORY_PREFIX = "cdp-browser-cli-";
export const AGENT_BROWSER_CLI_CMD_NAME = "agent-browser.cmd";

export interface AgentBrowserCliSetup {
	available: boolean;
	binaryPath?: string;
	error?: string;
	shimDir?: string;
}

export interface AgentBrowserCliOptions {
	binaryPath?: string;
	env?: NodeJS.ProcessEnv;
	platform?: NodeJS.Platform;
	tempRoot?: string;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export function getAgentBrowserShimDir(
	binaryPath: string,
	options: { platform?: NodeJS.Platform; tempRoot?: string } = {},
): string {
	const digest = createHash("sha256").update(binaryPath).digest("hex").slice(0, 16);
	const platform = options.platform ?? process.platform;
	const root = options.tempRoot ?? tmpdir();
	return join(root, `${AGENT_BROWSER_CLI_SHIM_DIRECTORY_PREFIX}${platform}-${digest}`);
}

/** Quote a value for a POSIX shell double-quoted string. */
function quotePosix(value: string): string {
	return `"${value.replace(/(["\\$`])/g, "\\$1")}"`;
}

export function buildAgentBrowserShimContent(
	binaryPath: string,
	platform: NodeJS.Platform = process.platform,
): { cmd?: string; posix: string } {
	const posix = `#!/bin/sh\nexec ${quotePosix(binaryPath)} "$@"\n`;
	if (platform !== "win32") return { posix };
	const cmd = `@echo off\r\n"${binaryPath.replace(/"/g, '""')}" %*\r\n`;
	return { cmd, posix };
}

async function writeExecutableIfChanged(path: string, content: string, mode: number): Promise<void> {
	try {
		const current = await readFile(path, "utf8");
		if (current === content) {
			await chmod(path, mode);
			return;
		}
	} catch {
		// Missing or unreadable shim: rewrite it below.
	}
	await writeFile(path, content, { encoding: "utf8", mode });
	await chmod(path, mode);
}

/**
 * Create (or refresh) the shim directory for the resolved binary.
 * Returns a structured failure instead of throwing so tool registration and
 * session startup are never broken by a missing binary or read-only temp root.
 */
export async function ensureAgentBrowserCliShim(options: AgentBrowserCliOptions = {}): Promise<AgentBrowserCliSetup> {
	let binaryPath: string;
	try {
		binaryPath = options.binaryPath ?? resolveAgentBrowserBinary({ env: options.env });
	} catch (error) {
		return { available: false, error: `cdp-browser: could not resolve the bundled agent-browser binary: ${errorMessage(error)}` };
	}
	const platform = options.platform ?? process.platform;
	const shimDir = getAgentBrowserShimDir(binaryPath, { platform, tempRoot: options.tempRoot });
	try {
		await mkdir(shimDir, { mode: 0o700, recursive: true });
		await chmod(shimDir, 0o700);
		const content = buildAgentBrowserShimContent(binaryPath, platform);
		await writeExecutableIfChanged(join(shimDir, AGENT_BROWSER_CLI_SHIM_NAME), content.posix, 0o755);
		if (content.cmd) {
			await writeExecutableIfChanged(join(shimDir, AGENT_BROWSER_CLI_CMD_NAME), content.cmd, 0o755);
		}
	} catch (error) {
		return {
			available: false,
			binaryPath,
			error: `cdp-browser: could not create the agent-browser CLI shim in ${shimDir}: ${errorMessage(error)}`,
		};
	}
	return { available: true, binaryPath, shimDir };
}

export function findPathKey(env: NodeJS.ProcessEnv = process.env): string {
	return Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "PATH";
}

/** Prepend one directory to a PATH value without duplicating it. */
export function prependPathEntry(
	directory: string,
	pathValue: string | undefined,
	pathDelimiter: string = delimiter,
): string {
	const entries = (pathValue ?? "").split(pathDelimiter).filter((entry) => entry.length > 0);
	if (entries.includes(directory)) return pathValue ?? "";
	return [directory, ...entries].join(pathDelimiter);
}

let cachedSetup: AgentBrowserCliSetup | undefined;
let pendingSetup: Promise<AgentBrowserCliSetup> | undefined;

/**
 * Ensure the CLI is reachable as `agent-browser` from Pi's bash tool.
 *
 * `getShellEnv()` rebuilds the child environment from `process.env` for every
 * command, so updating `process.env.PATH` here is sufficient and avoids
 * replacing the built-in bash tool (which other extensions may also wrap).
 */
export async function ensureAgentBrowserCliOnPath(options: AgentBrowserCliOptions = {}): Promise<AgentBrowserCliSetup> {
	if (cachedSetup?.available) return cachedSetup;
	if (pendingSetup) return await pendingSetup;
	pendingSetup = (async () => {
		const setup = await ensureAgentBrowserCliShim(options);
		if (!setup.available || !setup.shimDir) return setup;
		const env = options.env ?? process.env;
		const pathKey = findPathKey(env);
		env[pathKey] = prependPathEntry(setup.shimDir, env[pathKey], options.platform === "win32" ? ";" : delimiter);
		cachedSetup = setup;
		return setup;
	})();
	try {
		return await pendingSetup;
	} finally {
		pendingSetup = undefined;
	}
}

/** Test-only reset for the process-level installation cache. */
export function resetAgentBrowserCliPathCache(): void {
	cachedSetup = undefined;
}
