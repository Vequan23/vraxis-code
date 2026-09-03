import type {
  HarnessMetricsRecommendationActionV1,
  HarnessMetricsRecommendationV1,
  HarnessRoutingHintV1,
  SessionMode,
  UpdateSettingsRequest,
  UserSettings,
} from "@vraxis/code-contracts";

export interface PostRunNudgeContext {
  recommendations: HarnessMetricsRecommendationV1[];
  sessionMode: SessionMode;
  sessionRuntimeId?: string | undefined;
  dismissedIds: ReadonlySet<string>;
  routingHint?: HarnessRoutingHintV1 | null | undefined;
}

function duplicatesRoutingHint(
  recommendation: HarnessMetricsRecommendationV1,
  routingHint?: HarnessRoutingHintV1 | null,
): boolean {
  if (!routingHint) return false;
  if (recommendation.kind === "prefer-runtime" && recommendation.action?.type === "set-default-runtime") {
    return recommendation.action.runtimeId === routingHint.suggestedRuntimeId;
  }
  if (recommendation.kind === "prefer-mode" && recommendation.action?.type === "set-default-mode") {
    return recommendation.action.mode === routingHint.suggestedMode;
  }
  return false;
}

export function selectPostRunNudgeRecommendation(context: PostRunNudgeContext): HarnessMetricsRecommendationV1 | null {
  const sessionRuntimeKinds = new Set([
    "review-runtime",
    "verify-conformance",
    "high-compaction",
    "high-tokens",
  ]);
  return context.recommendations.find((item) => {
    if (context.dismissedIds.has(item.id)) return false;
    if (!item.action) return false;
    if (item.kind === "collect-more-data") return false;
    if (item.confidence === "low") return false;
    if (item.mode && item.mode !== context.sessionMode) return false;
    if (duplicatesRoutingHint(item, context.routingHint)) return false;
    if (context.sessionRuntimeId && sessionRuntimeKinds.has(item.kind) && item.runtimeId) {
      return item.runtimeId === context.sessionRuntimeId;
    }
    return true;
  }) ?? null;
}

export function recommendationActionLabel(
  recommendation: HarnessMetricsRecommendationV1,
  runtimeName: (runtimeId: string) => string,
): string | undefined {
  if (!recommendation.action) return undefined;
  if (recommendation.action.type === "set-default-runtime") {
    return `Use ${runtimeName(recommendation.action.runtimeId)}`;
  }
  if (recommendation.action.type === "set-default-mode") {
    return `${recommendation.action.mode.charAt(0).toUpperCase()}${recommendation.action.mode.slice(1)} mode`;
  }
  if (recommendation.action.type === "probe-runtime") return "Verify live";
  if (recommendation.action.type === "disable-runtime") return "Disable harness";
  return undefined;
}

export function settingsPatchForRecommendationAction(
  action: HarnessMetricsRecommendationActionV1,
  settings: UserSettings,
): UpdateSettingsRequest {
  if (action.type === "set-default-runtime") {
    return { defaultRuntimeId: action.runtimeId };
  }
  if (action.type === "set-default-mode") {
    return { defaultMode: action.mode };
  }
  if (action.type === "disable-runtime") {
    return { disabledRuntimeIds: [...new Set([...(settings.disabledRuntimeIds ?? []), action.runtimeId])] };
  }
  return {};
}

function recommendationRuntimeId(action: HarnessMetricsRecommendationActionV1 | undefined): string | undefined {
  if (!action || action.type === "set-default-mode") return undefined;
  return action.runtimeId;
}

export function recommendationAppliesToRuntime(
  runtimeId: string,
  recommendation: { runtimeId?: string; suggestedRuntimeId?: string; action?: HarnessMetricsRecommendationActionV1 },
): boolean {
  return recommendation.runtimeId === runtimeId
    || recommendation.suggestedRuntimeId === runtimeId
    || recommendationRuntimeId(recommendation.action) === runtimeId;
}
