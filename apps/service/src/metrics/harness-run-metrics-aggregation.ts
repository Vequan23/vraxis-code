import type {
  HarnessMetricsExportV1,
  HarnessMetricsSummaryV1,
  HarnessMetricsTrendV1,
  HarnessRunMetricsV1,
  HarnessRuntimeStatsV1,
  SessionMode,
} from "@vraxis/code-contracts";

const defaultWindowDays = 30;

function groupKey(runtimeId: string, mode: SessionMode): string {
  return `${runtimeId}\0${mode}`;
}

function withinWindow(run: HarnessRunMetricsV1, windowDays: number, now: number): boolean {
  const completedAt = Date.parse(run.completedAt);
  if (Number.isNaN(completedAt)) return false;
  return now - completedAt <= windowDays * 86_400_000;
}

function aggregateRuns(runs: HarnessRunMetricsV1[]): HarnessRuntimeStatsV1[] {
  const groups = new Map<string, {
    runtimeId: string;
    mode: SessionMode;
    runtimeVersion?: string;
    runs: HarnessRunMetricsV1[];
  }>();

  for (const run of runs) {
    const key = groupKey(run.runtimeId, run.mode);
    const group = groups.get(key) ?? { runtimeId: run.runtimeId, mode: run.mode, runs: [] };
    group.runs.push(run);
    if (run.runtimeVersion) group.runtimeVersion = run.runtimeVersion;
    groups.set(key, group);
  }

  return [...groups.values()].map(({ runtimeId, mode, runtimeVersion, runs: groupRuns }) => {
    const completed = groupRuns.filter((item) => item.outcome === "complete" || item.outcome === "turn-complete").length;
    const failed = groupRuns.filter((item) => item.outcome === "failed").length;
    const durations = groupRuns.map((item) => item.durationMs).filter((item) => Number.isFinite(item));
    const tokenTotals = groupRuns
      .map((item) => item.tokens?.total ?? ((item.tokens?.input ?? 0) + (item.tokens?.output ?? 0)))
      .filter((item) => item > 0);
    const toolCalls = groupRuns.flatMap((item) => item.tools);
    const toolFailureRate = toolCalls.length
      ? toolCalls.reduce((sum, item) => sum + item.failures, 0) / toolCalls.reduce((sum, item) => sum + item.calls, 0)
      : 0;
    const approvalRequested = groupRuns.reduce((sum, item) => sum + item.approvals.requested, 0);
    const approvalApproved = groupRuns.reduce((sum, item) => sum + item.approvals.approved, 0);
    const approvalWaitMs = groupRuns.reduce((sum, item) => sum + item.approvals.totalWaitMs, 0);
    const verificationRuns = groupRuns.reduce((sum, item) => sum + (item.verification?.runs ?? 0), 0);
    const verificationPassed = groupRuns.reduce((sum, item) => sum + (item.verification?.passed ?? 0), 0);
    const compactionRuns = groupRuns.filter((item) => item.compactions > 0).length;
    const lastRunAt = groupRuns.map((item) => item.completedAt).sort().at(-1);

    return {
      runtimeId,
      mode,
      ...(runtimeVersion ? { runtimeVersion } : {}),
      runs: groupRuns.length,
      completed,
      failed,
      avgDurationMs: durations.length ? Math.round(durations.reduce((sum, item) => sum + item, 0) / durations.length) : 0,
      ...(tokenTotals.length ? { avgTokens: Math.round(tokenTotals.reduce((sum, item) => sum + item, 0) / tokenTotals.length) } : {}),
      toolFailureRate: Number.isFinite(toolFailureRate) ? Math.min(1, Math.max(0, toolFailureRate)) : 0,
      approvalRate: approvalRequested ? approvalApproved / approvalRequested : 1,
      avgApprovalWaitMs: approvalApproved ? Math.round(approvalWaitMs / approvalApproved) : 0,
      ...(verificationRuns ? { verificationPassRate: verificationPassed / verificationRuns } : {}),
      compactionRate: groupRuns.length ? compactionRuns / groupRuns.length : 0,
      ...(lastRunAt ? { lastRunAt } : {}),
    };
  }).sort((left, right) => {
    if (right.runs !== left.runs) return right.runs - left.runs;
    return left.runtimeId.localeCompare(right.runtimeId);
  });
}

function trendForWindow(
  allRuns: HarnessRunMetricsV1[],
  windowDays: number,
  now: number,
): HarnessMetricsTrendV1 | undefined {
  const recentCutoff = now - windowDays * 86_400_000;
  const previousCutoff = now - windowDays * 2 * 86_400_000;
  const recent = allRuns.filter((run) => {
    const completedAt = Date.parse(run.completedAt);
    return !Number.isNaN(completedAt) && completedAt >= recentCutoff;
  });
  const previous = allRuns.filter((run) => {
    const completedAt = Date.parse(run.completedAt);
    return !Number.isNaN(completedAt) && completedAt >= previousCutoff && completedAt < recentCutoff;
  });
  if (!recent.length || !previous.length) return undefined;

  const recentStats = aggregateRuns(recent);
  const previousStats = aggregateRuns(previous);
  const recentToolFailure = average(recentStats.map((item) => item.toolFailureRate));
  const previousToolFailure = average(previousStats.map((item) => item.toolFailureRate));
  const recentVerification = average(recentStats.map((item) => item.verificationPassRate).filter((item): item is number => item !== undefined));
  const previousVerification = average(previousStats.map((item) => item.verificationPassRate).filter((item): item is number => item !== undefined));

  const trend: HarnessMetricsTrendV1 = {};
  if (recentToolFailure !== undefined && previousToolFailure !== undefined) {
    trend.toolFailureRateDelta = recentToolFailure - previousToolFailure;
  }
  if (recentVerification !== undefined && previousVerification !== undefined) {
    trend.verificationPassRateDelta = recentVerification - previousVerification;
  }
  return Object.keys(trend).length ? trend : undefined;
}

function average(values: number[]): number | undefined {
  if (!values.length) return undefined;
  return values.reduce((sum, item) => sum + item, 0) / values.length;
}

export function aggregateHarnessMetrics(
  runs: HarnessRunMetricsV1[],
  options: { enabled: boolean; windowDays?: number },
): HarnessMetricsSummaryV1 {
  const windowDays = options.windowDays ?? defaultWindowDays;
  const now = Date.now();
  const windowed = runs.filter((run) => withinWindow(run, windowDays, now));
  const byRuntime = aggregateRuns(windowed);
  const recentTrend = trendForWindow(runs, windowDays, now);

  return {
    kind: "vraxis.harness-metrics-summary",
    version: 1,
    generatedAt: new Date().toISOString(),
    enabled: options.enabled,
    totalRuns: windowed.length,
    windowDays,
    byRuntime,
    ...(recentTrend ? { recentTrend } : {}),
  };
}

export function exportHarnessMetrics(summary: HarnessMetricsSummaryV1): HarnessMetricsExportV1 {
  return {
    kind: "vraxis.harness-metrics-export",
    version: 1,
    generatedAt: summary.generatedAt,
    summary,
    aggregates: summary.byRuntime,
  };
}
