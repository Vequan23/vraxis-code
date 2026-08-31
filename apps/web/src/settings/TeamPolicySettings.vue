<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import {
  approvalCapabilities,
  type ApprovalCapability,
  type TeamPolicyBundleV1,
  type TeamPolicyCreateRequest,
  type TeamPolicyEffect,
  type TeamPolicyState,
} from "@vraxis/code-contracts";

const props = defineProps<{
  state: TeamPolicyState;
  busy: boolean;
  error: string;
  notice: string;
}>();

const emit = defineEmits<{
  refresh: [];
  create: [request: TeamPolicyCreateRequest];
  import: [bundle: TeamPolicyBundleV1];
  remove: [];
  error: [message: string];
}>();

const fileInput = ref<HTMLInputElement>();
const creating = ref(false);
const confirmingRemoval = ref(false);
const organization = ref("");
const expirationDays = ref("none");
const effects = reactive<Record<ApprovalCapability, "inherit" | TeamPolicyEffect>>(
  Object.fromEntries(approvalCapabilities.map((capability) => [capability, "inherit"])) as Record<ApprovalCapability, "inherit" | TeamPolicyEffect>,
);
const effectOptions = [
  { value: "inherit", label: "Use local decisions" },
  { value: "ask", label: "Always ask" },
  { value: "deny", label: "Block" },
];
const expirationOptions = [
  { value: "none", label: "No expiration" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "365", label: "1 year" },
];
const labels: Record<ApprovalCapability, string> = {
  write: "Project writes",
  command: "Terminal commands",
  network: "Network access",
  browser: "Browser control",
  credentials: "Credentials",
  destructive: "Destructive actions",
  other: "Other guarded actions",
};
const selectedRules = computed(() => approvalCapabilities.flatMap((capability) => {
  const effect = effects[capability];
  return effect === "inherit" ? [] : [{ capability, effect }];
}));
const canCreate = computed(() => Boolean(organization.value.trim()) && selectedRules.value.length > 0 && !props.busy);

watch(() => props.state.status, () => {
  confirmingRemoval.value = false;
});

function eventValue(event: Event): string {
  const custom = event as CustomEvent<[string]>;
  return String(custom.detail?.[0] ?? (event.target as HTMLInputElement | null)?.value ?? "");
}

function updateEffect(capability: ApprovalCapability, event: Event): void {
  const value = eventValue(event);
  if (value === "inherit" || value === "ask" || value === "deny") effects[capability] = value;
}

function createPolicy(): void {
  if (!canCreate.value) return;
  const days = Number(expirationDays.value);
  emit("create", {
    organization: organization.value.trim(),
    rules: selectedRules.value,
    ...(Number.isFinite(days) && days > 0 ? { expiresAt: new Date(Date.now() + days * 86_400_000).toISOString() } : {}),
  });
}

async function importFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  if (file.size > 256 * 1024) {
    emit("error", "Team policy files must be 256 KB or smaller.");
    return;
  }
  try {
    emit("import", JSON.parse(await file.text()) as TeamPolicyBundleV1);
  } catch {
    emit("error", "Choose a valid signed team policy JSON file.");
  }
}

function chooseFile(): void {
  fileInput.value?.click();
}

function dateLabel(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(undefined, { dateStyle: "medium" });
}
</script>

<template>
  <section class="settings-section team-policy" aria-labelledby="team-policy-settings">
    <header class="team-policy-header">
      <span class="section-icon"><osx-icon name="lock" :size="19" /></span>
      <div>
        <h2 id="team-policy-settings">Team policy</h2>
        <p>Share signed approval rules across Vraxis Code installations.</p>
      </div>
      <osx-icon-button label="Refresh team policy" icon="refresh" size="small" :disabled="busy" @click="emit('refresh')" />
    </header>

    <osx-alert v-if="error" tone="error" title="Team policy was not updated" :description="error" />
    <osx-alert v-else-if="notice" tone="success" title="Team policy updated" :description="notice" />

    <div v-if="state.policy" class="team-policy-card" :data-status="state.status">
      <div class="team-policy-title">
        <span>
          <osx-badge
            size="small"
            :label="state.status === 'active' ? 'Active' : state.status === 'expired' ? 'Expired' : 'Signer not trusted'"
            :tone="state.status === 'active' ? 'success' : 'warning'"
          />
          <strong>{{ state.policy.organization }}</strong>
        </span>
        <small>Signed by {{ state.policy.signerLabel }}</small>
      </div>
      <ul aria-label="Team policy rules">
        <li v-for="rule in state.policy.rules" :key="rule.id">
          <span>{{ labels[rule.capability] }}</span>
          <osx-badge size="small" :label="rule.effect === 'deny' ? 'Blocked' : 'Always ask'" :tone="rule.effect === 'deny' ? 'danger' : 'warning'" />
        </li>
      </ul>
      <small>Issued {{ dateLabel(state.policy.issuedAt) }}<template v-if="state.policy.expiresAt"> · expires {{ dateLabel(state.policy.expiresAt) }}</template></small>
      <div v-if="confirmingRemoval" class="team-policy-confirm" role="group" aria-label="Confirm team policy removal">
        <p>Removing this policy widens local authority. Remembered rules may apply again.</p>
        <span>
          <osx-button size="small" :disabled="busy" @click="confirmingRemoval = false">Keep policy</osx-button>
          <osx-button variant="danger" size="small" :loading="busy" @click="emit('remove')">Remove policy</osx-button>
        </span>
      </div>
      <osx-button v-else variant="danger" size="small" :disabled="busy" @click="confirmingRemoval = true">Remove policy</osx-button>
    </div>

    <div v-else-if="state.status === 'untrusted'" class="team-policy-card" data-status="untrusted">
      <osx-alert
        tone="warning"
        title="Installed policy cannot be trusted"
        description="The saved policy is invalid or unreadable. Remembered access is suspended until you inspect or remove it."
      />
      <div v-if="confirmingRemoval" class="team-policy-confirm" role="group" aria-label="Confirm unreadable team policy removal">
        <p>Removing this policy widens local authority. Remembered rules may apply again.</p>
        <span>
          <osx-button size="small" :disabled="busy" @click="confirmingRemoval = false">Keep policy</osx-button>
          <osx-button variant="danger" size="small" :loading="busy" @click="emit('remove')">Remove policy</osx-button>
        </span>
      </div>
      <osx-button v-else variant="danger" size="small" :disabled="busy" @click="confirmingRemoval = true">Remove policy</osx-button>
    </div>

    <osx-empty-state
      v-else
      title="No team policy"
      description="Local approvals and remembered decisions control every guarded action."
      icon="unlock"
    />

    <div class="team-policy-actions">
      <input ref="fileInput" class="visually-hidden" type="file" accept="application/json,.json" aria-label="Choose signed team policy file" @change="importFile">
      <osx-button icon="upload" size="small" :disabled="busy" @click="chooseFile">Import signed policy</osx-button>
      <osx-button icon="download" size="small" :disabled="busy" @click="creating = !creating">
        {{ creating ? 'Close creator' : 'Create policy pack' }}
      </osx-button>
    </div>

    <form v-if="creating" class="team-policy-creator" @submit.prevent="createPolicy">
      <div>
        <h3>Create a signed policy pack</h3>
        <p>Choose only the rules your team needs. The pack is signed by this installation. Other installations must trust its public identity before import.</p>
      </div>
      <osx-text-field
        label="Team or organization"
        placeholder="Example Engineering"
        :maxlength="120"
        required
        :value="organization"
        @input="organization = eventValue($event)"
      />
      <osx-select
        label="Policy expiration"
        :options="expirationOptions"
        :value="expirationDays"
        :disabled="busy"
        @change="expirationDays = eventValue($event)"
      />
      <div class="team-policy-rule-grid" role="group" aria-label="Policy rules">
        <label v-for="capability in approvalCapabilities" :key="capability">
          <span>{{ labels[capability] }}</span>
          <osx-select
            :label="`${labels[capability]} policy`"
            :options="effectOptions"
            :value="effects[capability]"
            :disabled="busy"
            @change="updateEffect(capability, $event)"
          />
        </label>
      </div>
      <div class="team-policy-create-action">
        <span>{{ selectedRules.length }} rule{{ selectedRules.length === 1 ? '' : 's' }} selected</span>
        <osx-button type="submit" variant="primary" size="small" icon="download" :loading="busy" :disabled="!canCreate">Download signed policy</osx-button>
      </div>
    </form>
  </section>
</template>

<style scoped>
.team-policy { gap: 15px; }
.team-policy-header { align-items: flex-start; }
.team-policy-header > div { min-width: 0; flex: 1; }
.team-policy-card { display: grid; gap: 11px; padding: 13px; border: 1px solid var(--osx-border-soft, #384148); border-radius: 9px; background: var(--osx-surface-sunken, #101416); }
.team-policy-title { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.team-policy-title > span { display: flex; align-items: center; gap: 8px; }
.team-policy-title strong { font-size: 14px; font-weight: 600; }
.team-policy-card small,
.team-policy-creator p,
.team-policy-create-action > span { color: var(--osx-muted, #98a0a5); font-size: 12px; line-height: 1.45; }
.team-policy-card ul { display: grid; gap: 1px; margin: 0; padding: 0; overflow: hidden; border: 1px solid var(--osx-border-soft, #384148); border-radius: 7px; list-style: none; background: var(--osx-border-soft, #384148); }
.team-policy-card li { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 10px; background: var(--osx-surface, #171c1f); font-size: 12px; }
.team-policy-actions,
.team-policy-confirm > span,
.team-policy-create-action { display: flex; align-items: center; gap: 8px; }
.team-policy-confirm { display: grid; gap: 9px; padding: 11px; border: 1px solid var(--osx-danger, #d25b5b); border-radius: 7px; }
.team-policy-confirm p { margin: 0; font-size: 12px; line-height: 1.45; }
.team-policy-creator { display: grid; gap: 13px; padding: 14px; border: 1px solid var(--osx-border-soft, #384148); border-radius: 9px; background: var(--osx-surface-sunken, #101416); }
.team-policy-creator h3 { margin: 0 0 4px; font-size: 14px; }
.team-policy-creator p { margin: 0; max-width: 70ch; }
.team-policy-rule-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 9px; }
.team-policy-rule-grid label { min-width: 0; display: grid; gap: 5px; color: var(--osx-text-secondary, #c4c9cd); font-size: 12px; }
.team-policy-create-action { justify-content: space-between; }
.visually-hidden { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
@media (max-width: 660px) {
  .team-policy-title { flex-direction: column; }
  .team-policy-rule-grid { grid-template-columns: 1fr; }
  .team-policy-actions,
  .team-policy-create-action { align-items: stretch; flex-direction: column; }
}
</style>
