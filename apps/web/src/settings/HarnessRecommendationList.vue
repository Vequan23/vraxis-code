<script setup lang="ts">
import type {
  HarnessMetricsRecommendationActionV1,
  HarnessMetricsRecommendationV1,
  RuntimeSummary,
} from "@vraxis/code-contracts";

const props = defineProps<{
  recommendations: HarnessMetricsRecommendationV1[];
  runtimes: RuntimeSummary[];
  saving: boolean;
  compact?: boolean;
}>();

const emit = defineEmits<{
  apply: [action: HarnessMetricsRecommendationActionV1];
  probe: [runtime: RuntimeSummary];
}>();

function runtimeName(runtimeId: string): string {
  return props.runtimes.find((item) => item.id === runtimeId)?.name ?? runtimeId;
}

function actionLabel(recommendation: HarnessMetricsRecommendationV1): string | undefined {
  if (!recommendation.action) return undefined;
  if (recommendation.action.type === "set-default-runtime") {
    return `Use ${runtimeName(recommendation.action.runtimeId)}`;
  }
  if (recommendation.action.type === "set-default-mode") {
    return `Use ${recommendation.action.mode.charAt(0).toUpperCase()}${recommendation.action.mode.slice(1)} mode`;
  }
  if (recommendation.action.type === "probe-runtime") return "Verify live";
  if (recommendation.action.type === "disable-runtime") return "Disable harness";
  return undefined;
}

function handleAction(recommendation: HarnessMetricsRecommendationV1): void {
  const action = recommendation.action;
  if (!action) return;
  if (action.type === "probe-runtime") {
    const runtime = props.runtimes.find((item) => item.id === action.runtimeId);
    if (runtime) emit("probe", runtime);
    return;
  }
  emit("apply", action);
}
</script>

<template>
  <div v-if="recommendations.length" :class="['harness-recommendations', { compact }]">
    <header>
      <strong>{{ compact ? "Harness feedback" : "Improvement recommendations" }}</strong>
      <span>Based on local run metrics. No prompts or project content are used.</span>
    </header>
    <article
      v-for="recommendation in recommendations"
      :key="recommendation.id"
      :class="['harness-recommendation', recommendation.tone]"
    >
      <div class="harness-recommendation-copy">
        <span class="harness-recommendation-title">
          <osx-icon
            :name="recommendation.tone === 'warning' ? 'warning' : recommendation.tone === 'success' ? 'check' : 'sparkle'"
            :size="14"
          />
          {{ recommendation.title }}
        </span>
        <p>{{ recommendation.detail }}</p>
        <small>{{ recommendation.confidence }} confidence<template v-if="recommendation.mode"> · {{ recommendation.mode }} mode</template></small>
      </div>
      <osx-button
        v-if="actionLabel(recommendation)"
        size="small"
        :disabled="saving"
        @click="handleAction(recommendation)"
      >
        {{ actionLabel(recommendation) }}
      </osx-button>
    </article>
  </div>
</template>

<style scoped>
.harness-recommendations {
  display: grid;
  gap: 10px;
  padding: 14px;
  border: 1px solid var(--osx-border-soft);
  border-radius: 10px;
  background: color-mix(in srgb, var(--osx-surface-sunken) 70%, transparent);
}
.harness-recommendations.compact { padding: 12px; }
.harness-recommendations > header { display: grid; gap: 4px; }
.harness-recommendations > header strong { font-size: 13px; font-weight: 620; }
.harness-recommendations > header span { color: var(--osx-muted); font-size: 12px; line-height: 1.45; }
.harness-recommendation {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 11px 12px;
  border: 1px solid var(--osx-border-soft);
  border-radius: 8px;
  background: var(--osx-surface-raised);
}
.harness-recommendation.warning { border-color: color-mix(in srgb, var(--osx-warning, #d8a33d) 45%, var(--osx-border-soft)); }
.harness-recommendation.success { border-color: color-mix(in srgb, var(--osx-success, #58a978) 40%, var(--osx-border-soft)); }
.harness-recommendation-copy { min-width: 0; display: grid; gap: 4px; }
.harness-recommendation-title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 620;
}
.harness-recommendation-copy p,
.harness-recommendation-copy small {
  margin: 0;
  color: var(--osx-muted);
  font-size: 12px;
  line-height: 1.45;
}
@media (max-width: 720px) {
  .harness-recommendation { flex-direction: column; align-items: stretch; }
}
</style>
