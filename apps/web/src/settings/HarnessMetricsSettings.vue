<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import type {
  HarnessMetricsRecommendationActionV1,
  HarnessMetricsSummaryV1,
  RuntimeSummary,
  UpdateSettingsRequest,
  UserSettings,
} from "@vraxis/code-contracts";
import HarnessRecommendationList from "./HarnessRecommendationList.vue";
import HarnessMetricsScorecard from "./HarnessMetricsScorecard.vue";
import { settingsPatchForRecommendationAction } from "./harness-recommendation-actions.js";

const props = defineProps<{
  settings: UserSettings;
  saving: boolean;
  runtimes: RuntimeSummary[];
}>();

const emit = defineEmits<{
  update: [patch: UpdateSettingsRequest];
  probe: [runtime: RuntimeSummary];
}>();

const summary = ref<HarnessMetricsSummaryV1 | null>(null);
const loading = ref(false);
const exporting = ref(false);
const clearing = ref(false);
const error = ref("");
const notice = ref("");

const enabled = computed(() => props.settings.harnessMetricsEnabled === true);
const exportEnabled = computed(() => props.settings.harnessMetricsExportEnabled === true);
const runtimeStats = computed(() => summary.value?.byRuntime ?? []);
const recommendations = computed(() => summary.value?.recommendations ?? []);
const autoApply = computed(() => props.settings.harnessMetricsAutoApply === true);

async function refreshSummary(): Promise<void> {
  loading.value = true;
  error.value = "";
  try {
    const response = await fetch("/api/harness-metrics");
    if (!response.ok) {
      const result = await response.json().catch(() => ({})) as { error?: string };
      throw new Error(result.error ?? "Runtime metrics could not be loaded.");
    }
    summary.value = await response.json() as HarnessMetricsSummaryV1;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "Runtime metrics could not be loaded.";
    summary.value = null;
  } finally {
    loading.value = false;
  }
}

function eventValue(event: Event): unknown {
  return (event as CustomEvent<[unknown]>).detail?.[0];
}

function toggleEnabled(event: Event): void {
  emit("update", { harnessMetricsEnabled: Boolean(eventValue(event)) });
}

function toggleAutoApply(event: Event): void {
  emit("update", { harnessMetricsAutoApply: Boolean(eventValue(event)) });
}

function toggleExport(event: Event): void {
  emit("update", { harnessMetricsExportEnabled: Boolean(eventValue(event)) });
}

function applyRecommendation(action: HarnessMetricsRecommendationActionV1): void {
  emit("update", settingsPatchForRecommendationAction(action, props.settings));
}

async function exportMetrics(): Promise<void> {
  if (exporting.value || !enabled.value) return;
  exporting.value = true;
  error.value = "";
  notice.value = "";
  try {
    const response = await fetch("/api/harness-metrics/export");
    if (!response.ok) {
      const result = await response.json().catch(() => ({})) as { error?: string };
      throw new Error(result.error ?? "Harness metrics could not be exported.");
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    const disposition = response.headers.get("content-disposition") ?? "";
    link.download = /filename="([^"]+)"/.exec(disposition)?.[1] ?? "vraxis-harness-metrics.json";
    link.click();
    URL.revokeObjectURL(url);
    notice.value = "Aggregated harness metrics exported locally.";
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "Harness metrics could not be exported.";
  } finally {
    exporting.value = false;
  }
}

async function clearMetrics(): Promise<void> {
  if (clearing.value) return;
  clearing.value = true;
  error.value = "";
  notice.value = "";
  try {
    const response = await fetch("/api/harness-metrics", { method: "DELETE" });
    if (!response.ok) {
      const result = await response.json().catch(() => ({})) as { error?: string };
      throw new Error(result.error ?? "Harness metrics could not be cleared.");
    }
    notice.value = "Stored harness metrics were cleared.";
    await refreshSummary();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "Harness metrics could not be cleared.";
  } finally {
    clearing.value = false;
  }
}

watch(() => props.settings.harnessMetricsEnabled, () => {
  void refreshSummary();
}, { immediate: false });

onMounted(() => {
  void refreshSummary();
});
</script>

<template>
  <section class="settings-section harness-metrics-settings" aria-labelledby="harness-metrics-heading">
    <header>
      <span class="section-icon"><osx-icon name="sparkle" :size="19" /></span>
      <div>
        <h2 id="harness-metrics-heading">Runtime metrics</h2>
        <p>Track harness and provider outcomes, tool reliability, approvals, and verification locally to improve runtime defaults over time.</p>
      </div>
    </header>

    <osx-alert v-if="error" tone="error" title="Metrics unavailable" :description="error" />
    <osx-alert v-if="notice" tone="success" title="Metrics updated" :description="notice" />

    <div class="metrics-controls">
      <osx-toggle
        label="Record runtime metrics"
        :checked="enabled"
        :disabled="saving"
        @change="toggleEnabled"
      />
      <osx-toggle
        label="Apply high-confidence recommendations automatically"
        :checked="autoApply"
        :disabled="saving || !enabled"
        @change="toggleAutoApply"
      />
      <osx-toggle
        label="Include metrics in support bundle"
        :checked="exportEnabled"
        :disabled="saving || !enabled"
        @change="toggleExport"
      />
    </div>

    <div class="metrics-summary">
      <div>
        <strong>Recorded locally</strong>
        <span>Duration, tokens, tool success, approval waits, compactions, and verification outcomes. No prompts, paths, or command text.</span>
      </div>
      <div>
        <strong>Opt in</strong>
        <span>Metrics stay on this device until you export them or include them in a support bundle.</span>
      </div>
    </div>

    <div v-if="loading" class="metrics-loading">
      <osx-spinner size="small" label="Loading runtime metrics" show-label />
    </div>

    <template v-else>
      <HarnessMetricsScorecard
        v-if="enabled && summary && runtimeStats.length"
        :summary="summary"
        :runtimes="runtimes"
      />

      <HarnessRecommendationList
        v-if="enabled && recommendations.length"
        :recommendations="recommendations"
        :runtimes="runtimes"
        :saving="saving"
        @apply="applyRecommendation"
        @probe="emit('probe', $event)"
      />

      <p v-else-if="enabled && summary && !runtimeStats.length" class="metrics-empty">No runtime runs recorded yet. Complete a task to start building local metrics.</p>
      <p v-else-if="enabled && !summary" class="metrics-empty">No runtime runs recorded yet. Complete a task to start building local metrics.</p>
      <p v-else-if="!enabled" class="metrics-empty">Enable recording to start collecting local runtime metrics.</p>
    </template>

    <footer>
      <span><osx-icon name="lock" :size="14" /> Metrics never leave this device unless you export them.</span>
      <div class="metrics-actions">
        <osx-button size="small" icon="refresh" :loading="loading" :disabled="exporting || clearing" @click="refreshSummary">Refresh</osx-button>
        <osx-button size="small" icon="trash" tone="secondary" :loading="clearing" :disabled="!enabled || exporting || loading" @click="clearMetrics">Clear</osx-button>
        <osx-button size="small" icon="download" :loading="exporting" :disabled="!enabled || clearing || loading" @click="exportMetrics">Export</osx-button>
      </div>
    </footer>
  </section>
</template>

<style scoped>
.harness-metrics-settings { display: grid; gap: 14px; }
.metrics-controls { display: grid; gap: 10px; }
.metrics-summary { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1px; overflow: hidden; border: 1px solid var(--osx-border-soft); border-radius: 10px; background: var(--osx-border-soft); }
.metrics-summary > div { display: grid; gap: 4px; padding: 13px 14px; background: var(--osx-surface-sunken); }
.metrics-summary strong { font-size: 13px; font-weight: 620; }
.metrics-summary span, .metrics-empty, .metrics-window, footer { color: var(--osx-muted); font-size: 12px; line-height: 1.45; }
.metrics-loading { display: flex; justify-content: center; padding: 8px 0; }
.metrics-table-wrap { overflow: auto; border: 1px solid var(--osx-border-soft); border-radius: 10px; }
.metrics-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.metrics-table th, .metrics-table td { padding: 10px 12px; text-align: left; border-bottom: 1px solid var(--osx-border-soft); }
.metrics-table th { color: var(--osx-muted); font-weight: 600; background: var(--osx-surface-sunken); }
.metrics-table tr:last-child td { border-bottom: 0; }
.metrics-window { margin: 0; padding: 10px 12px 12px; }
footer { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
footer > span { display: inline-flex; align-items: center; gap: 6px; }
.metrics-actions { display: flex; flex-wrap: wrap; gap: 8px; }
@media (max-width: 720px) {
  .metrics-summary { grid-template-columns: 1fr; }
  footer { flex-direction: column; align-items: flex-start; }
}
</style>
