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
  if (action.type === "disable-runtime") {
    return { disabledRuntimeIds: [...new Set([...(settings.disabledRuntimeIds ?? []), action.runtimeId])] };
  }
  return {};
}

export function recommendationAppliesToRuntime(
  runtimeId: string,
  recommendation: { runtimeId?: string; suggestedRuntimeId?: string; action?: { runtimeId?: string } },
): boolean {
  return recommendation.runtimeId === runtimeId
    || recommendation.suggestedRuntimeId === runtimeId
    || recommendation.action?.runtimeId === runtimeId;
}
