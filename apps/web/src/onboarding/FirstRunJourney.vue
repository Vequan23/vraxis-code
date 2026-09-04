<script setup lang="ts">
import { computed } from "vue";
import type {
  ProjectDoctorSummary,
  ProjectSummary,
  RuntimeSummary,
  SessionSummary,
  VerificationRunSummary,
} from "@vraxis/code-contracts";
import { firstRunReadiness, type FirstRunActionId } from "./first-run-readiness.js";

const props = defineProps<{
  runtime?: RuntimeSummary;
  project?: ProjectSummary;
  projectDoctor?: ProjectDoctorSummary;
  sessions: SessionSummary[];
  verificationRuns: VerificationRunSummary[];
  busy?: boolean;
  closable?: boolean;
}>();

const emit = defineEmits<{
  action: [action: FirstRunActionId];
  close: [];
}>();

const readiness = computed(() => firstRunReadiness(props));

function stepIcon(state: "complete" | "current" | "pending" | "attention"): string {
  if (state === "complete") return "check";
  if (state === "attention") return "warning";
  if (state === "current") return "arrow-right";
  return "minus";
}

function stepStateLabel(state: "complete" | "current" | "pending" | "attention"): string {
  if (state === "complete") return "Complete";
  if (state === "current") return "Current step";
  if (state === "attention") return "Needs attention";
  return "Pending";
}
</script>

<template>
  <section class="first-run" aria-labelledby="first-run-heading">
    <header>
      <span class="first-run-mark"><osx-icon name="shield-check" :size="20" /></span>
      <span>
        <small>Quick start · {{ readiness.completed }}/4 complete</small>
        <h1 id="first-run-heading">Your first trusted task</h1>
        <p>From a local repository to verifiable proof in one recoverable flow.</p>
      </span>
      <osx-icon-button v-if="closable" label="Close quick start" icon="close" size="small" @click="emit('close')" />
    </header>

    <ol>
      <li
        v-for="step in readiness.steps"
        :key="step.id"
        :data-state="step.state"
        :aria-current="step.state === 'current' ? 'step' : undefined"
      >
        <span class="step-state"><osx-icon :name="stepIcon(step.state)" :size="14" /></span>
        <span>
          <strong>{{ step.label }}<span class="visually-hidden"> · {{ stepStateLabel(step.state) }}</span></strong>
          <small>{{ step.detail }}</small>
        </span>
      </li>
    </ol>

    <footer>
      <span>
        <strong>{{ readiness.action.label }}</strong>
        <small>{{ readiness.action.detail }}</small>
      </span>
      <div class="first-run-actions">
        <osx-button
          v-if="readiness.action.id === 'choose-project'"
          variant="secondary"
          size="small"
          icon="plus"
          :loading="busy"
          :disabled="busy"
          @click="emit('action', 'create-project')"
        >
          Create new project
        </osx-button>
        <osx-button
          variant="primary"
          size="small"
          :icon="readiness.action.id === 'export-proof' ? 'download' : readiness.action.id === 'choose-project' ? 'folder-open' : 'arrow-right'"
          :loading="busy"
          :disabled="busy"
          @click="emit('action', readiness.action.id)"
        >
          {{ readiness.action.label }}
        </osx-button>
      </div>
    </footer>
  </section>
</template>

<style scoped>
.first-run {
  width: min(760px, calc(100% - 32px));
  margin: 14px auto;
  text-align: left;
  border: 1px solid var(--osx-border-color, #34383e);
  border-radius: 18px;
  background: color-mix(in srgb, var(--osx-control-background, #1b1d20) 92%, transparent);
  box-shadow: 0 18px 48px rgb(0 0 0 / 20%);
  overflow: hidden;
}

header {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 12px;
  align-items: start;
  padding: 14px 16px 13px;
}

header > span:nth-child(2) { min-width: 0; }

.first-run-mark,
.step-state {
  display: inline-grid;
  place-items: center;
  color: var(--osx-accent-color, #49a8e8);
}

.first-run-mark {
  width: 32px;
  height: 32px;
  border-radius: 10px;
  background: color-mix(in srgb, var(--osx-accent-color, #49a8e8) 14%, transparent);
}

header small,
footer small,
li small {
  display: block;
  color: var(--osx-secondary-label-color, #9b9ea4);
  font-size: 12px;
  line-height: 1.45;
}

header > span > small {
  margin-bottom: 3px;
  color: var(--osx-accent-color, #49a8e8);
  font-weight: 650;
  letter-spacing: .04em;
  text-transform: uppercase;
}

h1 {
  margin: 0;
  font: inherit;
  font-size: 18px;
  font-weight: 680;
  letter-spacing: -.015em;
}

p {
  margin: 4px 0 0;
  color: var(--osx-secondary-label-color, #9b9ea4);
  font-size: 12px;
}

ol {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1px;
  margin: 0;
  padding: 1px 0;
  list-style: none;
  background: var(--osx-border-color, #34383e);
}

li {
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr);
  gap: 8px;
  min-height: 58px;
  padding: 10px 14px;
  background: var(--osx-window-background, #151619);
}

li strong,
footer strong { display: block; font-size: 13px; font-weight: 620; }
li[data-state="pending"] .step-state { color: var(--osx-tertiary-label-color, #676b72); }
li[data-state="attention"] .step-state { color: var(--osx-warning-color, #f0aa3c); }
li[data-state="complete"] .step-state { color: var(--osx-success-color, #50b981); }

footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  padding: 11px 15px;
}

footer > span { min-width: 0; }

.first-run-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

@media (max-width: 680px) {
  .first-run { width: calc(100% - 20px); margin: 12px auto; }
  header { padding: 17px; }
  ol { grid-template-columns: 1fr; }
  footer { align-items: stretch; flex-direction: column; }
}
</style>
