<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import type {
  HarnessMetricsRecommendationActionV1,
  HarnessMetricsSummaryV1,
  RuntimeMaintenanceActionSummary,
  RuntimeSummary,
  UpdateSettingsRequest,
  UserSettings,
} from "@vraxis/code-contracts";
import HarnessRecommendationList from "./HarnessRecommendationList.vue";
import { recommendationAppliesToRuntime, settingsPatchForRecommendationAction } from "./harness-recommendation-actions.js";
import { harnessLogoUrl } from "./harness-logos.js";
import type { SettingsSectionId } from "./settings-navigation.js";

const props = defineProps<{
  runtimes: RuntimeSummary[];
  settings: UserSettings;
  saving: boolean;
  refreshing: boolean;
  probingRuntimeId: string;
  embedded?: boolean;
  selectedRuntimeId?: string;
}>();

const emit = defineEmits<{
  refresh: [];
  update: [patch: UpdateSettingsRequest];
  maintain: [runtime: RuntimeSummary, action: RuntimeMaintenanceActionSummary];
  probe: [runtime: RuntimeSummary];
  navigate: [section: SettingsSectionId];
}>();

const selectedRuntimeIdRef = ref("");

watch(() => [props.runtimes, props.selectedRuntimeId] as const, ([runtimes, selectedRuntimeId]) => {
  if (selectedRuntimeId && runtimes.some((item) => item.id === selectedRuntimeId)) {
    selectedRuntimeIdRef.value = selectedRuntimeId;
    return;
  }
  if (runtimes.some((item) => item.id === selectedRuntimeIdRef.value)) return;
  selectedRuntimeIdRef.value = runtimes.find((item) => item.id === props.settings.defaultRuntimeId)?.id
    ?? runtimes.find((item) => item.availability === "installed")?.id
    ?? runtimes[0]?.id
    ?? "";
}, { immediate: true });

const selectedRuntime = computed(() => props.runtimes.find((item) => item.id === selectedRuntimeIdRef.value) ?? props.runtimes[0]);
const detailTab = ref<"models" | "configuration">("models");
const modelQuery = ref("");
const metricsSummary = ref<HarnessMetricsSummaryV1 | null>(null);
const metricsLoading = ref(false);
const selectedModelId = computed(() => selectedRuntime.value ? props.settings.runtimeModels?.[selectedRuntime.value.id] ?? "" : "");
const visibleModels = computed(() => {
  const needle = modelQuery.value.trim().toLowerCase();
  return (selectedRuntime.value?.models ?? []).filter((model) =>
    !needle || model.name.toLowerCase().includes(needle) || model.id.toLowerCase().includes(needle));
});
const visibleMaintenanceActions = computed(() => (selectedRuntime.value?.maintenanceActions ?? []).filter((action) => {
  if (action.id === "authenticate" && selectedRuntime.value?.authentication === "authenticated") return false;
  if (action.id === "update" && selectedRuntime.value?.update?.status === "current") return false;
  return true;
}));
const runtimeRecommendations = computed(() => {
  const runtime = selectedRuntime.value;
  if (!runtime || !props.settings.harnessMetricsEnabled) return [];
  return (metricsSummary.value?.recommendations ?? []).filter((item) => recommendationAppliesToRuntime(runtime.id, item));
});

const showModelSearch = computed(() => (selectedRuntime.value?.models.length ?? 0) > 6);

function eventValue(event: Event): unknown {
  return (event as CustomEvent<[unknown]>).detail?.[0];
}

function chooseDetailTab(event: Event): void {
  detailTab.value = String(eventValue(event)).toLowerCase() === "configuration" ? "configuration" : "models";
}

function isEnabled(runtime: RuntimeSummary): boolean {
  return !props.settings.disabledRuntimeIds?.includes(runtime.id);
}

function toggleRuntime(runtime: RuntimeSummary, event: Event): void {
  const enabled = Boolean(eventValue(event));
  const disabled = new Set(props.settings.disabledRuntimeIds ?? []);
  if (enabled) disabled.delete(runtime.id);
  else disabled.add(runtime.id);
  const patch: UpdateSettingsRequest = { disabledRuntimeIds: [...disabled] };
  if (!enabled && props.settings.defaultRuntimeId === runtime.id) {
    patch.defaultRuntimeId = props.runtimes.find((item) => item.id !== runtime.id && item.availability === "installed" && !disabled.has(item.id))?.id ?? null;
  }
  emit("update", patch);
}

function useModel(modelId: string): void {
  const runtime = selectedRuntime.value;
  if (!runtime) return;
  emit("update", { defaultRuntimeId: runtime.id, runtimeModels: { [runtime.id]: modelId } });
}

function useRuntimeDefault(): void {
  const runtime = selectedRuntime.value;
  if (!runtime) return;
  emit("update", { defaultRuntimeId: runtime.id, runtimeModels: { [runtime.id]: null } });
}

function setAsDefault(): void {
  if (selectedRuntime.value) emit("update", { defaultRuntimeId: selectedRuntime.value.id });
}

function updateModelQuery(event: Event): void {
  modelQuery.value = String(eventValue(event) ?? "");
}

function availabilityLabel(runtime: RuntimeSummary): string {
  if (runtime.availability === "missing" && runtime.applicationPath) return "CLI needed";
  if (runtime.availability === "missing") return "Not installed";
  if (runtime.availability === "setup-required") return "Setup needed";
  if (runtime.authentication === "required") return "Sign in needed";
  return "Ready";
}

function availabilityTone(runtime: RuntimeSummary): "success" | "warning" | "neutral" {
  if (runtime.availability === "installed" && runtime.authentication !== "required") return "success";
  if (runtime.applicationPath) return "warning";
  if (runtime.availability === "missing") return "neutral";
  return "warning";
}

function discoveryLabel(runtime: RuntimeSummary): string {
  if (runtime.modelDiscovery === "automatic") return "Live catalog";
  if (runtime.modelDiscovery === "aliases") return "Harness aliases";
  if (runtime.modelDiscovery === "manual") return "Manual model IDs";
  return "No catalog reported";
}

function checkedLabel(value?: string): string {
  if (!value) return "Not checked yet";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "Checked recently";
  return `Checked ${date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

function conformanceLabel(runtime: RuntimeSummary): string {
  if (runtime.conformance?.state === "ready") return "Verified";
  if (runtime.conformance?.state === "failed") return "Probe failed";
  if (runtime.conformance?.state === "limited") return "Limited";
  if (runtime.conformance?.state === "stale") return "Verify update";
  return "Not verified";
}

function conformanceListLabel(runtime: RuntimeSummary): string {
  if (runtime.conformance?.state === "ready") return "Verified";
  if (runtime.conformance?.state === "failed") return "Probe failed";
  if (runtime.conformance?.state === "limited") return "Limited";
  if (runtime.conformance?.state === "stale") return "Stale";
  return "Unverified";
}

function conformanceTone(runtime: RuntimeSummary): "success" | "warning" | "neutral" | "error" {
  if (runtime.conformance?.state === "ready") return "success";
  if (runtime.conformance?.state === "failed") return "error";
  if (runtime.conformance?.state === "limited" || runtime.conformance?.state === "stale") return "warning";
  return "neutral";
}

function hasHarnessLogo(runtimeId: string): boolean {
  return Boolean(harnessLogoUrl(runtimeId));
}

async function refreshMetricsSummary(): Promise<void> {
  if (!props.settings.harnessMetricsEnabled) {
    metricsSummary.value = null;
    return;
  }
  metricsLoading.value = true;
  try {
    const response = await fetch("/api/harness-metrics");
    if (!response.ok) {
      metricsSummary.value = null;
      return;
    }
    metricsSummary.value = await response.json() as HarnessMetricsSummaryV1;
  } catch {
    metricsSummary.value = null;
  } finally {
    metricsLoading.value = false;
  }
}

function applyRecommendation(action: HarnessMetricsRecommendationActionV1): void {
  emit("update", settingsPatchForRecommendationAction(action, props.settings));
}

watch(() => props.settings.harnessMetricsEnabled, () => {
  void refreshMetricsSummary();
}, { immediate: true });

onMounted(() => {
  void refreshMetricsSummary();
});
</script>

<template>
  <section v-if="!embedded" class="settings-section harness-settings" aria-labelledby="harness-settings-heading">
    <header class="harness-settings-header">
      <div class="provider-heading">
        <span class="section-icon"><osx-icon name="terminal" :size="19" /></span>
        <div>
          <h2 id="harness-settings-heading">Agent harnesses</h2>
          <p>Use an installed coding agent with its existing account, models, tools, and subscription.</p>
        </div>
      </div>
      <osx-button size="small" icon="refresh" :loading="refreshing" :disabled="saving" @click="emit('refresh')">Check again</osx-button>
    </header>

    <p class="settings-cross-link">
      Prefer a direct API connection?
      <button type="button" @click="emit('navigate', 'runtimes')">Open runtimes</button>
    </p>

    <div v-if="runtimes.length" class="harness-workbench">
      <aside class="harness-list" aria-label="Detected agent harnesses">
        <div class="harness-list-heading">
          <span>Detected on this device</span>
          <small>{{ runtimes.filter((item) => item.availability === 'installed').length }} ready<template v-if="runtimes.some((item) => item.applicationPath && item.availability !== 'installed')"> · {{ runtimes.filter((item) => item.applicationPath && item.availability !== 'installed').length }} app only</template></small>
        </div>
        <div
          v-for="runtime in runtimes"
          :key="runtime.id"
          :class="['harness-row', { selected: runtime.id === selectedRuntime?.id }]"
        >
          <button type="button" :aria-current="runtime.id === selectedRuntime?.id ? 'true' : undefined" @click="selectedRuntimeIdRef = runtime.id">
            <span :class="['harness-icon', { 'has-brand-logo': hasHarnessLogo(runtime.id) }]">
              <img v-if="hasHarnessLogo(runtime.id)" :src="harnessLogoUrl(runtime.id)" alt="" :aria-hidden="true" />
              <osx-icon v-else name="terminal" :size="16" />
            </span>
            <span class="harness-row-copy">
              <span class="harness-row-title">
                <strong>{{ runtime.name }}</strong>
              </span>
              <small>
                <i :class="availabilityTone(runtime)" />{{ availabilityLabel(runtime) }}<template v-if="runtime.availability === 'installed'"> · <span :class="['harness-conformance-text', conformanceTone(runtime)]">{{ conformanceListLabel(runtime) }}</span></template><template v-if="runtime.version"> · {{ runtime.version }}</template>
              </small>
            </span>
          </button>
          <osx-toggle
            label="Enabled"
            :checked="isEnabled(runtime)"
            :disabled="saving || runtime.availability !== 'installed'"
            @change="toggleRuntime(runtime, $event)"
          />
        </div>
        <footer>{{ checkedLabel(selectedRuntime?.checkedAt) }}</footer>
      </aside>

      <section v-if="selectedRuntime" class="harness-detail" :aria-label="`${selectedRuntime.name} details`">
        <header class="harness-detail-header">
          <div>
            <span :class="['harness-detail-icon', { 'has-brand-logo': hasHarnessLogo(selectedRuntime.id) }]">
              <img v-if="hasHarnessLogo(selectedRuntime.id)" :src="harnessLogoUrl(selectedRuntime.id)" alt="" :aria-hidden="true" />
              <osx-icon v-else name="terminal" :size="18" />
            </span>
            <span>
              <strong>{{ selectedRuntime.name }}</strong>
              <small>{{ selectedRuntime.version ?? 'Version unavailable' }}</small>
            </span>
          </div>
          <osx-badge :tone="availabilityTone(selectedRuntime)" size="small" :label="availabilityLabel(selectedRuntime)" />
        </header>

        <HarnessRecommendationList
          v-if="runtimeRecommendations.length"
          :recommendations="runtimeRecommendations"
          :runtimes="runtimes"
          :saving="saving || metricsLoading"
          compact
          @apply="applyRecommendation"
          @probe="emit('probe', $event)"
        />

        <osx-segmented-control class="harness-detail-switcher" items="Models,Configuration" :value="detailTab === 'models' ? 'Models' : 'Configuration'" label="Harness details" @change="chooseDetailTab" />

        <div v-if="detailTab === 'models'" class="harness-models">
          <div class="harness-model-toolbar">
            <div>
              <strong>Models</strong>
              <small>{{ discoveryLabel(selectedRuntime) }} · {{ selectedRuntime.models.length }} found</small>
            </div>
            <template v-if="showModelSearch">
              <osx-text-field
                label="Search models"
                type="search"
                icon="search"
                placeholder="Search"
                :value="modelQuery"
                @input="updateModelQuery"
              />
            </template>
          </div>
          <p v-if="selectedRuntime.modelDiscovery === 'aliases'" class="harness-note">
            This harness exposes stable model aliases rather than a complete live catalog. Vraxis passes your selection to the harness unchanged.
          </p>
          <p v-else-if="selectedRuntime.applicationPath && selectedRuntime.availability === 'missing'" class="harness-note">
            The desktop app is installed, but the separate coding CLI is not available. Install or enable the CLI to discover models and run tasks.
          </p>
          <div v-if="visibleModels.length" class="harness-model-list" role="list" aria-label="Available models">
            <button
              v-for="model in visibleModels"
              :key="model.id"
              type="button"
              role="listitem"
              :class="{ selected: selectedModelId === model.id || (!selectedModelId && model.isDefault) }"
              @click="useModel(model.id)"
            >
              <span>
                <strong>{{ model.name }}</strong>
                <small>{{ model.description ?? model.id }}</small>
              </span>
              <osx-icon v-if="selectedModelId === model.id || (!selectedModelId && model.isDefault)" name="check" :size="15" label="Selected" />
            </button>
          </div>
          <div v-else class="harness-model-empty">
            <osx-icon name="search" :size="18" />
            <span><strong>{{ modelQuery ? 'No matching models' : 'No models reported' }}</strong><small>{{ modelQuery ? 'Try another search.' : selectedRuntime.applicationPath && selectedRuntime.availability === 'missing' ? 'Install the coding CLI to load its models.' : 'You can still enter a model ID in the task composer.' }}</small></span>
          </div>
          <footer class="harness-model-footer">
            <span>Default: {{ selectedModelId || selectedRuntime.models.find((item) => item.isDefault)?.name || 'Harness default' }}</span>
            <osx-button v-if="selectedModelId" size="small" :disabled="saving" @click="useRuntimeDefault">Use harness default</osx-button>
          </footer>
        </div>

        <div v-else class="harness-configuration">
          <dl>
            <div><dt>Authentication</dt><dd><osx-badge size="small" :tone="selectedRuntime.authentication === 'authenticated' ? 'success' : selectedRuntime.authentication === 'required' ? 'warning' : 'neutral'" :label="selectedRuntime.authentication === 'authenticated' ? 'Authenticated' : selectedRuntime.authentication === 'required' ? 'Sign in needed' : 'Not reported'" /><small>{{ selectedRuntime.authenticationDetail }}</small></dd></div>
            <div><dt>Command</dt><dd><code>{{ selectedRuntime.executable ?? 'Coding CLI not found' }}</code></dd></div>
            <div v-if="selectedRuntime.applicationPath"><dt>Desktop app</dt><dd><code>{{ selectedRuntime.applicationPath }}</code><small v-if="selectedRuntime.availability === 'missing'">Detected separately; this app does not expose a usable coding harness.</small></dd></div>
            <div><dt>Model catalog</dt><dd>{{ discoveryLabel(selectedRuntime) }}</dd></div>
            <div><dt>Updates</dt><dd><osx-badge size="small" :tone="selectedRuntime.update?.status === 'available' ? 'warning' : selectedRuntime.update?.status === 'current' ? 'success' : 'neutral'" :label="selectedRuntime.update?.status === 'available' ? 'Update available' : selectedRuntime.update?.status === 'current' ? 'Current' : 'Managed by harness'" /><small>{{ selectedRuntime.update?.detail }}</small></dd></div>
          </dl>
          <section class="runtime-conformance" aria-label="Vraxis runtime conformance">
            <header>
              <div>
                <strong>Vraxis conformance</strong>
                <small>{{ selectedRuntime.conformance?.detail ?? 'Check this harness against the Vraxis adapter contract.' }}</small>
              </div>
              <span>
                <osx-badge size="small" :tone="conformanceTone(selectedRuntime)" :label="conformanceLabel(selectedRuntime)" />
                <osx-button
                  size="small"
                  icon="check"
                  :loading="probingRuntimeId === selectedRuntime.id"
                  :disabled="saving || refreshing || Boolean(probingRuntimeId) || selectedRuntime.availability !== 'installed'"
                  @click="emit('probe', selectedRuntime)"
                >
                  Verify live
                </osx-button>
              </span>
            </header>
            <p>A live probe sends one bounded request through this harness and may use provider quota. It never opens a project or grants filesystem, terminal, or browser authority.</p>
            <ul v-if="selectedRuntime.conformance?.checks.length">
              <li v-for="check in selectedRuntime.conformance.checks" :key="check.id">
                <osx-icon :name="check.state === 'passed' ? 'check' : check.state === 'failed' ? 'warning' : 'minus'" :size="14" />
                <span><strong>{{ check.label }}</strong><small>{{ check.detail }}</small></span>
              </li>
            </ul>
          </section>
          <section v-if="visibleMaintenanceActions.length" class="harness-maintenance" aria-label="Harness setup and maintenance">
            <div>
              <strong>Setup and maintenance</strong>
              <small>Vraxis prepares the official action. Commands still enter the terminal approval lifecycle.</small>
            </div>
            <osx-button
              v-for="action in visibleMaintenanceActions"
              :key="action.id"
              size="small"
              :icon="action.kind === 'documentation' ? 'external-link' : action.id === 'update' ? 'arrow-up' : 'terminal'"
              :disabled="saving"
              @click="emit('maintain', selectedRuntime, action)"
            >
              {{ action.label }}
            </osx-button>
          </section>
          <footer>
            <span>{{ props.settings.defaultRuntimeId === selectedRuntime.id ? 'Default for new tasks' : 'Available in the task composer' }}</span>
            <osx-button v-if="props.settings.defaultRuntimeId !== selectedRuntime.id && selectedRuntime.availability === 'installed'" size="small" :disabled="saving || !isEnabled(selectedRuntime)" @click="setAsDefault">Set as default</osx-button>
          </footer>
        </div>
      </section>
    </div>

    <osx-empty-state v-else-if="!embedded" title="No harnesses detected" description="Install Codex, Claude Code, Cursor Agent, or OpenCode, then check again." icon="terminal" />
  </section>

  <section v-else-if="embedded && selectedRuntime" class="harness-detail" :aria-label="`${selectedRuntime.name} details`">
    <header class="harness-detail-header">
      <div>
        <span :class="['harness-detail-icon', { 'has-brand-logo': hasHarnessLogo(selectedRuntime.id) }]">
          <img v-if="hasHarnessLogo(selectedRuntime.id)" :src="harnessLogoUrl(selectedRuntime.id)" alt="" :aria-hidden="true" />
          <osx-icon v-else name="terminal" :size="18" />
        </span>
        <span>
          <strong>{{ selectedRuntime.name }}</strong>
          <small>{{ selectedRuntime.version ?? 'Version unavailable' }}</small>
        </span>
      </div>
      <osx-badge :tone="availabilityTone(selectedRuntime)" size="small" :label="availabilityLabel(selectedRuntime)" />
    </header>

    <HarnessRecommendationList
      v-if="runtimeRecommendations.length"
      :recommendations="runtimeRecommendations"
      :runtimes="runtimes"
      :saving="saving || metricsLoading"
      compact
      @apply="applyRecommendation"
      @probe="emit('probe', $event)"
    />

    <osx-segmented-control class="harness-detail-switcher" items="Models,Configuration" :value="detailTab === 'models' ? 'Models' : 'Configuration'" label="Harness details" @change="chooseDetailTab" />

    <div v-if="detailTab === 'models'" class="harness-models">
      <div class="harness-model-toolbar">
        <div>
          <strong>Models</strong>
          <small>{{ discoveryLabel(selectedRuntime) }} · {{ selectedRuntime.models.length }} found</small>
        </div>
        <template v-if="showModelSearch">
          <osx-text-field
            label="Search models"
            type="search"
            icon="search"
            placeholder="Search"
            :value="modelQuery"
            @input="updateModelQuery"
          />
        </template>
      </div>
      <p v-if="selectedRuntime.modelDiscovery === 'aliases'" class="harness-note">
        This harness exposes stable model aliases rather than a complete live catalog. Vraxis passes your selection to the harness unchanged.
      </p>
      <p v-else-if="selectedRuntime.applicationPath && selectedRuntime.availability === 'missing'" class="harness-note">
        The desktop app is installed, but the separate coding CLI is not available. Install or enable the CLI to discover models and run tasks.
      </p>
      <div v-if="visibleModels.length" class="harness-model-list" role="list" aria-label="Available models">
        <button
          v-for="model in visibleModels"
          :key="model.id"
          type="button"
          role="listitem"
          :class="{ selected: selectedModelId === model.id || (!selectedModelId && model.isDefault) }"
          @click="useModel(model.id)"
        >
          <span>
            <strong>{{ model.name }}</strong>
            <small>{{ model.description ?? model.id }}</small>
          </span>
          <osx-icon v-if="selectedModelId === model.id || (!selectedModelId && model.isDefault)" name="check" :size="15" label="Selected" />
        </button>
      </div>
      <div v-else class="harness-model-empty">
        <osx-icon name="search" :size="18" />
        <span><strong>{{ modelQuery ? 'No matching models' : 'No models reported' }}</strong><small>{{ modelQuery ? 'Try another search.' : selectedRuntime.applicationPath && selectedRuntime.availability === 'missing' ? 'Install the coding CLI to load its models.' : 'You can still enter a model ID in the task composer.' }}</small></span>
      </div>
      <footer class="harness-model-footer">
        <span>Default: {{ selectedModelId || selectedRuntime.models.find((item) => item.isDefault)?.name || 'Harness default' }}</span>
        <osx-button v-if="selectedModelId" size="small" :disabled="saving" @click="useRuntimeDefault">Use harness default</osx-button>
      </footer>
    </div>

    <div v-else class="harness-configuration">
      <dl>
        <div><dt>Authentication</dt><dd><osx-badge size="small" :tone="selectedRuntime.authentication === 'authenticated' ? 'success' : selectedRuntime.authentication === 'required' ? 'warning' : 'neutral'" :label="selectedRuntime.authentication === 'authenticated' ? 'Authenticated' : selectedRuntime.authentication === 'required' ? 'Sign in needed' : 'Not reported'" /><small>{{ selectedRuntime.authenticationDetail }}</small></dd></div>
        <div><dt>Command</dt><dd><code>{{ selectedRuntime.executable ?? 'Coding CLI not found' }}</code></dd></div>
        <div v-if="selectedRuntime.applicationPath"><dt>Desktop app</dt><dd><code>{{ selectedRuntime.applicationPath }}</code><small v-if="selectedRuntime.availability === 'missing'">Detected separately; this app does not expose a usable coding harness.</small></dd></div>
        <div><dt>Model catalog</dt><dd>{{ discoveryLabel(selectedRuntime) }}</dd></div>
        <div><dt>Updates</dt><dd><osx-badge size="small" :tone="selectedRuntime.update?.status === 'available' ? 'warning' : selectedRuntime.update?.status === 'current' ? 'success' : 'neutral'" :label="selectedRuntime.update?.status === 'available' ? 'Update available' : selectedRuntime.update?.status === 'current' ? 'Current' : 'Managed by harness'" /><small>{{ selectedRuntime.update?.detail }}</small></dd></div>
      </dl>
      <section class="runtime-conformance" aria-label="Vraxis runtime conformance">
        <header>
          <div>
            <strong>Vraxis conformance</strong>
            <small>{{ selectedRuntime.conformance?.detail ?? 'Check this harness against the Vraxis adapter contract.' }}</small>
          </div>
          <span>
            <osx-badge size="small" :tone="conformanceTone(selectedRuntime)" :label="conformanceLabel(selectedRuntime)" />
            <osx-button
              size="small"
              icon="check"
              :loading="probingRuntimeId === selectedRuntime.id"
              :disabled="saving || refreshing || Boolean(probingRuntimeId) || selectedRuntime.availability !== 'installed'"
              @click="emit('probe', selectedRuntime)"
            >
              Verify live
            </osx-button>
          </span>
        </header>
        <p>A live probe sends one bounded request through this harness and may use provider quota. It never opens a project or grants filesystem, terminal, or browser authority.</p>
        <ul v-if="selectedRuntime.conformance?.checks.length">
          <li v-for="check in selectedRuntime.conformance.checks" :key="check.id">
            <osx-icon :name="check.state === 'passed' ? 'check' : check.state === 'failed' ? 'warning' : 'minus'" :size="14" />
            <span><strong>{{ check.label }}</strong><small>{{ check.detail }}</small></span>
          </li>
        </ul>
      </section>
      <section v-if="visibleMaintenanceActions.length" class="harness-maintenance" aria-label="Harness setup and maintenance">
        <div>
          <strong>Setup and maintenance</strong>
          <small>Vraxis prepares the official action. Commands still enter the terminal approval lifecycle.</small>
        </div>
        <osx-button
          v-for="action in visibleMaintenanceActions"
          :key="action.id"
          size="small"
          :icon="action.kind === 'documentation' ? 'external-link' : action.id === 'update' ? 'arrow-up' : 'terminal'"
          :disabled="saving"
          @click="emit('maintain', selectedRuntime, action)"
        >
          {{ action.label }}
        </osx-button>
      </section>
      <footer>
        <span>{{ props.settings.defaultRuntimeId === selectedRuntime.id ? 'Default for new tasks' : 'Available in the task composer' }}</span>
        <osx-button v-if="props.settings.defaultRuntimeId !== selectedRuntime.id && selectedRuntime.availability === 'installed'" size="small" :disabled="saving || !isEnabled(selectedRuntime)" @click="setAsDefault">Set as default</osx-button>
      </footer>
    </div>
  </section>
</template>
