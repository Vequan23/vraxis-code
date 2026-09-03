import type {
  HarnessMetricsRecommendationActionV1,
  HarnessMetricsRecommendationV1,
  HarnessMetricsSummaryV1,
  HarnessRoutingHintV1,
  HarnessRuntimeStatsV1,
  RuntimeConformanceSummary,
  SessionMode,
  UpdateSettingsRequest,
  UserSettings,
} from "@vraxis/code-contracts";

const minRunsToCompare = 3;
const minScoreDelta = 0.12;
const autoApplyScoreDelta = 0.15;
const highToolFailureRate = 0.22;
const highTaskFailureRate = 0.35;
const highCompactionRate = 0.28;
const highAvgTokens = 48_000;
const trendToolFailureDelta = 0.08;
const trendVerificationDelta = -0.1;

export interface HarnessRecommendationContext {
  defaultRuntimeId?: string | undefined;
  defaultMode: SessionMode;
  disabledRuntimeIds?: string[] | undefined;
  installedRuntimeIds: string[];
  runtimeConformance?: Record<string, RuntimeConformanceSummary["state"] | undefined> | undefined;
}

function completionRate(stat: HarnessRuntimeStatsV1): number {
  return stat.runs ? stat.completed / stat.runs : 0;
}

function runtimeScore(stat: HarnessRuntimeStatsV1): number {
  const verification = stat.verificationPassRate ?? 0.5;
  const durationFactor = 1 - Math.min(stat.avgDurationMs / 180_000, 1);
  const tokenFactor = stat.avgTokens ? 1 - Math.min(stat.avgTokens / 120_000, 1) * 0.08 : 0;
  const compactionFactor = 1 - Math.min(stat.compactionRate, 1) * 0.08;
  return (1 - stat.toolFailureRate) * 0.34
    + verification * 0.26
    + completionRate(stat) * 0.2
    + durationFactor * 0.1
    + tokenFactor
    + compactionFactor;
}

function availableStats(
  stats: HarnessRuntimeStatsV1[],
  context: HarnessRecommendationContext,
): HarnessRuntimeStatsV1[] {
  const disabled = new Set(context.disabledRuntimeIds ?? []);
  const installed = new Set(context.installedRuntimeIds);
  return stats.filter((item) =>
    item.runs >= minRunsToCompare
    && installed.has(item.runtimeId)
    && !disabled.has(item.runtimeId));
}

function recommendationId(parts: string[]): string {
  return parts.join(":");
}

function modeLabel(mode: SessionMode): string {
  return mode.charAt(0).toUpperCase() + mode.slice(1);
}

function conformanceNeedsVerification(state: RuntimeConformanceSummary["state"] | undefined): boolean {
  return state === "stale" || state === "failed" || state === "unverified";
}

function addEfficiencyRecommendations(
  recommendations: HarnessMetricsRecommendationV1[],
  stat: HarnessRuntimeStatsV1,
): void {
  if (stat.compactionRate >= highCompactionRate) {
    recommendations.push({
      id: recommendationId(["compaction", stat.runtimeId, stat.mode]),
      kind: "high-compaction",
      tone: "warning",
      title: `Context compaction is frequent for ${stat.runtimeId} in ${modeLabel(stat.mode)} mode`,
      detail: `${Math.round(stat.compactionRate * 100)}% of ${stat.runs} runs needed compaction. Consider shorter prompts, fewer attachments, or a lighter mode when possible.`,
      confidence: stat.compactionRate >= highCompactionRate * 1.35 ? "high" : "medium",
      mode: stat.mode,
      runtimeId: stat.runtimeId,
    });
  }
  if (stat.avgTokens !== undefined && stat.avgTokens >= highAvgTokens) {
    recommendations.push({
      id: recommendationId(["tokens", stat.runtimeId, stat.mode]),
      kind: "high-tokens",
      tone: "info",
      title: `${stat.runtimeId} runs are token-heavy in ${modeLabel(stat.mode)} mode`,
      detail: `Average ${Math.round(stat.avgTokens / 1000)}k tokens per run across ${stat.runs} recent tasks. Review attachments, browser context, and attached skills when steering long sessions.`,
      confidence: stat.avgTokens >= highAvgTokens * 1.25 ? "high" : "medium",
      mode: stat.mode,
      runtimeId: stat.runtimeId,
    });
  }
}

export function deriveHarnessRecommendations(
  summary: Pick<HarnessMetricsSummaryV1, "totalRuns" | "windowDays" | "byRuntime" | "recentTrend">,
  context: HarnessRecommendationContext,
): HarnessMetricsRecommendationV1[] {
  const recommendations: HarnessMetricsRecommendationV1[] = [];
  const modes = [...new Set(summary.byRuntime.map((item) => item.mode))];

  if (summary.totalRuns > 0 && summary.totalRuns < minRunsToCompare) {
    recommendations.push({
      id: "collect-more-data",
      kind: "collect-more-data",
      tone: "info",
      title: "Collect a few more runs",
      detail: `${summary.totalRuns} run${summary.totalRuns === 1 ? "" : "s"} recorded in the last ${summary.windowDays} days. Vraxis needs at least ${minRunsToCompare} runs before it can recommend a better default harness.`,
      confidence: "low",
    });
  }

  if (context.defaultRuntimeId) {
    const conformance = context.runtimeConformance?.[context.defaultRuntimeId];
    if (conformanceNeedsVerification(conformance)) {
      recommendations.push({
        id: recommendationId(["conformance", context.defaultRuntimeId]),
        kind: "verify-conformance",
        tone: conformance === "failed" ? "warning" : "info",
        title: `Verify ${context.defaultRuntimeId} conformance`,
        detail: conformance === "failed"
          ? "The last live probe failed. Run a fresh conformance check before relying on this harness for Build or verification-heavy work."
          : conformance === "stale"
            ? "Conformance was verified on an older harness version. Run a live probe to refresh the capability matrix."
            : "This harness has not been live-verified on this device yet.",
        confidence: conformance === "failed" ? "high" : "medium",
        runtimeId: context.defaultRuntimeId,
        action: { type: "probe-runtime", runtimeId: context.defaultRuntimeId },
      });
    }
  }

  const trend = summary.recentTrend;
  if (trend?.toolFailureRateDelta !== undefined && trend.toolFailureRateDelta >= trendToolFailureDelta) {
    recommendations.push({
      id: recommendationId(["trend", "tool-failure"]),
      kind: "trend-warning",
      tone: "warning",
      title: "Tool failures are rising",
      detail: `Tool failure rate increased by ${Math.round(trend.toolFailureRateDelta * 100)} points compared with the previous ${summary.windowDays}-day window. Review harness conformance or switch to a more reliable runtime.`,
      confidence: trend.toolFailureRateDelta >= trendToolFailureDelta * 2 ? "high" : "medium",
    });
  }
  if (trend?.verificationPassRateDelta !== undefined && trend.verificationPassRateDelta <= trendVerificationDelta) {
    recommendations.push({
      id: recommendationId(["trend", "verification"]),
      kind: "trend-warning",
      tone: "warning",
      title: "Verification pass rate is falling",
      detail: `Verification pass rate dropped by ${Math.abs(Math.round(trend.verificationPassRateDelta * 100))} points compared with the previous ${summary.windowDays}-day window.`,
      confidence: trend.verificationPassRateDelta <= trendVerificationDelta * 2 ? "high" : "medium",
    });
  }

  for (const stat of availableStats(summary.byRuntime, context)) {
    addEfficiencyRecommendations(recommendations, stat);
  }

  if (context.defaultRuntimeId) {
    const defaultRuntimeModes = availableStats(
      summary.byRuntime.filter((item) => item.runtimeId === context.defaultRuntimeId),
      context,
    );
    if (defaultRuntimeModes.length >= 2) {
      const rankedModes = [...defaultRuntimeModes].sort((left, right) => runtimeScore(right) - runtimeScore(left));
      const bestMode = rankedModes[0];
      const currentModeStat = defaultRuntimeModes.find((item) => item.mode === context.defaultMode);
      if (bestMode && currentModeStat && bestMode.mode !== context.defaultMode) {
        const delta = runtimeScore(bestMode) - runtimeScore(currentModeStat);
        if (delta >= minScoreDelta) {
          recommendations.push({
            id: recommendationId(["prefer-mode", context.defaultRuntimeId, context.defaultMode, bestMode.mode]),
            kind: "prefer-mode",
            tone: "success",
            title: `Prefer ${modeLabel(bestMode.mode)} mode with ${context.defaultRuntimeId}`,
            detail: `${modeLabel(bestMode.mode)} mode scored better across ${bestMode.runs} runs on this harness. ${modeLabel(context.defaultMode)} mode had ${Math.round(currentModeStat.toolFailureRate * 100)}% tool failures versus ${Math.round(bestMode.toolFailureRate * 100)}%.`,
            confidence: delta >= autoApplyScoreDelta ? "high" : "medium",
            mode: bestMode.mode,
            runtimeId: context.defaultRuntimeId,
            action: { type: "set-default-mode", mode: bestMode.mode },
          });
        }
      }
    }
  }

  for (const mode of modes) {
    const modeStats = availableStats(summary.byRuntime.filter((item) => item.mode === mode), context);
    if (modeStats.length < 2) continue;

    const ranked = [...modeStats].sort((left, right) => runtimeScore(right) - runtimeScore(left));
    const best = ranked[0];
    const currentRuntimeId = mode === context.defaultMode ? context.defaultRuntimeId : undefined;
    const current = currentRuntimeId
      ? modeStats.find((item) => item.runtimeId === currentRuntimeId)
      : undefined;

    if (current) {
      const failureRate = current.runs ? current.failed / current.runs : 0;
      if (failureRate >= highTaskFailureRate || current.toolFailureRate >= highToolFailureRate) {
        recommendations.push({
          id: recommendationId(["review", mode, current.runtimeId]),
          kind: "review-runtime",
          tone: "warning",
          title: `${current.runtimeId} is struggling in ${modeLabel(mode)} mode`,
          detail: `${Math.round(current.toolFailureRate * 100)}% tool failure rate and ${Math.round(failureRate * 100)}% failed runs across ${current.runs} recent tasks. Run a live probe or switch harnesses.`,
          confidence: failureRate >= highTaskFailureRate ? "high" : "medium",
          mode,
          runtimeId: current.runtimeId,
          action: { type: "probe-runtime", runtimeId: current.runtimeId },
        });
      }

      if (best && best.runtimeId !== current.runtimeId) {
        const delta = runtimeScore(best) - runtimeScore(current);
        if (delta >= minScoreDelta) {
          recommendations.push({
            id: recommendationId(["prefer", mode, current.runtimeId, best.runtimeId]),
            kind: "prefer-runtime",
            tone: "success",
            title: `Prefer ${best.runtimeId} for ${modeLabel(mode)} mode`,
            detail: `${best.runtimeId} scored better on tool reliability, completion, verification, and efficiency across ${best.runs} runs. ${current.runtimeId} had ${Math.round(current.toolFailureRate * 100)}% tool failures versus ${Math.round(best.toolFailureRate * 100)}%.`,
            confidence: delta >= autoApplyScoreDelta && best.runs >= minRunsToCompare + 1 ? "high" : "medium",
            mode,
            runtimeId: current.runtimeId,
            suggestedRuntimeId: best.runtimeId,
            action: { type: "set-default-runtime", runtimeId: best.runtimeId },
          });
        }
      }
    } else if (best && mode === context.defaultMode) {
      recommendations.push({
        id: recommendationId(["prefer", mode, "unset", best.runtimeId]),
        kind: "prefer-runtime",
        tone: "info",
        title: `Set ${best.runtimeId} as the default harness`,
        detail: `${best.runtimeId} is the strongest ${modeLabel(mode)} performer in your recent metrics across ${best.runs} runs.`,
        confidence: "medium",
        mode,
        suggestedRuntimeId: best.runtimeId,
        action: { type: "set-default-runtime", runtimeId: best.runtimeId },
      });
    }
  }

  return recommendations.sort((left, right) => {
    const toneRank = { warning: 0, info: 1, success: 2 };
    const confidenceRank = { high: 0, medium: 1, low: 2 };
    if (toneRank[left.tone] !== toneRank[right.tone]) return toneRank[left.tone] - toneRank[right.tone];
    if (confidenceRank[left.confidence] !== confidenceRank[right.confidence]) {
      return confidenceRank[left.confidence] - confidenceRank[right.confidence];
    }
    return left.title.localeCompare(right.title);
  });
}

export function deriveHarnessRoutingHint(
  recommendations: HarnessMetricsRecommendationV1[],
  context: HarnessRecommendationContext,
): HarnessRoutingHintV1 | undefined {
  const preferRuntime = recommendations.find((item) =>
    item.kind === "prefer-runtime"
    && item.confidence !== "low"
    && item.mode === context.defaultMode
    && item.action?.type === "set-default-runtime");
  const preferMode = recommendations.find((item) =>
    item.kind === "prefer-mode"
    && item.confidence !== "low"
    && item.action?.type === "set-default-mode");

  const suggestedRuntimeId = preferRuntime?.action?.type === "set-default-runtime"
    ? preferRuntime.action.runtimeId
    : undefined;
  const suggestedMode = preferMode?.action?.type === "set-default-mode"
    ? preferMode.action.mode
    : undefined;

  if (!suggestedRuntimeId && !suggestedMode) return undefined;

  const runtimeMatches = !suggestedRuntimeId || suggestedRuntimeId === context.defaultRuntimeId;
  const modeMatches = !suggestedMode || suggestedMode === context.defaultMode;
  if (runtimeMatches && modeMatches) return undefined;

  const reason = preferRuntime?.detail ?? preferMode?.detail ?? "Recent local metrics suggest a better default setup.";
  const confidence = preferRuntime?.confidence === "high" || preferMode?.confidence === "high"
    ? "high"
    : preferRuntime?.confidence ?? preferMode?.confidence ?? "medium";

  return {
    id: recommendationId([
      "routing",
      suggestedRuntimeId ?? context.defaultRuntimeId ?? "none",
      suggestedMode ?? context.defaultMode,
    ]),
    ...(suggestedRuntimeId ? { suggestedRuntimeId } : {}),
    ...(suggestedMode ? { suggestedMode } : {}),
    reason,
    confidence,
  };
}

export function autoApplyHarnessRecommendation(
  summary: HarnessMetricsSummaryV1,
  settings: UserSettings,
  installedRuntimeIds: string[],
): UpdateSettingsRequest | null {
  if (!settings.harnessMetricsAutoApply) return null;
  const recommendations = summary.recommendations ?? deriveHarnessRecommendations(summary, {
    defaultRuntimeId: settings.defaultRuntimeId,
    defaultMode: settings.defaultMode,
    disabledRuntimeIds: settings.disabledRuntimeIds,
    installedRuntimeIds,
  });
  const candidate = recommendations.find((item) =>
    item.kind === "prefer-runtime"
    && item.confidence === "high"
    && item.action?.type === "set-default-runtime"
    && item.mode === settings.defaultMode
    && item.action.runtimeId !== settings.defaultRuntimeId
    && installedRuntimeIds.includes(item.action.runtimeId));
  if (!candidate?.action || candidate.action.type !== "set-default-runtime") return null;
  return { defaultRuntimeId: candidate.action.runtimeId };
}

export function applyHarnessRecommendationAction(
  action: HarnessMetricsRecommendationActionV1,
): UpdateSettingsRequest {
  if (action.type === "set-default-runtime") return { defaultRuntimeId: action.runtimeId };
  if (action.type === "set-default-mode") return { defaultMode: action.mode };
  if (action.type === "disable-runtime") {
    return { disabledRuntimeIds: [...new Set([action.runtimeId])] };
  }
  return {};
}

export function recommendationAppliesToRuntime(
  recommendation: HarnessMetricsRecommendationV1,
  runtimeId: string,
): boolean {
  return recommendation.runtimeId === runtimeId
    || recommendation.suggestedRuntimeId === runtimeId
    || (recommendation.action?.type !== "set-default-mode" && recommendation.action?.runtimeId === runtimeId);
}
