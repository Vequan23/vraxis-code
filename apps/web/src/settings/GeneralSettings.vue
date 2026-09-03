<script setup lang="ts">
import type { AppTheme } from "@vraxis/code-contracts";

defineProps<{
  theme: AppTheme;
  saving: boolean;
  themeOptions: Array<{ value: AppTheme; label: string; description: string }>;
}>();

const emit = defineEmits<{
  change: [theme: AppTheme];
}>();

function eventValue(event: Event): unknown {
  return (event as CustomEvent<[unknown]>).detail?.[0];
}

function chooseTheme(event: Event): void {
  emit("change", String(eventValue(event)) as AppTheme);
}
</script>

<template>
  <section class="settings-section" aria-labelledby="appearance-settings">
    <header>
      <span class="section-icon"><osx-icon name="palette" :size="19" /></span>
      <div>
        <h2 id="appearance-settings">Appearance</h2>
        <p>Use one theme across the workspace.</p>
      </div>
    </header>
    <osx-radio-group
      label="Theme"
      name="application-theme"
      variant="cards"
      orientation="horizontal"
      :options="themeOptions"
      :value="theme"
      :disabled="saving"
      @change="chooseTheme"
    />
  </section>

  <osx-alert
    tone="info"
    title="Settings stay on this device"
    description="The local Vraxis Code service saves these defaults. They are not added to agent transcripts."
  />
</template>
