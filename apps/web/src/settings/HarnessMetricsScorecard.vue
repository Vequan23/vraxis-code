<script setup lang="ts">
import { computed } from "vue";
import type { HarnessMetricsSummaryV1, HarnessRuntimeStatsV1 } from "@vraxis/code-contracts";

const props = defineProps<{
  summary: HarnessMetricsSummaryV1;
}>();

function weightedAverage(values: Array<{ weight: number; value: number }>): number | undefined {
  const totalWeight = values.reduce((sum, item) => sum + item.weight, 0);
  if (!totalWeight) return undefined;
  return values.reduce((sum, item) => sum + item.value * item.weight, 0) / totalWeight;
}

const totals = computed(() => {
  const stats = props.summary.byRuntime;
  const runs = stats.reduce((sum, item) => sum + item.runs, 0);
  const toolReliability = weightedAverage(stats.map((item) => ({
    weight: item.runs,
    value: 1 - item.toolFailureRate,
  })));
  const avgTokens = weightedAverage(stats.flatMap((item) =>
    item.avgTokens !== undefined ? [{ weight: item.runs, value: item.avgTokens }] : []));
  const compactionRate = weightedAverage(stats.map((item) => ({
    weight: item.runs,
    value: item.compactionRate,
  })));
  const verificationPass = weightedAverage(stats.flatMap((item) =>
    item.verificationPassRate !== undefined ? [{ weight: item.runs, value: item.verificationPassRate }] : []));
  return { runs, toolReliability, avgTokens, compactionRate, verificationPass };
});

function percent(value: number | undefined): string {
  if (value === undefined) return "—";
  return `${Math.round(value * 100)}%`;
}

function formatTokens(value: number | undefined): string {
  if (value === undefined) return "—";
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return `${Math.round(value)}`;
}

function barWidth(value: number | undefined): string {
  if (value === undefined) return "0%";
  return `${Math.round(Math.min(Math.max(value, 0), 1) * 100)}%`;
}

function modeLabel(mode: HarnessRuntimeStatsV1["mode"]): string {
  return mode.charAt(0).toUpperCase() + mode.slice(1);
}

function runtimeLabel(stat: HarnessRuntimeStatsV1): string {
  const name = stat.runtimeId;
  return stat.runtimeVersion ? `${name} · ${stat.runtimeVersion}` : name;
}
</script>

<template>
  <section class="harness-scorecard" aria-label="Harness performance scorecard">
    <header>
      <strong>Local scorecard</strong>
      <span>{{ summary.totalRuns }} runs across {{ summary.byRuntime.length }} runtime/mode pairs in the last {{ summary.windowDays }} days.</span>
    </header>

    <div class="scorecard-cards">
      <article>
        <span>Tool reliability</span>
        <strong>{{ percent(totals.toolReliability) }}</strong>
        <i :style="{ width: barWidth(totals.toolReliability) }" />
      </article>
      <article>
        <span>Avg tokens / run</span>
        <strong>{{ formatTokens(totals.avgTokens) }}</strong>
        <i :style="{ width: barWidth(totals.avgTokens ? 1 - Math.min(totals.avgTokens / 120_000, 1) : undefined) }" />
      </article>
      <article>
        <span>Compaction rate</span>
        <strong>{{ percent(totals.compactionRate) }}</strong>
        <i :style="{ width: barWidth(totals.compactionRate) }" />
      </article>
      <article>
        <span>Verify pass</span>
        <strong>{{ percent(totals.verificationPass) }}</strong>
        <i :style="{ width: barWidth(totals.verificationPass) }" />
      </article>
    </div>

    <div class="scorecard-table-wrap">
      <table class="scorecard-table">
        <thead>
          <tr>
            <th scope="col">Runtime</th>
            <th scope="col">Mode</th>
            <th scope="col">Runs</th>
            <th scope="col">Tool reliability</th>
            <th scope="col">Avg tokens</th>
            <th scope="col">Compaction</th>
            <th scope="col">Verify pass</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="stat in summary.byRuntime" :key="`${stat.runtimeId}:${stat.mode}`">
            <td>{{ runtimeLabel(stat) }}</td>
            <td>{{ modeLabel(stat.mode) }}</td>
            <td>{{ stat.runs }}</td>
            <td>{{ percent(1 - stat.toolFailureRate) }}</td>
            <td>{{ formatTokens(stat.avgTokens) }}</td>
            <td>{{ percent(stat.compactionRate) }}</td>
            <td>{{ stat.verificationPassRate === undefined ? "—" : percent(stat.verificationPassRate) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped>
.harness-scorecard {
  display: grid;
  gap: 12px;
  padding: 14px;
  border: 1px solid var(--osx-border-soft);
  border-radius: 10px;
  background: var(--osx-surface-sunken);
}
.harness-scorecard > header { display: grid; gap: 4px; }
.harness-scorecard > header strong { font-size: 13px; font-weight: 620; }
.harness-scorecard > header span { color: var(--osx-muted); font-size: 12px; line-height: 1.45; }
.scorecard-cards {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}
.scorecard-cards article {
  display: grid;
  gap: 4px;
  padding: 11px 12px;
  border: 1px solid var(--osx-border-soft);
  border-radius: 8px;
  background: var(--osx-surface-raised);
}
.scorecard-cards span { color: var(--osx-muted); font-size: 11px; }
.scorecard-cards strong { font-size: 18px; font-weight: 640; line-height: 1.1; }
.scorecard-cards i {
  display: block;
  height: 4px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--osx-accent, #4d8dff) 70%, transparent);
}
.scorecard-table-wrap { overflow: auto; border: 1px solid var(--osx-border-soft); border-radius: 8px; }
.scorecard-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.scorecard-table th, .scorecard-table td { padding: 9px 11px; text-align: left; border-bottom: 1px solid var(--osx-border-soft); }
.scorecard-table th { color: var(--osx-muted); font-weight: 600; background: var(--osx-surface-raised); }
.scorecard-table tr:last-child td { border-bottom: 0; }
@media (max-width: 900px) {
  .scorecard-cards { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 560px) {
  .scorecard-cards { grid-template-columns: 1fr; }
}
</style>
