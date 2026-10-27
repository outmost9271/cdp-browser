/**
 * Purpose: Guard the packaged skill and direct-CLI guide from drifting out of the published package.
 * Responsibilities: Assert manifest wiring, skill frontmatter, required references, and key documentation sections.
 * Scope: Static package-content checks; no browser, model, or network access.
 * Usage: Run with `npx tsx --test test/agent-browser.package-skill.test.ts` or via `npm run verify`.
 * Invariants/Assumptions: Paths resolve from the repository root, matching npm packaging boundaries.
 */

import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

const SKILL_DIR = join("skills", "cdp-browser");

test("package manifest declares the skill and ships its files", async () => {
	const pkg = JSON.parse(await readFile("package.json", "utf8")) as {
		files?: string[];
		pi?: { extensions?: string[]; skills?: string[] };
		version?: string;
	};
	assert.deepEqual(pkg.pi?.skills, ["./skills"]);
	assert.ok(pkg.pi?.extensions?.includes("./dist/extensions/agent-browser/index.js"));
	assert.ok(pkg.files?.includes("skills"));
	assert.ok(pkg.files?.includes("docs/AGENT_BROWSER_CLI.md"));
	assert.match(pkg.version ?? "", /^0\.2\.\d+$/);
});

test("skill frontmatter routes browser work and covers every tool mode", async () => {
	const skill = await readFile(join(SKILL_DIR, "SKILL.md"), "utf8");
	assert.match(skill, /^---\nname: cdp-browser\n/);
	assert.match(skill, /\ndescription: .{20,}/);
	for (const mode of ["args", "job", "qa", "semanticAction", "script", "electron"]) {
		assert.ok(skill.includes(mode), `skill must mention ${mode}`);
	}
	for (const command of ["agent-browser --cdp", "snapshot -i", "close"]) {
		assert.ok(skill.includes(command), `skill must mention ${command}`);
	}
	assert.match(skill, /只选一个|exactly one/i);
	assert.match(skill, /stale-ref/);
	assert.match(skill, /端点 IP 不是 Pi 主机地址/);
});

test("skill references and CLI guide are present and complete", async () => {
	for (const reference of ["tool-parameters.md", "cli-direct-use.md", "error-catalog.md"]) {
		const path = join(SKILL_DIR, "references", reference);
		assert.equal((await stat(path)).isFile(), true, `missing ${reference}`);
		assert.ok((await readFile(path, "utf8")).length > 1_000, `${reference} is too thin`);
	}

	const cli = await readFile("docs/AGENT_BROWSER_CLI.md", "utf8");
	for (const section of [
		"## How PATH exposure works",
		"## Global options",
		"## Core loop and refs",
		"## Batch execution",
		"## Common errors",
		"## Mapping to `cdp_browser` parameters",
	]) {
		assert.ok(cli.includes(section), `missing CLI guide section: ${section}`);
	}
	assert.match(cli, /agent-browser --version/);
	assert.match(cli, /--cdp/);
	assert.match(cli, /--session/);
});
