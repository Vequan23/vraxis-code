<script setup lang="ts">
import type { AuthorityMode } from "@vraxis/code-contracts";

defineProps<{ value: AuthorityMode; saving: boolean }>();
const emit = defineEmits<{ change: [value: AuthorityMode] }>();

const options = [
  { value: "supervised", label: "Supervised", description: "Approve each guarded action once." },
  { value: "trusted-worktree", label: "Trusted Worktree", description: "You may remember an exact scope for this task." },
  { value: "full-access", label: "Full Access", description: "You may remember an exact scope for this project." },
];

function choose(event: Event): void {
  const value = String((event as CustomEvent<[unknown]>).detail?.[0] ?? "").toLowerCase();
  if (value === "supervised" || value === "trusted-worktree" || value === "full-access") emit("change", value);
}
</script>

<template>
  <section class="settings-section authority-settings" aria-labelledby="authority-mode-heading">
    <header>
      <span class="section-icon"><osx-icon name="shield-check" :size="19" /></span>
      <div>
        <h2 id="authority-mode-heading">Approval mode</h2>
        <p>Choose how broadly an explicit decision may be remembered. A mode never authorizes an action by itself.</p>
      </div>
    </header>

    <osx-radio-group
      label="Approval mode"
      name="authority-mode"
      variant="cards"
      orientation="vertical"
      :options="options"
      :value="value"
      :disabled="saving"
      @change="choose"
    />

    <osx-alert
      tone="info"
      title="Hard stops stay hard"
      description="Credentials, destructive actions, and unknown external effects always require a fresh decision. Team policy can require more approval or deny an action entirely."
    />
  </section>
</template>
