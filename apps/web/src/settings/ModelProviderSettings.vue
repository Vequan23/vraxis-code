<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import {
  type ModelProviderId,
  type ModelProviderSummary,
} from "@vraxis/code-contracts";

const props = defineProps<{
  providers: ModelProviderSummary[];
}>();

const emit = defineEmits<{
  connected: [providerId: string];
  changed: [];
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
const form = reactive({
  provider: "" as ModelProviderId | "",
  name: "",
  apiKey: "",
  baseURL: "",
  model: "",
});

const isCustomProvider = computed(() => form.provider === "openai-compatible");
const selectedProviderName = computed(() => providerOptions.find((item) => item.value === form.provider)?.label ?? "provider");

function eventValue(event: Event): string {
  return String((event as CustomEvent<[unknown]>).detail?.[0] ?? "");
}

function chooseProvider(event: Event): void {
  form.provider = eventValue(event) as ModelProviderId | "";
  error.value = "";
}

function updateField(field: "name" | "apiKey" | "baseURL" | "model", event: Event): void {
  form[field] = eventValue(event);
  error.value = "";
}

function resetForm(): void {
  form.provider = "";
  form.name = "";
  form.apiKey = "";
  form.baseURL = "";
  form.model = "";
  error.value = "";
  showingForm.value = false;
}

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
  <section class="settings-section provider-settings" aria-labelledby="provider-settings">
    <header class="provider-settings-header">
      <div class="provider-heading">
        <span class="section-icon"><osx-icon name="sparkle" :size="19" /></span>
        <div>
          <h2 id="provider-settings">Model providers</h2>
          <p>Connect a provider directly, then use its models in any agent task.</p>
        </div>
      </div>
      <osx-button v-if="!showingForm" size="small" icon="plus" @click="showingForm = true">Add provider</osx-button>
    </header>

    <osx-alert
      v-if="error"
      tone="error"
      title="Provider not updated"
      :description="error"
    />

    <form v-if="showingForm" class="provider-form" aria-label="Connect model provider" @submit.prevent="connectProvider">
      <div class="provider-form-intro">
        <strong>Connect a model provider</strong>
        <span>Vraxis verifies the connection and discovers available models before saving it.</span>
      </div>
      <div class="provider-form-grid">
        <osx-select
          label="Provider"
          name="provider"
          required
          :options="providerOptions"
          :value="form.provider"
          :disabled="submitting"
          @change="chooseProvider"
        />
        <osx-text-field
          label="Connection name"
          name="connection-name"
          placeholder="Optional"
          :value="form.name"
          :disabled="submitting"
          @input="updateField('name', $event)"
        />
        <osx-text-field
          label="API key"
          name="api-key"
          type="password"
          autocomplete="off"
          :required="!isCustomProvider"
          :placeholder="form.provider ? `${selectedProviderName} API key` : 'Paste your provider API key'"
          :value="form.apiKey"
          :disabled="submitting"
          hint="Stored in the system credential store, never in project files."
          @input="updateField('apiKey', $event)"
        />
        <osx-text-field
          v-if="isCustomProvider"
          label="Endpoint URL"
          name="base-url"
          type="url"
          required
          placeholder="http://localhost:11434/v1"
          :value="form.baseURL"
          :disabled="submitting"
          @input="updateField('baseURL', $event)"
        />
        <osx-text-field
          label="Preferred model ID"
          name="model-id"
          placeholder="Use the provider default"
          :value="form.model"
          :disabled="submitting"
          hint="Optional. You can choose another discovered model later."
          @input="updateField('model', $event)"
        />
      </div>
      <footer class="provider-form-actions">
        <osx-button size="small" :disabled="submitting" @click="resetForm">Cancel</osx-button>
        <osx-button variant="primary" size="small" type="submit" :loading="submitting" :disabled="!form.provider">
          Verify and connect
        </osx-button>
      </footer>
    </form>

    <div v-if="props.providers.length" class="provider-list" aria-label="Connected model providers">
      <article v-for="provider in props.providers" :key="provider.id" class="provider-card">
        <span class="provider-card-icon"><osx-icon name="sparkle" :size="17" /></span>
        <div class="provider-card-body">
          <header>
            <div>
              <strong>{{ provider.name }}</strong>
              <span>{{ provider.models.length }} {{ provider.models.length === 1 ? 'model' : 'models' }}</span>
            </div>
            <osx-badge tone="success" size="small" label="Connected" />
          </header>
          <p>Default: {{ provider.model }}<template v-if="provider.baseURL"> · {{ provider.baseURL }}</template></p>
          <div v-if="confirmingRemovalId === provider.id" class="provider-remove-confirm" role="group" :aria-label="`Remove ${provider.name}`">
            <span>Remove this connection and its saved credential?</span>
            <div>
              <osx-button size="small" :disabled="activeActionId === provider.id" @click="confirmingRemovalId = ''">Cancel</osx-button>
              <osx-button variant="danger" size="small" :loading="activeActionId === provider.id" @click="removeProvider(provider)">Remove connection</osx-button>
            </div>
          </div>
          <footer v-else>
            <osx-button size="small" :loading="activeActionId === provider.id" @click="refreshProvider(provider)">Refresh models</osx-button>
            <osx-button size="small" :disabled="Boolean(activeActionId)" @click="confirmingRemovalId = provider.id">Remove</osx-button>
          </footer>
        </div>
      </article>
    </div>
    <div v-else-if="!showingForm" class="provider-empty">
      <span><osx-icon name="lock" :size="18" /></span>
      <div>
        <strong>No model providers connected</strong>
        <p>Add OpenAI, Anthropic, Google, DeepSeek, GLM, or another compatible provider. OpenRouter is optional.</p>
      </div>
    </div>
  </section>
</template>
