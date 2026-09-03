<script setup lang="ts">
import type { OsxIconName } from "@vraxis/osx-components";
import { computed, onBeforeUnmount, onMounted, ref } from "vue";

export interface ComposerMenuOption {
  id: string;
  label: string;
  description?: string;
  disabled?: boolean;
  icon?: OsxIconName;
  logoUrl?: string;
  logoBrand?: boolean;
}

export interface ComposerMenuGroup {
  heading: string;
  options: ComposerMenuOption[];
}

const props = defineProps<{
  label: string;
  value: string;
  groups: ComposerMenuGroup[];
  disabled?: boolean;
  triggerIcon?: OsxIconName;
  triggerLogoUrl?: string;
  triggerLogoBrand?: boolean;
}>();

const emit = defineEmits<{
  change: [id: string];
}>();

const open = ref(false);
const root = ref<HTMLElement | null>(null);

const options = computed(() => props.groups.flatMap((group) => group.options));
const selected = computed(() => options.value.find((item) => item.id === props.value) ?? options.value.find((item) => !item.disabled));
const triggerLabel = computed(() => selected.value?.label ?? `Choose ${props.label.toLowerCase()}`);

function toggleMenu(): void {
  if (props.disabled) return;
  open.value = !open.value;
}

function choose(option: ComposerMenuOption): void {
  if (option.disabled) return;
  emit("change", option.id);
  open.value = false;
}

function onDocumentPointerDown(event: PointerEvent): void {
  if (!open.value || root.value?.contains(event.target as Node)) return;
  open.value = false;
}

function onDocumentKeyDown(event: KeyboardEvent): void {
  if (event.key === "Escape") open.value = false;
}

onMounted(() => {
  document.addEventListener("pointerdown", onDocumentPointerDown);
  document.addEventListener("keydown", onDocumentKeyDown);
});

onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", onDocumentPointerDown);
  document.removeEventListener("keydown", onDocumentKeyDown);
});
</script>

<template>
  <div ref="root" class="composer-menu-picker">
    <button
      type="button"
      class="composer-menu-picker-trigger"
      :aria-label="label"
      aria-haspopup="listbox"
      :aria-expanded="open"
      :disabled="disabled"
      @click="toggleMenu"
    >
      <span :class="['composer-menu-picker-mark', { 'has-brand-logo': triggerLogoBrand || selected?.logoBrand }]">
        <img v-if="triggerLogoUrl || selected?.logoUrl" :src="triggerLogoUrl ?? selected?.logoUrl" alt="" :aria-hidden="true" />
        <osx-icon v-else :name="triggerIcon ?? selected?.icon ?? 'circle'" :size="14" />
      </span>
      <span class="composer-menu-picker-name">{{ triggerLabel }}</span>
      <osx-icon name="chevron-down" :size="12" />
    </button>

    <div v-if="open" class="composer-menu-picker-menu" role="listbox" :aria-label="`Choose ${label.toLowerCase()}`">
      <section
        v-for="group in groups"
        :key="group.heading"
        class="composer-menu-picker-group"
        :aria-label="group.heading"
      >
        <header>{{ group.heading }}</header>
        <button
          v-for="option in group.options"
          :key="option.id"
          type="button"
          role="option"
          :class="{ selected: option.id === value, disabled: option.disabled }"
          :aria-selected="option.id === value"
          :disabled="option.disabled"
          @click="choose(option)"
        >
          <span :class="['composer-menu-picker-mark', { 'has-brand-logo': option.logoBrand }]">
            <img v-if="option.logoUrl" :src="option.logoUrl" alt="" :aria-hidden="true" />
            <osx-icon v-else :name="option.icon ?? 'circle'" :size="14" />
          </span>
          <span class="composer-menu-picker-option-copy">
            <strong>{{ option.label }}</strong>
            <small v-if="option.description">{{ option.description }}</small>
          </span>
          <osx-icon v-if="option.id === value" name="check" :size="14" label="Selected" />
        </button>
      </section>
    </div>
  </div>
</template>
