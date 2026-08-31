<script setup lang="ts">
import { computed } from "vue";
import type { ApprovalRuleSummary, ProjectSummary } from "@vraxis/code-contracts";

const props = defineProps<{
  rules: ApprovalRuleSummary[];
  projects: ProjectSummary[];
  loading: boolean;
  exporting: boolean;
  actionId: string;
  error: string;
  notice: string;
}>();

defineEmits<{
  refresh: [];
  export: [];
  revoke: [id: string];
}>();

const allowed = computed(() => props.rules.filter((item) => item.effect === "allow").length);
const denied = computed(() => props.rules.filter((item) => item.effect === "deny").length);

function projectName(projectId: string): string {
  return props.projects.find((item) => item.id === projectId)?.name ?? "Unavailable project";
}

function createdLabel(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(undefined, { dateStyle: "medium" });
}

function ruleLabel(rule: ApprovalRuleSummary): string {
  return rule.source === rule.capability ? rule.capability : `${rule.capability} · ${rule.source}`;
}
</script>

<template>
  <section class="settings-section permission-center" aria-labelledby="permission-settings">
    <header class="permission-header">
      <span class="section-icon"><osx-icon name="lock" :size="19" /></span>
      <div>
        <h2 id="permission-settings">Access &amp; approvals</h2>
        <p>Review the exact authority Vraxis Code can reuse without asking again.</p>
      </div>
      <span class="permission-header-actions">
        <osx-icon-button label="Refresh remembered access" icon="refresh" size="small" :disabled="loading" @click="$emit('refresh')" />
        <osx-button size="small" icon="download" :loading="exporting" :disabled="loading" @click="$emit('export')">Download audit</osx-button>
      </span>
    </header>

    <osx-alert v-if="error" tone="error" title="Remembered access is unavailable" :description="error" />
    <osx-alert v-else-if="notice" tone="success" title="Access updated" :description="notice" />

    <div class="permission-summary" aria-label="Remembered access summary">
      <span><strong>{{ rules.length }}</strong><small>active decisions</small></span>
      <span><strong>{{ allowed }}</strong><small>allowed scopes</small></span>
      <span><strong>{{ denied }}</strong><small>denied scopes</small></span>
    </div>

    <div v-if="loading" class="permission-loading" aria-label="Loading remembered access">
      <osx-skeleton variant="card" :lines="3" label="Loading remembered access" />
    </div>

    <osx-empty-state
      v-else-if="!rules.length"
      title="No remembered access"
      description="Vraxis Code will ask before the next guarded command, browser action, network request, or project write."
      icon="unlock"
    />

    <ul v-else class="permission-rule-list" aria-label="Active remembered access">
      <li v-for="rule in rules" :key="rule.id">
        <div class="permission-rule-heading">
          <span>
            <osx-badge
              size="small"
              :label="rule.effect === 'allow' ? 'Allowed' : 'Denied'"
              :tone="rule.effect === 'allow' ? 'success' : 'danger'"
            />
            <strong>{{ ruleLabel(rule) }}</strong>
          </span>
          <osx-button
            size="small"
            variant="danger"
            :loading="actionId === rule.id"
            :disabled="Boolean(actionId)"
            @click="$emit('revoke', rule.id)"
          >
            Revoke
          </osx-button>
        </div>
        <code>{{ rule.scope }}</code>
        <small>
          {{ projectName(rule.projectId) }} · {{ rule.duration === "session" ? "this task" : "this project" }} · remembered {{ createdLabel(rule.createdAt) }}
        </small>
      </li>
    </ul>

    <p class="permission-footnote">Revoking a decision never runs a command or changes project files. The next matching action must ask again.</p>
  </section>
</template>

<style scoped>
.permission-center { gap: 15px; }
.permission-header { align-items: flex-start; }
.permission-header > div { min-width: 0; flex: 1; }
.permission-header-actions { margin-left: auto; display: flex; align-items: center; gap: 7px; }
.permission-summary { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 1px; overflow: hidden; border: 1px solid var(--osx-border-soft, #384148); border-radius: 8px; background: var(--osx-border-soft, #384148); }
.permission-summary > span { min-width: 0; display: grid; gap: 2px; padding: 11px 12px; background: var(--osx-surface-sunken, #101416); }
.permission-summary strong { color: var(--osx-text, #eef1f2); font-size: 18px; font-weight: 600; }
.permission-summary small,
.permission-rule-list small,
.permission-footnote { color: var(--osx-muted, #98a0a5); font-size: 12px; line-height: 1.4; }
.permission-loading { min-height: 120px; }
.permission-rule-list { display: grid; gap: 7px; margin: 0; padding: 0; list-style: none; }
.permission-rule-list li { min-width: 0; display: grid; gap: 8px; padding: 12px; border: 1px solid var(--osx-border-soft, #384148); border-radius: 8px; background: var(--osx-surface-sunken, #101416); }
.permission-rule-heading { min-width: 0; display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.permission-rule-heading > span { min-width: 0; display: flex; align-items: center; gap: 8px; }
.permission-rule-heading strong { overflow: hidden; color: var(--osx-text, #eef1f2); font-size: 13px; font-weight: 600; text-overflow: ellipsis; text-transform: capitalize; white-space: nowrap; }
.permission-rule-list code { overflow: hidden; color: var(--osx-text-secondary, #c4c9cd); font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; text-overflow: ellipsis; white-space: nowrap; }
.permission-footnote { margin: 0; }
@media (max-width: 660px) {
  .permission-header { flex-wrap: wrap; }
  .permission-header-actions { width: 100%; margin-left: 46px; justify-content: flex-start; }
  .permission-summary { grid-template-columns: 1fr; }
  .permission-rule-heading { align-items: flex-start; }
  .permission-rule-heading > span { align-items: flex-start; flex-direction: column; }
}
</style>
