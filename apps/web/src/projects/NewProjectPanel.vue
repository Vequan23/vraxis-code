<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import type { ProjectSummary } from "@vraxis/code-contracts";

const props = defineProps<{
  busy?: boolean;
  promptLocationOnMount?: boolean;
  showClose?: boolean;
}>();

const emit = defineEmits<{
  created: [project: ProjectSummary];
  cancel: [];
}>();

const name = ref("");
const parentPath = ref("");
const error = ref("");
const pickingParent = ref(false);
const submitting = ref(false);

const trimmedName = computed(() => name.value.trim());
const canSubmit = computed(() => Boolean(trimmedName.value && parentPath.value && !pickingParent.value && !submitting.value));
const destinationPath = computed(() => {
  if (!parentPath.value || !trimmedName.value) return "";
  const separator = parentPath.value.endsWith("/") ? "" : "/";
  return `${parentPath.value}${separator}${trimmedName.value}`;
});

function eventValue(event: Event): string {
  return (event.target as HTMLInputElement).value;
}

async function post(path: string, payload: unknown): Promise<unknown> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const result = await response.json() as { error?: string };
  if (!response.ok) throw new Error(result.error ?? "The request failed.");
  return result;
}

async function pickParentFolder(): Promise<void> {
  if (pickingParent.value || submitting.value || props.busy) return;
  error.value = "";
  pickingParent.value = true;
  try {
    if (window.vraxisDesktop?.chooseDirectory) {
      const selected = await window.vraxisDesktop.chooseDirectory();
      if (!selected.cancelled && selected.path) parentPath.value = selected.path;
      return;
    }
    const result = await post("/api/projects/pick-parent-folder", {}) as {
      cancelled: boolean;
      parentPath?: string;
    };
    if (!result.cancelled && result.parentPath) parentPath.value = result.parentPath;
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "The folder chooser could not open.";
  } finally {
    pickingParent.value = false;
  }
}

async function submit(): Promise<void> {
  if (!canSubmit.value) return;
  error.value = "";
  submitting.value = true;
  try {
    const project = await post("/api/projects/create", {
      name: trimmedName.value,
      parentPath: parentPath.value,
    }) as ProjectSummary;
    emit("created", project);
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "The project could not be created.";
  } finally {
    submitting.value = false;
  }
}

onMounted(() => {
  if (props.promptLocationOnMount && !parentPath.value) void pickParentFolder();
});
</script>

<template>
  <section class="new-project-panel" aria-labelledby="new-project-heading">
    <header>
      <span class="new-project-mark"><osx-icon name="folder" :size="18" /></span>
      <span class="new-project-heading-copy">
        <h1 id="new-project-heading">New project</h1>
        <p>Create a git repository and open it as your workspace.</p>
      </span>
      <osx-icon-button
        v-if="showClose"
        label="Close"
        icon="close"
        size="small"
        :disabled="submitting || busy"
        @click="emit('cancel')"
      />
    </header>

    <form class="new-project-form" @submit.prevent="submit">
      <osx-text-field
        label="Name"
        name="project-name"
        placeholder="my-app"
        autocomplete="off"
        spellcheck="false"
        :value="name"
        :disabled="submitting || busy"
        @input="name = eventValue($event)"
      />

      <div class="new-project-location-field">
        <span class="new-project-location-label">Save in</span>
        <button
          type="button"
          class="new-project-location-picker"
          :disabled="submitting || busy || pickingParent"
          :aria-busy="pickingParent"
          @click="pickParentFolder"
        >
          <osx-icon :name="pickingParent ? 'loader' : 'folder-open'" :size="15" />
          <span>{{ parentPath || "Choose a folder…" }}</span>
        </button>
        <p v-if="destinationPath" class="new-project-destination">
          Will create <code>{{ destinationPath }}</code>
        </p>
      </div>

      <p v-if="error" class="new-project-error" role="alert">{{ error }}</p>

      <footer>
        <osx-button type="button" variant="secondary" size="small" :disabled="submitting || busy" @click="emit('cancel')">
          Cancel
        </osx-button>
        <osx-button
          type="submit"
          variant="primary"
          size="small"
          :loading="submitting"
          :disabled="!canSubmit || busy"
        >
          Create
        </osx-button>
      </footer>
    </form>
  </section>
</template>

<style scoped>
.new-project-panel {
  width: min(440px, calc(100vw - 32px));
  margin: 0 auto;
  text-align: left;
  border: 1px solid var(--osx-border-color, #34383e);
  border-radius: 14px;
  background: var(--osx-control-background, #1b1d20);
  box-shadow: 0 20px 56px rgb(0 0 0 / 28%);
  overflow: hidden;
}

header {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 10px;
  align-items: start;
  padding: 16px 16px 12px;
  border-bottom: 1px solid var(--osx-border-color, #34383e);
}

.new-project-mark {
  width: 30px;
  height: 30px;
  display: inline-grid;
  place-items: center;
  border-radius: 8px;
  color: var(--osx-accent-color, #49a8e8);
  background: color-mix(in srgb, var(--osx-accent-color, #49a8e8) 14%, transparent);
}

.new-project-heading-copy { min-width: 0; }

h1 {
  margin: 0;
  font: inherit;
  font-size: 16px;
  font-weight: 650;
  letter-spacing: -.01em;
}

header p {
  margin: 3px 0 0;
  color: var(--osx-secondary-label-color, #9b9ea4);
  font-size: 12px;
  line-height: 1.45;
}

.new-project-form {
  display: grid;
  gap: 14px;
  padding: 16px;
}

.new-project-location-field {
  display: grid;
  gap: 6px;
}

.new-project-location-label {
  color: var(--osx-secondary-label-color, #9b9ea4);
  font-size: 12px;
  font-weight: 600;
}

.new-project-location-picker {
  min-height: 36px;
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid var(--osx-border-color, #34383e);
  border-radius: 8px;
  color: var(--osx-text, #eef1f2);
  background: var(--osx-window-background, #151619);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.new-project-location-picker:not(:disabled):hover {
  border-color: color-mix(in srgb, var(--osx-accent-color, #49a8e8) 45%, var(--osx-border-color, #34383e));
}

.new-project-location-picker:focus-visible {
  outline: 3px solid var(--osx-accent-color, #49a8e8);
  outline-offset: 1px;
}

.new-project-location-picker:disabled {
  cursor: default;
  opacity: 0.72;
}

.new-project-location-picker > span {
  min-width: 0;
  overflow: hidden;
  font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.new-project-location-picker > span:not(:empty) {
  color: var(--osx-text, #eef1f2);
}

.new-project-destination {
  margin: 0;
  color: var(--osx-secondary-label-color, #9b9ea4);
  font-size: 12px;
  line-height: 1.45;
}

.new-project-destination code {
  color: var(--osx-text, #eef1f2);
  font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
  word-break: break-all;
}

.new-project-error {
  margin: 0;
  color: var(--osx-danger, #c95b55);
  font-size: 12px;
  line-height: 1.45;
}

footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 2px;
}
</style>
