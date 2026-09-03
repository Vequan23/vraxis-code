<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type {
  ModelProviderSummary,
  RuntimeMaintenanceActionSummary,
  RuntimeSummary,
  UpdateSettingsRequest,
  UserSettings,
} from "@vraxis/code-contracts";
import AgentHarnessSettings from "./AgentHarnessSettings.vue";
import ModelProviderSettings from "./ModelProviderSettings.vue";
import { harnessLogoUrl } from "./harness-logos.js";
import { runtimeConformanceLabel, runtimeConformanceTone } from "./runtime-conformance.js";
import type { SettingsSectionId } from "./settings-navigation.js";

const props = defineProps<{
  localRuntimes: RuntimeSummary[];
  hostedRuntimes: RuntimeSummary[];
  providers: ModelProviderSummary[];
  settings: UserSettings;
  saving: boolean;
  refreshing: boolean;
  probingRuntimeId: string;
  initialFocus?: "harness" | "provider";
}>();

const emit = defineEmits<{
  refresh: [];
  update: [patch: UpdateSettingsRequest];
  maintain: [runtime: RuntimeSummary, action: RuntimeMaintenanceActionSummary];
  probe: [runtime: RuntimeSummary];
  connected: [providerId: string];
  changed: [];
  navigate: [section: SettingsSectionId];
}>();

const selectedId = ref("");
const showingProviderForm = ref(false);

const allRuntimes = computed(() => [...props.localRuntimes, ...props.hostedRuntimes]);
const selectedRuntime = computed(() => allRuntimes.value.find((item) => item.id === selectedId.value));
const selectedIsHarness = computed(() =>
  Boolean(selectedRuntime.value && props.localRuntimes.some((item) => item.id === selectedRuntime.value!.id)));
const selectedIsProvider = computed(() =>
  Boolean(selectedRuntime.value && props.hostedRuntimes.some((item) => item.id === selectedRuntime.value!.id)));

function pickInitialSelection(): void {
  if (allRuntimes.value.some((item) => item.id === selectedId.value)) return;
  const preferredKind = props.initialFocus === "provider" ? "hosted-provider" : props.initialFocus === "harness" ? "local-cli" : undefined;
  selectedId.value = allRuntimes.value.find((item) => item.id === props.settings.defaultRuntimeId)?.id
    ?? (preferredKind
      ? allRuntimes.value.find((item) => item.kind === preferredKind && item.availability === "installed")?.id
      : undefined)
    ?? allRuntimes.value.find((item) => item.availability === "installed")?.id
    ?? allRuntimes.value[0]?.id
    ?? "";
}

watch([() => props.localRuntimes, () => props.hostedRuntimes, () => props.initialFocus], pickInitialSelection, { immediate: true });

watch(() => props.initialFocus, (focus) => {
  if (focus === "provider") showingProviderForm.value = true;
}, { immediate: true });

function isEnabled(runtimeId: string): boolean {
  return !props.settings.disabledRuntimeIds?.includes(runtimeId);
}

function availabilityLabel(runtime: RuntimeSummary): string {
  if (runtime.availability === "missing" && runtime.applicationPath) return "CLI needed";
  if (runtime.availability === "missing") return "Not installed";
  if (runtime.availability === "setup-required") return "Setup needed";
  if (runtime.authentication === "required") return "Sign in needed";
  if (runtime.kind === "hosted-provider") return runtimeConformanceLabel(runtime);
  return "Ready";
}

function availabilityTone(runtime: RuntimeSummary): "success" | "warning" | "neutral" {
  if (runtime.availability !== "installed" || runtime.authentication === "required") {
    if (runtime.applicationPath) return "warning";
    if (runtime.availability === "missing") return "neutral";
    return "warning";
  }
  if (runtime.kind === "hosted-provider" || runtime.conformance) {
    const tone = runtimeConformanceTone(runtime);
    return tone === "error" ? "warning" : tone;
  }
  return "success";
}

function conformanceListLabel(runtime: RuntimeSummary): string {
  return runtimeConformanceLabel(runtime);
}

function conformanceTone(runtime: RuntimeSummary): string {
  return runtimeConformanceTone(runtime);
}

function hasHarnessLogo(runtimeId: string): boolean {
  return Boolean(harnessLogoUrl(runtimeId));
}

function providerName(runtimeId: string): string {
  return props.providers.find((item) => item.id === runtimeId)?.name ?? runtimeId;
}
</script>

<template>
  <section class="settings-section runtime-settings" aria-labelledby="runtime-settings-heading">
    <header class="harness-settings-header">
      <div class="provider-heading">
        <span class="section-icon"><osx-icon name="terminal" :size="19" /></span>
        <div>
          <h2 id="runtime-settings-heading">Runtimes</h2>
          <p>Installed coding agents and direct provider connections for governed tasks.</p>
        </div>
      </div>
      <div class="runtime-settings-actions">
        <osx-button size="small" icon="plus" @click="showingProviderForm = true">Add provider</osx-button>
        <osx-button size="small" icon="refresh" :loading="refreshing" :disabled="saving" @click="emit('refresh')">Check again</osx-button>
      </div>
    </header>

    <ModelProviderSettings
      v-if="showingProviderForm"
      embedded
      form-only
      :providers="providers"
      :runtimes="hostedRuntimes"
      :settings="settings"
      :saving="saving"
      :probing-runtime-id="probingRuntimeId"
      @update="emit('update', $event)"
      @connected="(providerId) => { showingProviderForm = false; selectedId = providerId; emit('connected', providerId); }"
      @changed="emit('changed')"
      @probe="emit('probe', $event)"
      @cancel="showingProviderForm = false"
    />

    <div v-if="allRuntimes.length && !showingProviderForm" class="harness-workbench runtime-workbench">
      <aside class="harness-list runtime-list" aria-label="Configured runtimes">
        <div v-if="localRuntimes.length" class="runtime-list-group">
          <div class="harness-list-heading">
            <span>Agent harnesses</span>
            <small>{{ localRuntimes.filter((item) => item.availability === 'installed').length }} ready</small>
          </div>
          <div
            v-for="runtime in localRuntimes"
            :key="runtime.id"
            :class="['runtime-row', 'harness-row', { selected: runtime.id === selectedId }]"
          >
            <button type="button" :aria-current="runtime.id === selectedId ? 'true' : undefined" @click="selectedId = runtime.id">
              <span :class="['harness-icon', { 'has-brand-logo': hasHarnessLogo(runtime.id) }]">
                <img v-if="hasHarnessLogo(runtime.id)" :src="harnessLogoUrl(runtime.id)" alt="" :aria-hidden="true" />
                <osx-icon v-else name="terminal" :size="16" />
              </span>
              <span class="harness-row-copy">
                <span class="harness-row-title"><strong>{{ runtime.name }}</strong></span>
                <small>
                  <i :class="availabilityTone(runtime)" />{{ availabilityLabel(runtime) }}<template v-if="runtime.availability === 'installed'"> · <span :class="['harness-conformance-text', conformanceTone(runtime)]">{{ conformanceListLabel(runtime) }}</span></template>
                </small>
              </span>
            </button>
          </div>
        </div>

        <div v-if="hostedRuntimes.length" class="runtime-list-group">
          <div class="harness-list-heading">
            <span>Direct providers</span>
            <small>{{ hostedRuntimes.length }} connected</small>
          </div>
          <div
            v-for="runtime in hostedRuntimes"
            :key="runtime.id"
            :class="['runtime-row', 'provider-row', { selected: runtime.id === selectedId }]"
          >
            <button type="button" :aria-current="runtime.id === selectedId ? 'true' : undefined" @click="selectedId = runtime.id">
              <span class="provider-row-icon"><osx-icon name="cloud" :size="16" /></span>
              <span class="provider-row-copy">
                <span class="provider-row-title"><strong>{{ providerName(runtime.id) }}</strong></span>
                <small>{{ isEnabled(runtime.id) ? 'Enabled' : 'Disabled' }} · <span :class="['harness-conformance-text', conformanceTone(runtime)]">{{ conformanceListLabel(runtime) }}</span></small>
              </span>
            </button>
          </div>
        </div>
      </aside>

      <AgentHarnessSettings
        v-if="selectedIsHarness && selectedRuntime"
        embedded
        :runtimes="localRuntimes"
        :settings="settings"
        :saving="saving"
        :refreshing="refreshing"
        :probing-runtime-id="probingRuntimeId"
        :selected-runtime-id="selectedRuntime.id"
        @update="emit('update', $event)"
        @refresh="emit('refresh')"
        @maintain="(runtime, action) => emit('maintain', runtime, action)"
        @probe="emit('probe', $event)"
      />

      <ModelProviderSettings
        v-else-if="selectedIsProvider && selectedRuntime"
        embedded
        :providers="providers"
        :runtimes="hostedRuntimes"
        :settings="settings"
        :saving="saving"
        :probing-runtime-id="probingRuntimeId"
        :selected-provider-id="selectedRuntime.id"
        @update="emit('update', $event)"
        @connected="emit('connected', $event)"
        @changed="emit('changed')"
        @probe="emit('probe', $event)"
      />

      <div v-else-if="selectedRuntime" class="runtime-detail-placeholder">
        <osx-icon name="terminal" :size="18" />
        <span><strong>{{ selectedRuntime.name }}</strong><small>Details for this runtime are unavailable right now. Try Check again.</small></span>
      </div>
    </div>

    <osx-empty-state
      v-else-if="!showingProviderForm"
      title="No runtimes configured"
      description="Install a coding agent CLI or connect a model provider to start governed tasks."
      icon="terminal"
    />
  </section>
</template>

<style scoped>
.runtime-settings-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.runtime-detail-placeholder {
  display: grid;
  place-content: center;
  gap: 10px;
  min-height: 280px;
  padding: 24px;
  border: 1px solid var(--osx-border-soft);
  border-radius: 12px;
  background: var(--osx-surface-sunken);
  color: var(--osx-muted);
  text-align: center;
}
.runtime-detail-placeholder span { display: grid; gap: 4px; }
.runtime-detail-placeholder strong { color: var(--osx-text); font-size: 14px; }
.runtime-detail-placeholder small { font-size: 12px; line-height: 1.45; }
@media (max-width: 900px) {
  .runtime-workbench { grid-template-columns: 1fr; }
}
</style>
