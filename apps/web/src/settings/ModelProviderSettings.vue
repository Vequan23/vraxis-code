<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import {
  type ModelProviderId,
  type ModelProviderSummary,
  type RuntimeSummary,
  type UpdateSettingsRequest,
  type UserSettings,
} from "@vraxis/code-contracts";
import type { SettingsSectionId } from "./settings-navigation.js";
import { runtimeConformanceLabel, runtimeConformanceTone } from "./runtime-conformance.js";

const props = defineProps<{
  providers: ModelProviderSummary[];
  runtimes: RuntimeSummary[];
  settings: UserSettings;
  saving: boolean;
  embedded?: boolean;
  formOnly?: boolean;
  selectedProviderId?: string;
  probingRuntimeId?: string;
}>();

const emit = defineEmits<{
  connected: [providerId: string];
  changed: [];
  update: [patch: UpdateSettingsRequest];
  navigate: [section: SettingsSectionId];
  probe: [runtime: RuntimeSummary];
  cancel: [];
}>();

const providerOptions = [
  { value: "", label: "Choose a provider" },
  { value: "openai", label: "OpenAI" },
  { value: "anthropic", label: "Anthropic" },
  { value: "google", label: "Google Gemini" },
  { value: "deepseek", label: "DeepSeek" },
  { value: "zai", label: "Z.AI / GLM" },
  { value: "groq", label: "Groq" },
  { value: "openrouter", label: "OpenRouter" },
  { value: "openai-compatible", label: "OpenAI-compatible endpoint" },
];

const showingForm = ref(false);
const submitting = ref(false);
const activeActionId = ref("");
const confirmingRemovalId = ref("");
const error = ref("");
const selectedProviderIdRef = ref("");
const modelQuery = ref("");
const form = reactive({
  provider: "" as ModelProviderId | "",
  name: "",
  apiKey: "",
  baseURL: "",
  model: "",
});

const isCustomProvider = computed(() => form.provider === "openai-compatible");
const selectedProviderName = computed(() => providerOptions.find((item) => item.value === form.provider)?.label ?? "provider");
const selectedProvider = computed(() => props.providers.find((item) => item.id === selectedProviderIdRef.value) ?? props.providers[0]);
const selectedRuntime = computed(() => props.runtimes.find((item) => item.id === selectedProvider.value?.id));
const selectedModelId = computed(() => {
  const provider = selectedProvider.value;
  if (!provider) return "";
  return props.settings.runtimeModels?.[provider.id] ?? "";
});
const showModelSearch = computed(() => (selectedProvider.value?.models.length ?? 0) > 6);
const visibleModels = computed(() => {
  const needle = modelQuery.value.trim().toLowerCase();
  return (selectedProvider.value?.models ?? []).filter((model) =>
    !needle || model.name.toLowerCase().includes(needle) || model.id.toLowerCase().includes(needle));
});

watch(() => [props.providers, props.selectedProviderId, props.formOnly] as const, ([providers, selectedProviderId, formOnly]) => {
  if (formOnly) {
    showingForm.value = true;
    return;
  }
  if (selectedProviderId && providers.some((item) => item.id === selectedProviderId)) {
    selectedProviderIdRef.value = selectedProviderId;
    return;
  }
  if (providers.some((item) => item.id === selectedProviderIdRef.value)) return;
  selectedProviderIdRef.value = providers.find((item) => item.id === props.settings.defaultRuntimeId)?.id
    ?? providers[0]?.id
    ?? "";
}, { immediate: true });

function eventValue(event: Event): unknown {
  return (event as CustomEvent<[unknown]>).detail?.[0];
}

function chooseProvider(event: Event): void {
  form.provider = String(eventValue(event)) as ModelProviderId | "";
  error.value = "";
}

function updateField(field: "name" | "apiKey" | "baseURL" | "model", event: Event): void {
  form[field] = String(eventValue(event) ?? "");
  error.value = "";
}

function updateModelQuery(event: Event): void {
  modelQuery.value = String(eventValue(event) ?? "");
}

function resetForm(): void {
  form.provider = "";
  form.name = "";
  form.apiKey = "";
  form.baseURL = "";
  form.model = "";
  error.value = "";
  if (props.formOnly) {
    emit("cancel");
    return;
  }
  showingForm.value = false;
}

function isEnabled(providerId: string): boolean {
  return !props.settings.disabledRuntimeIds?.includes(providerId);
}

function toggleProvider(providerId: string, event: Event): void {
  const enabled = Boolean(eventValue(event));
  const disabled = new Set(props.settings.disabledRuntimeIds ?? []);
  if (enabled) disabled.delete(providerId);
  else disabled.add(providerId);
  const patch: UpdateSettingsRequest = { disabledRuntimeIds: [...disabled] };
  if (!enabled && props.settings.defaultRuntimeId === providerId) {
    patch.defaultRuntimeId = props.providers.find((item) => item.id !== providerId && !disabled.has(item.id))?.id ?? null;
  }
  emit("update", patch);
}

function useModel(modelId: string): void {
  const provider = selectedProvider.value;
  if (!provider) return;
  emit("update", { defaultRuntimeId: provider.id, runtimeModels: { [provider.id]: modelId } });
}

function useProviderDefault(): void {
  const provider = selectedProvider.value;
  if (!provider) return;
  emit("update", { defaultRuntimeId: provider.id, runtimeModels: { [provider.id]: null } });
}

function setAsDefault(): void {
  if (selectedProvider.value) emit("update", { defaultRuntimeId: selectedProvider.value.id });
}

const conformanceLabel = runtimeConformanceLabel;
const conformanceTone = runtimeConformanceTone;

async function request(path: string, init: NonNullable<Parameters<typeof fetch>[1]>): Promise<ModelProviderSummary> {
  const response = await fetch(path, init);
  const result = await response.json() as ModelProviderSummary & { error?: string };
  if (!response.ok) throw new Error(result.error ?? "The provider request failed.");
  return result;
}

async function connectProvider(): Promise<void> {
  if (!form.provider || (!form.apiKey.trim() && !isCustomProvider.value)) {
    error.value = "Choose a provider and enter its API key.";
    return;
  }
  if (isCustomProvider.value && !form.baseURL.trim()) {
    error.value = "Enter the endpoint URL for this provider.";
    return;
  }
  submitting.value = true;
  error.value = "";
  try {
    const connected = await request("/api/model-providers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider: form.provider,
        ...(form.name.trim() ? { name: form.name.trim() } : {}),
        ...(form.apiKey.trim() ? { apiKey: form.apiKey.trim() } : {}),
        ...(form.baseURL.trim() ? { baseURL: form.baseURL.trim() } : {}),
        ...(form.model.trim() ? { model: form.model.trim() } : {}),
      }),
    });
    form.apiKey = "";
    resetForm();
    selectedProviderIdRef.value = connected.id;
    emit("connected", connected.id);
  } catch (caught) {
    form.apiKey = "";
    error.value = caught instanceof Error ? caught.message : "The provider could not be connected.";
  } finally {
    submitting.value = false;
  }
}

async function refreshProvider(provider: ModelProviderSummary): Promise<void> {
  activeActionId.value = provider.id;
  error.value = "";
  try {
    await request(`/api/model-providers/${encodeURIComponent(provider.id)}/refresh`, { method: "POST" });
    emit("changed");
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "Models could not be refreshed.";
  } finally {
    activeActionId.value = "";
  }
}

async function removeProvider(provider: ModelProviderSummary): Promise<void> {
  activeActionId.value = provider.id;
  error.value = "";
  try {
    const response = await fetch(`/api/model-providers/${encodeURIComponent(provider.id)}`, { method: "DELETE" });
    const result = await response.json() as { error?: string };
    if (!response.ok) throw new Error(result.error ?? "The connection could not be removed.");
    confirmingRemovalId.value = "";
    emit("changed");
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "The connection could not be removed.";
  } finally {
    activeActionId.value = "";
  }
}
</script>

<template>
  <section v-if="formOnly" class="settings-section provider-settings" aria-label="Connect model provider">
    <osx-alert v-if="error" tone="error" title="Provider not updated" :description="error" />
    <form class="provider-form" aria-label="Connect model provider" @submit.prevent="connectProvider">
      <div class="provider-form-intro">
        <strong>Connect a model provider</strong>
        <span>Vraxis stores your credentials, fetches the model catalog, then runs a bounded connection test automatically.</span>
      </div>
      <div class="provider-form-grid">
        <osx-select label="Provider" name="provider" required :options="providerOptions" :value="form.provider" :disabled="submitting" @change="chooseProvider" />
        <osx-text-field label="Connection name" name="connection-name" placeholder="Optional" :value="form.name" :disabled="submitting" @input="updateField('name', $event)" />
        <osx-text-field label="API key" name="api-key" type="password" autocomplete="off" :required="!isCustomProvider" :placeholder="form.provider ? `${selectedProviderName} API key` : 'Paste your provider API key'" :value="form.apiKey" :disabled="submitting" hint="Stored in the system credential store, never in project files." @input="updateField('apiKey', $event)" />
        <osx-text-field v-if="isCustomProvider" label="Endpoint URL" name="base-url" type="url" required placeholder="http://localhost:11434/v1" :value="form.baseURL" :disabled="submitting" @input="updateField('baseURL', $event)" />
        <osx-text-field label="Preferred model ID" name="model-id" placeholder="Use the provider default" :value="form.model" :disabled="submitting" hint="Optional. You can choose another discovered model later." @input="updateField('model', $event)" />
      </div>
      <footer class="provider-form-actions">
        <osx-button size="small" :disabled="submitting" @click="resetForm">Cancel</osx-button>
        <osx-button variant="primary" size="small" type="submit" :loading="submitting" :disabled="!form.provider">Connect</osx-button>
      </footer>
    </form>
  </section>

  <section v-else-if="embedded && selectedProvider" class="provider-detail" :aria-label="`${selectedProvider.name} details`">
    <osx-alert v-if="error" tone="error" title="Provider not updated" :description="error" />
    <header class="provider-detail-header">
      <div>
        <span class="provider-detail-icon"><osx-icon name="cloud" :size="18" /></span>
        <span>
          <strong>{{ selectedProvider.name }}</strong>
          <small>{{ selectedProvider.provider }} · {{ selectedProvider.models.length }} models</small>
        </span>
      </div>
      <osx-toggle label="Enabled" :checked="isEnabled(selectedProvider.id)" :disabled="saving" @change="toggleProvider(selectedProvider.id, $event)" />
    </header>

    <div class="provider-detail-body">
    <section v-if="selectedRuntime?.productCapabilities?.length" class="provider-capabilities" aria-label="Runtime capabilities">
      <header>
        <strong>Governed capabilities</strong>
        <small>Available when this provider is selected in the task composer.</small>
      </header>
      <ul>
        <li v-for="item in selectedRuntime.productCapabilities" :key="item.id">
          <osx-icon :name="item.state === 'available' ? 'check' : item.state === 'limited' ? 'info' : 'minus'" :size="14" />
          <span><strong>{{ item.label }}</strong><small>{{ item.detail }}</small></span>
          <osx-badge size="small" :label="item.state === 'available' ? 'Ready' : item.state === 'limited' ? 'Limited' : 'Unavailable'" :tone="item.state === 'available' ? 'success' : item.state === 'limited' ? 'warning' : 'neutral'" />
        </li>
      </ul>
    </section>

    <div class="harness-models">
      <div class="harness-model-toolbar">
        <div>
          <strong>Models</strong>
          <small>Live catalog · {{ selectedProvider.models.length }} found</small>
        </div>
        <osx-text-field v-if="showModelSearch" label="Search models" type="search" icon="search" placeholder="Search" :value="modelQuery" @input="updateModelQuery" />
      </div>
      <div v-if="visibleModels.length" class="harness-model-list" role="list" aria-label="Available models">
        <button v-for="model in visibleModels" :key="model.id" type="button" role="listitem" :class="{ selected: selectedModelId === model.id || (!selectedModelId && model.id === selectedProvider.model) }" @click="useModel(model.id)">
          <span><strong>{{ model.name }}</strong><small>{{ model.description ?? model.id }}</small></span>
          <osx-icon v-if="selectedModelId === model.id || (!selectedModelId && model.id === selectedProvider.model)" name="check" :size="15" label="Selected" />
        </button>
      </div>
      <div v-else class="harness-model-empty">
        <osx-icon name="search" :size="18" />
        <span><strong>No matching models</strong><small>Try another search or refresh the catalog.</small></span>
      </div>
      <footer class="harness-model-footer">
        <span>Default: {{ selectedModelId || selectedProvider.model }}</span>
        <osx-button v-if="selectedModelId" size="small" :disabled="saving" @click="useProviderDefault">Use provider default</osx-button>
      </footer>
    </div>

    <section class="runtime-conformance" aria-label="Provider connection test">
      <header>
        <div>
          <strong>Connection test</strong>
          <small>{{ selectedRuntime?.conformance?.detail ?? 'Run one bounded live request to verify credentials and model access.' }}</small>
        </div>
        <span>
          <osx-badge size="small" :tone="conformanceTone(selectedRuntime)" :label="conformanceLabel(selectedRuntime)" />
          <osx-button size="small" icon="check" :loading="probingRuntimeId === selectedProvider.id" :disabled="saving || Boolean(probingRuntimeId) || !isEnabled(selectedProvider.id)" @click="selectedRuntime && emit('probe', selectedRuntime)">Test connection</osx-button>
        </span>
      </header>
      <p>A connection test refreshes the model catalog and sends one bounded structured output request. It may use provider quota.</p>
      <ul v-if="selectedRuntime?.conformance?.checks.length">
        <li v-for="check in selectedRuntime.conformance.checks" :key="check.id">
          <osx-icon :name="check.state === 'passed' ? 'check' : check.state === 'failed' ? 'warning' : 'minus'" :size="14" />
          <span><strong>{{ check.label }}</strong><small>{{ check.detail }}</small></span>
        </li>
      </ul>
    </section>
    </div>

    <footer class="provider-detail-footer">
      <span>{{ settings.defaultRuntimeId === selectedProvider.id ? 'Default for new tasks' : 'Available in the task composer' }}</span>
      <div class="provider-detail-actions">
        <osx-button size="small" :loading="activeActionId === selectedProvider.id" :disabled="saving" @click="refreshProvider(selectedProvider)">Refresh models</osx-button>
        <div v-if="confirmingRemovalId === selectedProvider.id" class="provider-remove-confirm" role="group" :aria-label="`Remove ${selectedProvider.name}`">
          <span>Remove this connection?</span>
          <div>
            <osx-button size="small" :disabled="activeActionId === selectedProvider.id" @click="confirmingRemovalId = ''">Cancel</osx-button>
            <osx-button variant="danger" size="small" :loading="activeActionId === selectedProvider.id" @click="removeProvider(selectedProvider)">Remove</osx-button>
          </div>
        </div>
        <template v-else>
          <osx-button v-if="settings.defaultRuntimeId !== selectedProvider.id" size="small" :disabled="saving || !isEnabled(selectedProvider.id)" @click="setAsDefault">Set as default</osx-button>
          <osx-button size="small" :disabled="Boolean(activeActionId)" @click="confirmingRemovalId = selectedProvider.id">Remove</osx-button>
        </template>
      </div>
    </footer>
  </section>

  <section v-else class="settings-section provider-settings" aria-labelledby="provider-settings">
    <header class="provider-settings-header">
      <div class="provider-heading">
        <span class="section-icon"><osx-icon name="cloud" :size="19" /></span>
        <div>
          <h2 id="provider-settings">Model providers</h2>
          <p>Connect a provider directly, then use its models in any agent task.</p>
        </div>
      </div>
      <osx-button v-if="!showingForm" size="small" icon="plus" @click="showingForm = true">Add provider</osx-button>
    </header>

    <p class="settings-cross-link">
      Prefer an installed coding agent?
      <button type="button" @click="emit('navigate', 'runtimes')">Open runtimes</button>
    </p>

    <osx-alert v-if="error" tone="error" title="Provider not updated" :description="error" />

    <form v-if="showingForm" class="provider-form" aria-label="Connect model provider" @submit.prevent="connectProvider">
      <div class="provider-form-intro">
        <strong>Connect a model provider</strong>
        <span>Vraxis stores your credentials, fetches the model catalog, then runs a bounded connection test automatically.</span>
      </div>
      <div class="provider-form-grid">
        <osx-select label="Provider" name="provider" required :options="providerOptions" :value="form.provider" :disabled="submitting" @change="chooseProvider" />
        <osx-text-field label="Connection name" name="connection-name" placeholder="Optional" :value="form.name" :disabled="submitting" @input="updateField('name', $event)" />
        <osx-text-field label="API key" name="api-key" type="password" autocomplete="off" :required="!isCustomProvider" :placeholder="form.provider ? `${selectedProviderName} API key` : 'Paste your provider API key'" :value="form.apiKey" :disabled="submitting" hint="Stored in the system credential store, never in project files." @input="updateField('apiKey', $event)" />
        <osx-text-field v-if="isCustomProvider" label="Endpoint URL" name="base-url" type="url" required placeholder="http://localhost:11434/v1" :value="form.baseURL" :disabled="submitting" @input="updateField('baseURL', $event)" />
        <osx-text-field label="Preferred model ID" name="model-id" placeholder="Use the provider default" :value="form.model" :disabled="submitting" hint="Optional. You can choose another discovered model later." @input="updateField('model', $event)" />
      </div>
      <footer class="provider-form-actions">
        <osx-button size="small" :disabled="submitting" @click="resetForm">Cancel</osx-button>
        <osx-button variant="primary" size="small" type="submit" :loading="submitting" :disabled="!form.provider">Connect</osx-button>
      </footer>
    </form>

    <div v-if="providers.length" class="provider-workbench">
      <aside class="provider-list" aria-label="Connected model providers">
        <div class="provider-list-heading">
          <span>Connected</span>
          <small>{{ providers.length }}</small>
        </div>
        <div
          v-for="provider in providers"
          :key="provider.id"
          :class="['provider-row', { selected: provider.id === selectedProvider?.id }]"
        >
          <button type="button" :aria-current="provider.id === selectedProvider?.id ? 'true' : undefined" @click="selectedProviderIdRef = provider.id">
            <span class="provider-row-icon"><osx-icon name="cloud" :size="16" /></span>
            <span class="provider-row-copy">
              <span class="provider-row-title"><strong>{{ provider.name }}</strong></span>
              <small>{{ provider.models.length }} models · {{ isEnabled(provider.id) ? 'Enabled' : 'Disabled' }}</small>
            </span>
          </button>
          <osx-toggle
            label="Enabled"
            :checked="isEnabled(provider.id)"
            :disabled="saving"
            @change="toggleProvider(provider.id, $event)"
          />
        </div>
      </aside>

      <section v-if="selectedProvider" class="provider-detail" :aria-label="`${selectedProvider.name} details`">
        <header class="provider-detail-header">
          <div>
            <span class="provider-detail-icon"><osx-icon name="cloud" :size="18" /></span>
            <span>
              <strong>{{ selectedProvider.name }}</strong>
              <small>{{ selectedProvider.provider }} · {{ selectedProvider.models.length }} models</small>
            </span>
          </div>
          <osx-badge size="small" :tone="conformanceTone(selectedRuntime)" :label="conformanceLabel(selectedRuntime)" />
        </header>

        <div class="provider-detail-body">
        <section v-if="selectedRuntime?.productCapabilities?.length" class="provider-capabilities" aria-label="Runtime capabilities">
          <header>
            <strong>Governed capabilities</strong>
            <small>Available when this provider is selected in the task composer.</small>
          </header>
          <ul>
            <li v-for="item in selectedRuntime.productCapabilities" :key="item.id">
              <osx-icon :name="item.state === 'available' ? 'check' : item.state === 'limited' ? 'info' : 'minus'" :size="14" />
              <span><strong>{{ item.label }}</strong><small>{{ item.detail }}</small></span>
              <osx-badge size="small" :label="item.state === 'available' ? 'Ready' : item.state === 'limited' ? 'Limited' : 'Unavailable'" :tone="item.state === 'available' ? 'success' : item.state === 'limited' ? 'warning' : 'neutral'" />
            </li>
          </ul>
        </section>

        <div class="harness-models">
          <div class="harness-model-toolbar">
            <div>
              <strong>Models</strong>
              <small>Live catalog · {{ selectedProvider.models.length }} found</small>
            </div>
            <osx-text-field
              v-if="showModelSearch"
              label="Search models"
              type="search"
              icon="search"
              placeholder="Search"
              :value="modelQuery"
              @input="updateModelQuery"
            />
          </div>
          <div v-if="visibleModels.length" class="harness-model-list" role="list" aria-label="Available models">
            <button
              v-for="model in visibleModels"
              :key="model.id"
              type="button"
              role="listitem"
              :class="{ selected: selectedModelId === model.id || (!selectedModelId && model.id === selectedProvider.model) }"
              @click="useModel(model.id)"
            >
              <span>
                <strong>{{ model.name }}</strong>
                <small>{{ model.description ?? model.id }}</small>
              </span>
              <osx-icon v-if="selectedModelId === model.id || (!selectedModelId && model.id === selectedProvider.model)" name="check" :size="15" label="Selected" />
            </button>
          </div>
          <div v-else class="harness-model-empty">
            <osx-icon name="search" :size="18" />
            <span><strong>No matching models</strong><small>Try another search or refresh the catalog.</small></span>
          </div>
          <footer class="harness-model-footer">
            <span>Default: {{ selectedModelId || selectedProvider.model }}</span>
            <osx-button v-if="selectedModelId" size="small" :disabled="saving" @click="useProviderDefault">Use provider default</osx-button>
          </footer>
        </div>

        <section class="runtime-conformance" aria-label="Provider connection test">
          <header>
            <div>
              <strong>Connection test</strong>
              <small>{{ selectedRuntime?.conformance?.detail ?? 'Run one bounded live request to verify credentials and model access.' }}</small>
            </div>
            <span>
              <osx-badge size="small" :tone="conformanceTone(selectedRuntime)" :label="conformanceLabel(selectedRuntime)" />
              <osx-button
                size="small"
                icon="check"
                :loading="probingRuntimeId === selectedProvider.id"
                :disabled="saving || Boolean(probingRuntimeId) || !isEnabled(selectedProvider.id)"
                @click="selectedRuntime && emit('probe', selectedRuntime)"
              >
                Test connection
              </osx-button>
            </span>
          </header>
          <p>A connection test refreshes the model catalog and sends one bounded structured output request. It may use provider quota.</p>
          <ul v-if="selectedRuntime?.conformance?.checks.length">
            <li v-for="check in selectedRuntime.conformance.checks" :key="check.id">
              <osx-icon :name="check.state === 'passed' ? 'check' : check.state === 'failed' ? 'warning' : 'minus'" :size="14" />
              <span><strong>{{ check.label }}</strong><small>{{ check.detail }}</small></span>
            </li>
          </ul>
        </section>
        </div>

        <footer class="provider-detail-footer">
          <span>{{ settings.defaultRuntimeId === selectedProvider.id ? 'Default for new tasks' : 'Available in the task composer' }}</span>
          <div class="provider-detail-actions">
            <osx-button size="small" :loading="activeActionId === selectedProvider.id" :disabled="saving" @click="refreshProvider(selectedProvider)">Refresh models</osx-button>
            <div v-if="confirmingRemovalId === selectedProvider.id" class="provider-remove-confirm" role="group" :aria-label="`Remove ${selectedProvider.name}`">
              <span>Remove this connection?</span>
              <div>
                <osx-button size="small" :disabled="activeActionId === selectedProvider.id" @click="confirmingRemovalId = ''">Cancel</osx-button>
                <osx-button variant="danger" size="small" :loading="activeActionId === selectedProvider.id" @click="removeProvider(selectedProvider)">Remove</osx-button>
              </div>
            </div>
            <template v-else>
              <osx-button v-if="settings.defaultRuntimeId !== selectedProvider.id" size="small" :disabled="saving || !isEnabled(selectedProvider.id)" @click="setAsDefault">Set as default</osx-button>
              <osx-button size="small" :disabled="Boolean(activeActionId)" @click="confirmingRemovalId = selectedProvider.id">Remove</osx-button>
            </template>
          </div>
        </footer>
      </section>
    </div>

    <div v-else-if="!showingForm" class="provider-empty">
      <span><osx-icon name="cloud" :size="18" /></span>
      <div>
        <strong>No model providers connected</strong>
        <p>Add OpenAI, Anthropic, Google, DeepSeek, GLM, or another compatible provider. OpenRouter is optional.</p>
      </div>
    </div>
  </section>
</template>
