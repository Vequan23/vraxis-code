<script setup lang="ts">
import type { OsxIconName } from "@vraxis/osx-components";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";

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
  align?: "start" | "end";
}>();

const emit = defineEmits<{
  change: [id: string];
}>();

const open = ref(false);
const root = ref<HTMLElement | null>(null);
const menu = ref<HTMLElement | null>(null);
const menuStyle = ref<Record<string, string>>({});

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

function updateMenuPosition(): void {
  const trigger = root.value?.querySelector(".composer-menu-picker-trigger");
  if (!(trigger instanceof HTMLElement)) return;

  const rect = trigger.getBoundingClientRect();
  const menuWidth = Math.min(320, window.innerWidth - 16);
  const menuHeight = menu.value?.offsetHeight ?? Math.min(360, window.innerHeight * 0.48);
  const gap = 8;
  const alignEnd = props.align === "end";

  let left = alignEnd ? rect.right - menuWidth : rect.left;
  left = Math.max(8, Math.min(left, window.innerWidth - menuWidth - 8));

  let top = rect.top - gap - menuHeight;
  if (top < 8) top = rect.bottom + gap;

  menuStyle.value = {
    top: `${Math.round(top)}px`,
    left: `${Math.round(left)}px`,
    width: `${Math.round(menuWidth)}px`,
  };
}

async function syncMenuPosition(): Promise<void> {
  if (!open.value) return;
  await nextTick();
  updateMenuPosition();
  await nextTick();
  updateMenuPosition();
}

function onDocumentPointerDown(event: PointerEvent): void {
  const target = event.target as Node;
  if (!open.value) return;
  if (root.value?.contains(target) || menu.value?.contains(target)) return;
  open.value = false;
}

function onDocumentKeyDown(event: KeyboardEvent): void {
  if (event.key === "Escape") open.value = false;
}

watch(open, (isOpen) => {
  if (isOpen) void syncMenuPosition();
});

onMounted(() => {
  document.addEventListener("pointerdown", onDocumentPointerDown);
  document.addEventListener("keydown", onDocumentKeyDown);
  window.addEventListener("resize", syncMenuPosition);
  window.addEventListener("scroll", syncMenuPosition, true);
});

onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", onDocumentPointerDown);
  document.removeEventListener("keydown", onDocumentKeyDown);
  window.removeEventListener("resize", syncMenuPosition);
  window.removeEventListener("scroll", syncMenuPosition, true);
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

    <Teleport to="body">
      <div
        v-if="open"
        ref="menu"
        class="composer-menu-picker-menu"
        :style="menuStyle"
        role="listbox"
        :aria-label="`Choose ${label.toLowerCase()}`"
      >
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
    </Teleport>
  </div>
</template>
