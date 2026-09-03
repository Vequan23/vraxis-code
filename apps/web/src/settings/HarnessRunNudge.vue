<script setup lang="ts">
import { computed } from "vue";
import type { HarnessMetricsRecommendationV1, RuntimeSummary } from "@vraxis/code-contracts";
import { recommendationActionLabel } from "./harness-recommendation-actions.js";

const props = defineProps<{
  recommendation: HarnessMetricsRecommendationV1;
  runtimes: RuntimeSummary[];
  saving: boolean;
}>();

const emit = defineEmits<{
  apply: [];
  dismiss: [];
}>();

function runtimeName(runtimeId: string): string {
  return props.runtimes.find((item) => item.id === runtimeId)?.name ?? runtimeId;
}

const actionLabel = computed(() => recommendationActionLabel(props.recommendation, runtimeName));
</script>

<template>
  <div
    :class="['harness-run-nudge', recommendation.tone]"
    role="status"
    aria-live="polite"
    aria-label="Harness feedback after this run"
  >
    <div class="harness-run-nudge-copy">
      <span class="harness-run-nudge-title">
        <osx-icon
          :name="recommendation.tone === 'warning' ? 'warning' : recommendation.tone === 'success' ? 'check' : 'sparkle'"
          :size="14"
        />
        {{ recommendation.title }}
      </span>
      <p>{{ recommendation.detail }}</p>
      <small>{{ recommendation.confidence }} confidence · based on recent local runs</small>
    </div>
    <div class="harness-run-nudge-actions">
      <osx-button v-if="actionLabel" size="small" :disabled="saving" @click="emit('apply')">
        {{ actionLabel }}
      </osx-button>
      <osx-button size="small" tone="secondary" :disabled="saving" @click="emit('dismiss')">Dismiss</osx-button>
    </div>
  </div>
</template>
