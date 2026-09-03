import type {
  HarnessMetricsRecommendationActionV1,
  UpdateSettingsRequest,
  UserSettings,
} from "@vraxis/code-contracts";

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
