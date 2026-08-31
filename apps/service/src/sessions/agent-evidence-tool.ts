import { defineOutput, defineTool, type AgentTool, type JsonObject } from "@vraxis/agent-v";
import type {
  ApprovalSummary,
  BrowserSessionSummary,
  TerminalRunSummary,
  VerificationRunSummary,
  VerificationHandoffSummary,
} from "@vraxis/code-contracts";

interface SessionEvidenceSources {
  sessionId: string;
  approvals: { list(sessionId?: string): Promise<ApprovalSummary[]> };
  terminal: { list(sessionId?: string): Promise<TerminalRunSummary[]> };
  verifications: {
    list(sessionId?: string): Promise<VerificationRunSummary[]>;
    listHandoffs?(sessionId?: string): Promise<VerificationHandoffSummary[]>;
  };
  browser?: { state(sessionId: string): Promise<BrowserSessionSummary | undefined> };
}

const emptyInput = defineOutput<Record<string, never>>({
  name: "vraxis-evidence-status-input",
  description: "No input is required. Evidence is scoped to the current task by the host.",
  jsonSchema: { type: "object", properties: {}, additionalProperties: false },
  parse(value) {
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length) {
      throw new TypeError("Evidence status input must be an empty object.");
    }
    return {};
  },
});

const evidenceOutput = defineOutput<JsonObject>({
  name: "vraxis-evidence-status-output",
  jsonSchema: {
    type: "object",
    properties: {
      kind: { const: "vraxis.session-evidence-status" },
      sessionId: { type: "string" },
      generatedAt: { type: "string" },
      summary: { type: "object" },
      approvals: { type: "array", items: { type: "object" } },
      terminalRuns: { type: "array", items: { type: "object" } },
      verifications: { type: "array", items: { type: "object" } },
      verificationHandoffs: { type: "array", items: { type: "object" } },
      browser: { type: ["object", "null"] },
    },
    required: ["kind", "sessionId", "generatedAt", "summary", "approvals", "terminalRuns", "verifications", "verificationHandoffs", "browser"],
    additionalProperties: false,
  },
  parse(value) {
    const record = value as Record<string, unknown>;
    if (record?.kind !== "vraxis.session-evidence-status" || typeof record.sessionId !== "string") {
      throw new TypeError("Session evidence status is invalid.");
    }
    return record as JsonObject;
  },
});

/**
 * Publishes a bounded, read-only index of evidence already retained by the
 * product. Raw commands, output, approval scope, page content, URLs, and
 * credentials never cross this tool boundary.
 */
export function createAgentEvidenceTool(sources: SessionEvidenceSources): AgentTool<Record<string, never>, JsonObject> {
  return defineTool({
    name: "evidence-status",
    version: "1.0.0",
    description: "Inspect the current task's retained approval, terminal, verification, and browser evidence status without reading raw sensitive content.",
    input: emptyInput,
    output: evidenceOutput,
    requiresApproval: false,
    risk: "read",
    sideEffect: "none",
    requiredPermissions: [],
    timeoutMs: 5_000,
    async execute() {
      const [approvals, terminalRuns, verifications, verificationHandoffs, browser] = await Promise.all([
        sources.approvals.list(sources.sessionId),
        sources.terminal.list(sources.sessionId),
        sources.verifications.list(sources.sessionId),
        sources.verifications.listHandoffs?.(sources.sessionId) ?? Promise.resolve([]),
        sources.browser?.state(sources.sessionId),
      ]);
      const failedChecks = verifications.flatMap((run) => run.checks).filter((check) => check.state === "failed").length;
      return {
        kind: "vraxis.session-evidence-status",
        sessionId: sources.sessionId,
        generatedAt: new Date().toISOString(),
        summary: {
          approvalCount: approvals.length,
          unresolvedApprovalCount: approvals.filter((item) => item.state === "pending" || item.state === "approved" || item.state === "executing").length,
          terminalRunCount: terminalRuns.length,
          verificationRunCount: verifications.length,
          pendingVerificationHandoffCount: verificationHandoffs.filter((item) => item.state === "requested").length,
          failedCheckCount: failedChecks,
          browserActionCount: browser?.actions.length ?? 0,
        },
        approvals: approvals.map((item) => ({
          id: item.id,
          capability: item.capability,
          risk: item.risk,
          state: item.state,
          source: item.source,
        })),
        terminalRuns: terminalRuns.map((item) => ({
          id: item.id,
          status: item.status,
          ...(item.exitCode === undefined ? {} : { exitCode: item.exitCode }),
          ...(item.durationMs === undefined ? {} : { durationMs: item.durationMs }),
        })),
        verifications: verifications.map((run) => ({
          id: run.id,
          state: run.state,
          checks: run.checks.map((check) => ({ id: check.id, state: check.state })),
          browserState: run.browserState,
        })),
        verificationHandoffs: verificationHandoffs.map((handoff) => ({
          id: handoff.id,
          state: handoff.state,
          ...(handoff.verificationRunId ? { verificationRunId: handoff.verificationRunId } : {}),
        })),
        browser: browser ? {
          state: browser.status,
          actionCount: browser.actions.length,
          consoleErrorCount: browser.console.filter((item) => item.level === "error").length,
          networkFailureCount: browser.network.filter((item) => item.state === "error" || item.state === "blocked").length,
          screenshotVersion: browser.screenshotVersion,
        } : null,
      };
    },
  });
}
