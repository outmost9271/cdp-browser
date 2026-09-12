import { runAgentBrowserProcess, withAttachedBrowserSessionContext } from "../../process.js";
import { resolveAgentBrowserBinary } from "../../agent-browser-binary.js";
import { injectRemoteCdpArgs } from "../../cdp-config.js";
import { buildAgentBrowserResultCategoryDetails } from "../../results/categories.js";
import { isRecord } from "../../parsing.js";
import { withOwnedManagedSessionContext } from "../../managed-session-restore.js";
import { cleanupClickDispatchProbe } from "./click-dispatch.js";
import { applyBrowserRunStatePatch, getSessionContextKey } from "./session-state.js";
import { buildMissingBinaryFailureResult } from "./final-result.js";
import { prepareBrowserRun } from "./prepare.js";
import { processBrowserOutput } from "./process-output.js";
import type { AgentBrowserToolResult, BrowserRunOptions } from "./types.js";

export { closeManagedSession } from "./managed-session-daemon-policy.js";
export { getSessionContextKey } from "./session-state.js";
export type { AgentBrowserToolResult, BrowserRunOptions, BrowserRunState, TraceOwner } from "./types.js";

function buildRemoteCdpFailureResult(args: string[], errorText: string): AgentBrowserToolResult {
	return {
		content: [{ type: "text", text: errorText }],
		details: {
			args,
			...buildAgentBrowserResultCategoryDetails({ args, errorText, succeeded: false, validationError: errorText }),
			validationError: errorText,
		},
		isError: true,
	};
}

export async function runAgentBrowserTool(options: BrowserRunOptions): Promise<AgentBrowserToolResult> {
	const result = await withAttachedBrowserSessionContext(options.preserveAttachedBrowserSession === true, () => runAgentBrowserToolInContext(options));
	const details = isRecord(result.details) ? result.details : undefined;
	const sessionKey = getSessionContextKey(typeof details?.sessionName === "string" ? details.sessionName : undefined, typeof details?.namespace === "string" ? details.namespace : undefined);
	const page = options.state.sessionPageState.get(sessionKey);
	return page.tabReopenPending === undefined ? result : {
		...result,
		details: { ...details, sessionTabReopenPending: page.tabReopenPending, ...(page.refSnapshotInvalidation ? { refSnapshotInvalidation: page.refSnapshotInvalidation } : {}) },
	};
}

async function runAgentBrowserToolInContext(options: BrowserRunOptions): Promise<AgentBrowserToolResult> {
	const preparedResult = await prepareBrowserRun(options);
	applyBrowserRunStatePatch(options.state, preparedResult.kind === "ready" ? preparedResult.prepared.statePatch : preparedResult.statePatch);
	if (preparedResult.kind === "early-result") {
		return preparedResult.result;
	}

	const { prepared } = preparedResult;
	const ownedManagedSession = prepared.ownedManagedSessionContext;
	return await withOwnedManagedSessionContext(ownedManagedSession, async () => {
		try {
			const artifactRunStartedAtMs = Date.now();
			const cdpInjection = injectRemoteCdpArgs(prepared.processArgs, { cwd: options.cwd, env: process.env });
			if (cdpInjection.error) {
				return buildRemoteCdpFailureResult(prepared.redactedArgs, cdpInjection.error);
			}
			let agentBrowserCliPath: string;
			try {
				agentBrowserCliPath = resolveAgentBrowserBinary();
			} catch (binaryError) {
				const binaryMessage = binaryError instanceof Error ? binaryError.message : String(binaryError);
				const missingResult = await buildMissingBinaryFailureResult({
					compatibilityWorkaround: prepared.compatibilityWorkaround,
					electronLaunch: prepared.electronLaunch,
					executionPlan: prepared.executionPlan,
					implicitSessionCloseTimeoutMs: options.implicitSessionCloseTimeoutMs,
					managedSessionActive: options.state.managedSessionActive,
					managedSessionName: options.state.managedSessionName,
					managedSessionNamespace: options.state.managedSessionNamespace,
					processResult: {
						aborted: false,
						agentBrowserStarted: false,
						exitCode: 127,
						spawnError: Object.assign(new Error(binaryMessage), { code: "ENOENT" }),
						stderr: "",
						stdout: "",
						timedOut: false,
					},
					redactedArgs: prepared.redactedArgs,
					redactedProcessArgs: prepared.redactedProcessArgs,
					sessionMode: prepared.sessionMode,
					sessionTabCorrection: prepared.sessionTabCorrection,
				});
				return missingResult ?? buildRemoteCdpFailureResult(prepared.redactedArgs, binaryMessage);
			}
			const processResult = await runAgentBrowserProcess({
				args: cdpInjection.args,
				cliPath: agentBrowserCliPath,
				cwd: options.cwd,
				env: ownedManagedSession
					? { AGENT_BROWSER_IDLE_TIMEOUT_MS: options.implicitSessionIdleTimeoutMs }
					: undefined,
				managedSessionRestoreState: options.state.managedSessionRestoreState,
				managedStateCurrentPageUrl: prepared.priorSessionTabTarget?.url,
				managedStatePageUrlUnknown: prepared.priorSessionTabTargetUnknown === true,
				ownedManagedSession: ownedManagedSession !== undefined,
				signal: options.signal,
				stdin: prepared.processStdin,
				timeoutMs: prepared.processTimeoutMs,
			});

			const missingBinaryResult = await buildMissingBinaryFailureResult({
				compatibilityWorkaround: prepared.compatibilityWorkaround,
				electronLaunch: prepared.electronLaunch,
				executionPlan: prepared.executionPlan,
				implicitSessionCloseTimeoutMs: options.implicitSessionCloseTimeoutMs,
				managedSessionActive: options.state.managedSessionActive,
				managedSessionName: options.state.managedSessionName,
				managedSessionNamespace: options.state.managedSessionNamespace,
				processResult,
				redactedArgs: prepared.redactedArgs,
				redactedProcessArgs: prepared.redactedProcessArgs,
				sessionMode: prepared.sessionMode,
				sessionTabCorrection: prepared.sessionTabCorrection,
			});
			if (missingBinaryResult) return missingBinaryResult;

			const output = await processBrowserOutput({ ...options, artifactRunStartedAtMs, prepared, processResult });
			applyBrowserRunStatePatch(options.state, output.statePatch);
			return output.result;
		} finally {
			try {
				await cleanupClickDispatchProbe({
					cwd: options.cwd,
					namespace: prepared.executionPlan.namespace,
					probe: prepared.clickDispatchProbe,
					sessionName: prepared.executionPlan.sessionName,
				});
			} finally {
				await prepared.managedSessionPolicyLock?.release();
			}
		}
	});
}
