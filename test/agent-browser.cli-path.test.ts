/**
 * Purpose: Verify the direct agent-browser CLI PATH shim used by the cdp-browser extension.
 * Responsibilities: Assert shim content, executable modes, idempotent writes, PATH deduplication, and structured failure handling.
 * Scope: Unit-style coverage for extensions/agent-browser/lib/agent-browser-path.ts; no real browser or upstream command runs.
 * Usage: Run with `npx tsx --test test/agent-browser.cli-path.test.ts` or via `npm run verify`.
 * Invariants/Assumptions: Tests use isolated temp directories and restore process.env.PATH after mutating it.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmod, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import test from "node:test";

import {
	AGENT_BROWSER_CLI_CMD_NAME,
	AGENT_BROWSER_CLI_SHIM_DIRECTORY_PREFIX,
	AGENT_BROWSER_CLI_SHIM_NAME,
	buildAgentBrowserShimContent,
	ensureAgentBrowserCliOnPath,
	ensureAgentBrowserCliShim,
	getAgentBrowserShimDir,
	prependPathEntry,
	resetAgentBrowserCliPathCache,
} from "../extensions/agent-browser/lib/agent-browser-path.js";

async function writeFakeBinary(directory: string, name = "agent-browser-fake"): Promise<string> {
	const binaryPath = join(directory, name);
	await mkdir(dirname(binaryPath), { recursive: true });
	await writeFile(binaryPath, "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then echo 'agent-browser fake-version'; else echo fake; fi\n", "utf8");
	await chmod(binaryPath, 0o755);
	return binaryPath;
}

test("buildAgentBrowserShimContent quotes the binary and forwards argv", () => {
	const { posix } = buildAgentBrowserShimContent('/opt/my "tools"/agent-browser');
	assert.match(posix, /^#!\/bin\/sh\n/);
	assert.match(posix, /exec ".*agent-browser" "\$@"\n$/);
	assert.match(posix, /\\"tools\\"/);

	const windows = buildAgentBrowserShimContent("C:\\Tools\\agent-browser.exe", "win32");
	assert.equal(windows.cmd, '@echo off\r\n"C:\\Tools\\agent-browser.exe" %*\r\n');
	assert.match(windows.posix, /agent-browser\.exe/);

	assert.equal(buildAgentBrowserShimContent("/bin/agent-browser", "linux").cmd, undefined);
});

test("getAgentBrowserShimDir is stable per binary and isolated per platform", () => {
	const first = getAgentBrowserShimDir("/a/agent-browser", { platform: "linux", tempRoot: "/tmp" });
	assert.equal(first, getAgentBrowserShimDir("/a/agent-browser", { platform: "linux", tempRoot: "/tmp" }));
	assert.notEqual(first, getAgentBrowserShimDir("/b/agent-browser", { platform: "linux", tempRoot: "/tmp" }));
	assert.notEqual(first, getAgentBrowserShimDir("/a/agent-browser", { platform: "darwin", tempRoot: "/tmp" }));
	assert.ok(first.includes(AGENT_BROWSER_CLI_SHIM_DIRECTORY_PREFIX));
});

test("prependPathEntry adds once and preserves existing entries", () => {
	assert.equal(prependPathEntry("/shim", "/usr/bin:/bin"), `/shim${delimiter}/usr/bin:/bin`);
	assert.equal(prependPathEntry("/shim", `/shim${delimiter}/usr/bin`), `/shim${delimiter}/usr/bin`);
	assert.equal(prependPathEntry("/shim", ""), "/shim");
	assert.equal(prependPathEntry("/shim", undefined), "/shim");
});

test("ensureAgentBrowserCliShim writes an executable POSIX shim idempotently", { skip: process.platform === "win32" }, async () => {
	const tempDir = await mkdtempForTest("cdp-browser-cli-shim-");
	try {
		const binaryPath = await writeFakeBinary(tempDir);
		const first = await ensureAgentBrowserCliShim({ binaryPath, platform: "linux", tempRoot: tempDir });
		assert.equal(first.available, true);
		assert.ok(first.shimDir);
		const shimPath = join(first.shimDir, AGENT_BROWSER_CLI_SHIM_NAME);
		const content = await readFile(shimPath, "utf8");
		assert.match(content, /exec "/);
		assert.equal((await stat(shimPath)).mode & 0o777, 0o755);
		assert.equal((await stat(first.shimDir)).mode & 0o777, 0o700);

		const output = execFileSync(shimPath, ["--version"], { encoding: "utf8" }).trim();
		assert.equal(output, "agent-browser fake-version");

		const second = await ensureAgentBrowserCliShim({ binaryPath, platform: "linux", tempRoot: tempDir });
		assert.equal(second.shimDir, first.shimDir);
		assert.equal(await readFile(shimPath, "utf8"), content);
	} finally {
		await rm(tempDir, { recursive: true, force: true });
	}
});

test("ensureAgentBrowserCliShim writes both Windows entry points", async () => {
	const tempDir = await mkdtempForTest("cdp-browser-cli-win-");
	try {
		const binaryPath = await writeFakeBinary(tempDir, "agent-browser.exe");
		const setup = await ensureAgentBrowserCliShim({ binaryPath, platform: "win32", tempRoot: tempDir });
		assert.equal(setup.available, true);
		assert.ok(setup.shimDir);
		assert.match(await readFile(join(setup.shimDir, AGENT_BROWSER_CLI_CMD_NAME), "utf8"), /agent-browser\.exe/);
		assert.match(await readFile(join(setup.shimDir, AGENT_BROWSER_CLI_SHIM_NAME), "utf8"), /agent-browser\.exe/);
	} finally {
		await rm(tempDir, { recursive: true, force: true });
	}
});

test("ensureAgentBrowserCliOnPath prepends the shim once and reuses the cache", { skip: process.platform === "win32" }, async () => {
	const tempDir = await mkdtempForTest("cdp-browser-cli-path-");
	const originalPath = process.env.PATH;
	try {
		const binaryPath = await writeFakeBinary(tempDir);
		resetAgentBrowserCliPathCache();
		const first = await ensureAgentBrowserCliOnPath({ binaryPath, tempRoot: tempDir });
		assert.equal(first.available, true);
		assert.ok(first.shimDir);
		assert.equal(process.env.PATH?.split(delimiter)[0], first.shimDir);
		assert.equal(execFileSync("agent-browser", ["--version"], { encoding: "utf8" }).trim(), "agent-browser fake-version");

		const second = await ensureAgentBrowserCliOnPath({ binaryPath, tempRoot: tempDir });
		assert.equal(second.shimDir, first.shimDir);
		const occurrences = (process.env.PATH ?? "").split(delimiter).filter((entry) => entry === first.shimDir);
		assert.equal(occurrences.length, 1);
	} finally {
		if (originalPath === undefined) delete process.env.PATH;
		else process.env.PATH = originalPath;
		resetAgentBrowserCliPathCache();
		await rm(tempDir, { recursive: true, force: true });
	}
});

test("ensureAgentBrowserCliOnPath reports a structured failure when the binary is missing", async () => {
	const env = { PATH: process.env.PATH, PI_CDP_BROWSER_BINARY: join(tmpdir(), "cdp-browser-missing-binary") };
	const setup = await ensureAgentBrowserCliOnPath({ env });
	assert.equal(setup.available, false);
	assert.match(setup.error ?? "", /missing file|ENOENT/i);
	assert.equal(env.PATH, process.env.PATH);
});

async function mkdtempForTest(prefix: string): Promise<string> {
	const { mkdtemp } = await import("node:fs/promises");
	return await mkdtemp(join(tmpdir(), prefix));
}
