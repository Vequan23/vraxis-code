<script setup lang="ts">
import { computed } from "vue";
import type { OsxIconName } from "@vraxis/osx-components";
import type { RuntimeSummary } from "@vraxis/code-contracts";
import { harnessLogoUrl } from "../settings/harness-logos.js";
import { runtimePickerSubtitle } from "../settings/runtime-conformance.js";
import ComposerMenuPicker, { type ComposerMenuGroup } from "./ComposerMenuPicker.vue";

const props = defineProps<{
  runtimes: RuntimeSummary[];
  value: string;
  disabled?: boolean;
  isEnabled: (runtimeId: string) => boolean;
}>();

const emit = defineEmits<{
  change: [runtimeId: string];
}>();

function runtimeDisabled(runtime: RuntimeSummary): boolean {
  return runtime.availability !== "installed" || !props.isEnabled(runtime.id);
}

function runtimeSubtitle(runtime: RuntimeSummary): string {
  return runtimePickerSubtitle(runtime, props.isEnabled(runtime.id));
}

function mapRuntime(runtime: RuntimeSummary) {
  const logo = harnessLogoUrl(runtime.id);
  return {
    id: runtime.id,
    label: runtime.name,
    description: runtimeSubtitle(runtime),
    disabled: runtimeDisabled(runtime),
    icon: (runtime.kind === "hosted-provider" ? "cloud" : "terminal") as OsxIconName,
    ...(logo ? { logoUrl: logo, logoBrand: true } : {}),
  };
}

const groups = computed<ComposerMenuGroup[]>(() => {
  const harnessRuntimes = props.runtimes.filter((item) => item.kind !== "hosted-provider");
  const hostedRuntimes = props.runtimes.filter((item) => item.kind === "hosted-provider");
  return [
    ...(harnessRuntimes.length ? [{ heading: "Agent harnesses", options: harnessRuntimes.map(mapRuntime) }] : []),
    ...(hostedRuntimes.length ? [{ heading: "Cloud providers", options: hostedRuntimes.map(mapRuntime) }] : []),
  ];
});

const selected = computed(() => props.runtimes.find((item) => item.id === props.value));
const triggerLogoUrl = computed(() => (selected.value ? harnessLogoUrl(selected.value.id) : undefined));
</script>

<template>
  <ComposerMenuPicker
    label="Runtime"
    :value="value"
    :groups="groups"
    :disabled="disabled"
    :trigger-icon="(selected?.kind === 'hosted-provider' ? 'cloud' : 'terminal') as OsxIconName"
    :trigger-logo-url="triggerLogoUrl"
    :trigger-logo-brand="Boolean(triggerLogoUrl)"
    @change="emit('change', $event)"
  />
</template>
