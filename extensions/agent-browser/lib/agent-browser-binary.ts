import { accessSync, chmodSync, constants, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Vendored upstream CLI resolution.
 *
 * The extension ships the prebuilt `agent-browser` binary inside
 * `vendor/agent-browser/` so runtime never depends on `PATH` or on a system-wide
 * install. The binary path is resolved relative to the packaged extension root.
 *
 * Test and advanced overrides may point `PI_CDP_BROWSER_BINARY` at another
 * executable; this is the only supported way to replace the bundled CLI.
 */

const BINARY_BY_PLATFORM: Readonly<Record<string, Readonly<Record<string, string>>>> = {
	linux: {
		x64: "agent-browser-linux-x64",
		arm64: "agent-browser-linux-arm64",
	},
	darwin: {
		x64: "agent-browser-darwin-x64",
		arm64: "agent-browser-darwin-arm64",
	},
	win32: {
		x64: "agent-browser-win32-x64.exe",
	},
};

const VENDOR_SEGMENTS = ["vendor", "agent-browser"] as const;

export const AGENT_BROWSER_BINARY_OVERRIDE_ENV = "PI_CDP_BROWSER_BINARY";

function findPackageRoot(startDir: string): string | undefined {
	let dir = startDir;
	for (let depth = 0; depth < 8; depth += 1) {
		if (existsSync(join(dir, "package.json")) && existsSync(join(dir, ...VENDOR_SEGMENTS))) {
			return dir;
		}
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return undefined;
}

export function getVendoredAgentBrowserFileName(platform: NodeJS.Platform = process.platform, arch: string = process.arch): string | undefined {
	return BINARY_BY_PLATFORM[platform]?.[arch];
}

export function resolveAgentBrowserBinary(options: {
	env?: NodeJS.ProcessEnv;
	platform?: NodeJS.Platform;
	arch?: string;
} = {}): string {	const env = options.env ?? process.env;
	const override = env[AGENT_BROWSER_BINARY_OVERRIDE_ENV]?.trim();
	if (override) {
		if (!existsSync(override)) {
			throw new Error(`cdp-browser: ${AGENT_BROWSER_BINARY_OVERRIDE_ENV} points at a missing file (ENOENT): ${override}`);
		}
		return override;
	}
	const platform = options.platform ?? process.platform;
	const arch = options.arch ?? process.arch;
	const fileName = getVendoredAgentBrowserFileName(platform, arch);
	if (!fileName) {
		throw new Error(`cdp-browser: no vendored agent-browser binary for ${platform}/${arch}. This bundle only ships the locally packaged platform.`);
	}
	const root = findPackageRoot(dirname(fileURLToPath(import.meta.url)));
	if (!root) {
		throw new Error("cdp-browser: could not locate the package root relative to the extension bundle (vendor/agent-browser).");
	}
	const binary = join(root, ...VENDOR_SEGMENTS, fileName);
	if (!existsSync(binary)) {
		throw new Error(`cdp-browser: missing vendored binary (ENOENT): ${binary}. Reinstall the package.`);
	}
	try {
		accessSync(binary, constants.X_OK);
	} catch {
		try {
			chmodSync(binary, 0o755);
		} catch {
			throw new Error(`cdp-browser: vendored binary is not executable and could not be fixed: ${binary}`);
		}
	}
	return binary;
}

/** Best-effort resolution for auxiliary/internal CLI calls; undefined means "fall back to PATH". */
export function tryResolveAgentBrowserBinary(options: {
	env?: NodeJS.ProcessEnv;
	platform?: NodeJS.Platform;
	arch?: string;
} = {}): string | undefined {
	try {
		return resolveAgentBrowserBinary(options);
	} catch {
		return undefined;
	}
}
