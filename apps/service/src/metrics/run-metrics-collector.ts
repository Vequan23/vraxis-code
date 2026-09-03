import type {
  ContextUsageBreakdown,
  CodingRuntimeResult,
} from "@vraxis/agent-v";
import type {
  HarnessRunApprovalMetricsV1,
  HarnessRunCostMetricsV1,
  HarnessRunMetricsSnapshot,
  HarnessRunMetricsV1,
  HarnessRunOutcome,
  HarnessRunTokenMetricsV1,
  HarnessRunVerificationMetricsV1,
  HarnessToolMetricsV1,
  SessionSummary,
  VerificationRunSummary,
} from "@vraxis/code-contracts";

interface ToolAccumulator {
  calls: number;
  successes: number;
  failures: number;
  totalDurationMs: number;
}

export class RunMetricsCollector {
  private startedAtMs = Date.now();
  private runtimeVersion?: string;
  private compactions = 0;
  private lastContextUsage?: ContextUsageBreakdown;
  private readonly tools = new Map<string, ToolAccumulator>();
  private readonly approvalRequestedAt = new Map<string, number>();
  private approvals: HarnessRunApprovalMetricsV1 = {
    requested: 0,
    approved: 0,
    denied: 0,
    totalWaitMs: 0,
  };

  constructor(
    readonly runId: string,
    readonly session: SessionSummary,
  ) {}

  noteRuntimeStarted(runtimeVersion?: string): void {
    this.startedAtMs = Date.now();
    if (runtimeVersion) this.runtimeVersion = runtimeVersion;
  }

  noteContextMeasured(usage: ContextUsageBreakdown): void {
    this.lastContextUsage = usage;
  }

  noteCompaction(usage: ContextUsageBreakdown): void {
    this.compactions += 1;
    this.lastContextUsage = usage;
  }

  noteToolCompleted(toolName: string, durationMs?: number): void {
    const tool = this.tools.get(toolName) ?? { calls: 0, successes: 0, failures: 0, totalDurationMs: 0 };
    tool.calls += 1;
    tool.successes += 1;
    if (durationMs !== undefined && Number.isFinite(durationMs)) tool.totalDurationMs += durationMs;
    this.tools.set(toolName, tool);
  }

  noteToolFailed(toolName: string): void {
    const tool = this.tools.get(toolName) ?? { calls: 0, successes: 0, failures: 0, totalDurationMs: 0 };
    tool.calls += 1;
    tool.failures += 1;
    this.tools.set(toolName, tool);
  }

  noteApprovalRequested(approvalId: string): void {
    this.approvals.requested += 1;
    this.approvalRequestedAt.set(approvalId, Date.now());
  }

  noteApprovalResolved(approvalId: string, decision: "approved" | "denied"): void {
    if (decision === "approved") this.approvals.approved += 1;
    else this.approvals.denied += 1;
    const requestedAt = this.approvalRequestedAt.get(approvalId);
    if (requestedAt !== undefined) {
      this.approvals.totalWaitMs += Math.max(0, Date.now() - requestedAt);
      this.approvalRequestedAt.delete(approvalId);
    }
  }

  elapsedMs(): number {
    return Math.max(0, Date.now() - this.startedAtMs);
  }

  buildSnapshot(
    outcome: HarnessRunOutcome,
    durationMs: number,
    result?: Pick<CodingRuntimeResult<unknown>, "usage">,
    verificationRuns: VerificationRunSummary[] = [],
  ): HarnessRunMetricsSnapshot {
    const tokens = tokenMetrics(result?.usage, this.lastContextUsage);
    const cost = costMetrics(result?.usage?.cost);
    const verification = verificationMetrics(verificationRuns, this.startedAtMs);

    return {
      durationMs,
      outcome,
      ...(tokens ? { tokens } : {}),
      ...(cost ? { cost } : {}),
      tools: toolMetrics(this.tools),
      approvals: this.approvals,
      compactions: this.compactions,
      ...(verification ? { verification } : {}),
    };
  }

  buildRecord(
    outcome: HarnessRunOutcome,
    durationMs: number,
    result?: Pick<CodingRuntimeResult<unknown>, "usage">,
    verificationRuns: VerificationRunSummary[] = [],
  ): HarnessRunMetricsV1 {
    const completedAt = new Date().toISOString();
    const snapshot = this.buildSnapshot(outcome, durationMs, result, verificationRuns);

    return {
      kind: "vraxis.harness-run-metrics",
      version: 1,
      id: crypto.randomUUID(),
      sessionId: this.session.id,
      projectId: this.session.projectId,
      runId: this.runId,
      runtimeId: this.session.runtimeId,
      ...(this.runtimeVersion ? { runtimeVersion: this.runtimeVersion } : {}),
      ...(this.session.modelId ? { modelId: this.session.modelId } : {}),
      mode: this.session.mode,
      startedAt: new Date(this.startedAtMs).toISOString(),
      completedAt,
      ...snapshot,
    };
  }
}

function toolMetrics(tools: Map<string, ToolAccumulator>): HarnessToolMetricsV1[] {
  return [...tools.entries()]
    .map(([id, stats]) => ({ id, ...stats }))
    .sort((left, right) => right.calls - left.calls || left.id.localeCompare(right.id));
}

function tokenMetrics(
  usage: CodingRuntimeResult<unknown>["usage"] | undefined,
  contextUsage?: ContextUsageBreakdown,
): HarnessRunTokenMetricsV1 | undefined {
  const input = usage?.input;
  const output = usage?.output;
  const summed = (input ?? 0) + (output ?? 0);
  const total = usage?.total ?? (summed > 0 ? summed : usage?.context?.total);
  const context = usage?.context ?? contextUsage;
  if (total === undefined && !context) return undefined;

  return {
    ...(input !== undefined ? { input } : {}),
    ...(output !== undefined ? { output } : {}),
    ...(total !== undefined ? { total } : {}),
    ...(context?.system !== undefined ? { system: context.system } : {}),
    ...(context?.tools !== undefined ? { tools: context.tools } : {}),
    ...(context?.transcript !== undefined ? { transcript: context.transcript } : {}),
    ...(context?.toolResults !== undefined ? { toolResults: context.toolResults } : {}),
    ...(context?.artifacts !== undefined ? { artifacts: context.artifacts } : {}),
  };
}

function costMetrics(cost: unknown): HarnessRunCostMetricsV1 | undefined {
  if (!cost || typeof cost !== "object") return undefined;
  const record = cost as HarnessRunCostMetricsV1;
  if (!record.status) return undefined;
  return {
    status: record.status,
    ...(record.amountUsd !== undefined ? { amountUsd: record.amountUsd } : {}),
  };
}

function verificationMetrics(
  runs: VerificationRunSummary[],
  startedAtMs: number,
): HarnessRunVerificationMetricsV1 | undefined {
  const relevant = runs.filter((run) => {
    const createdAt = Date.parse(run.createdAt);
    return !Number.isNaN(createdAt) && createdAt >= startedAtMs;
  });
  if (!relevant.length) return undefined;
  const passed = relevant.filter((run) => run.state === "passed").length;
  const failed = relevant.filter((run) => run.state === "failed").length;
  return { runs: relevant.length, passed, failed };
}

function runMetricsDetail(snapshot: HarnessRunMetricsSnapshot): string {
  const tokenText = snapshot.tokens?.total !== undefined
    ? `${snapshot.tokens.total.toLocaleString()} tokens`
    : "Token usage not reported";
  const toolCalls = snapshot.tools.reduce((sum, item) => sum + item.calls, 0);
  const toolFailures = snapshot.tools.reduce((sum, item) => sum + item.failures, 0);
  const approvalText = snapshot.approvals.requested
    ? `${snapshot.approvals.approved}/${snapshot.approvals.requested} approvals`
    : "No approvals";
  return `${tokenText} · ${toolCalls} tool calls (${toolFailures} failed) · ${approvalText} · ${snapshot.compactions} compaction${snapshot.compactions === 1 ? "" : "s"}.`;
}

export function runMetricsTelemetry(snapshot: HarnessRunMetricsSnapshot): { title: string; detail: string } {
  return {
    title: "Run metrics",
    detail: runMetricsDetail(snapshot),
  };
}
