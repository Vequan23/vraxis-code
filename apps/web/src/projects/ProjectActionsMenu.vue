<script setup lang="ts">
import type { OsxIconName } from "@vraxis/osx-components";
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";

export interface ProjectActionOption {
  id: string;
  label: string;
  description: string;
  icon: OsxIconName;
  disabled?: boolean;
}

const props = defineProps<{
  label: string;
  options: ProjectActionOption[];
  disabled?: boolean;
  triggerIcon?: OsxIconName;
}>();

const emit = defineEmits<{
  select: [id: string];
}>();

const open = ref(false);
const root = ref<HTMLElement | null>(null);
const menu = ref<HTMLElement | null>(null);
const menuStyle = ref<Record<string, string>>({});

function toggleMenu(): void {
  if (props.disabled) return;
  if (open.value) {
    open.value = false;
    return;
  }
  open.value = true;
}

function choose(option: ProjectActionOption): void {
  if (option.disabled) return;
  emit("select", option.id);
  open.value = false;
}

function updateMenuPosition(): void {
  const trigger = root.value?.querySelector(".project-actions-menu-trigger");
  if (!(trigger instanceof HTMLElement)) return;

  const rect = trigger.getBoundingClientRect();
  const menuWidth = Math.min(320, window.innerWidth - 16);
  const menuHeight = menu.value?.offsetHeight ?? 160;
  const gap = 8;

  let left = rect.right - menuWidth;
  left = Math.max(8, Math.min(left, window.innerWidth - menuWidth - 8));

  let top = rect.bottom + gap;
  if (top + menuHeight > window.innerHeight - 8) top = Math.max(8, rect.top - gap - menuHeight);

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
  <div ref="root" class="project-actions-menu">
    <osx-icon-button
      class="project-actions-menu-trigger"
      :label="label"
      :icon="triggerIcon ?? 'folder'"
      size="small"
      :disabled="disabled"
      aria-haspopup="menu"
      :aria-expanded="open"
      @click="toggleMenu"
    />

    <Teleport to="body">
      <div
        v-if="open"
        ref="menu"
        class="composer-menu-picker-menu project-actions-menu-panel"
        :style="menuStyle"
        role="menu"
        :aria-label="label"
      >
        <section class="composer-menu-picker-group" aria-label="Project">
          <header>Project</header>
          <button
            v-for="option in options"
            :key="option.id"
            type="button"
            role="menuitem"
            :class="{ disabled: option.disabled }"
            :disabled="option.disabled"
            @click="choose(option)"
          >
            <span class="composer-menu-picker-mark">
              <osx-icon :name="option.icon" :size="14" />
            </span>
            <span class="composer-menu-picker-option-copy">
              <strong>{{ option.label }}</strong>
              <small>{{ option.description }}</small>
            </span>
          </button>
        </section>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.project-actions-menu {
  position: relative;
  display: inline-flex;
  align-items: center;
}
</style>
