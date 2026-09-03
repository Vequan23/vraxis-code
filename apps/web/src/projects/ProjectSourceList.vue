<script setup lang="ts">
import type { ProjectSummary } from "@vraxis/code-contracts";
import ProjectActivityIndicator from "./ProjectActivityIndicator.vue";

defineProps<{
  projects: ProjectSummary[];
  selectedProjectId?: string;
  runningProjectIds: ReadonlySet<string>;
}>();

const emit = defineEmits<{
  select: [project: ProjectSummary];
}>();
</script>

<template>
  <ul class="project-source-list" role="listbox" aria-label="Projects">
    <li v-for="item in projects" :key="item.id">
      <button
        type="button"
        role="option"
        class="project-source-item"
        :class="{ selected: item.id === selectedProjectId }"
        :aria-selected="item.id === selectedProjectId"
        :aria-label="runningProjectIds.has(item.id) ? `${item.name}, task running` : item.name"
        @click="emit('select', item)"
      >
        <ProjectActivityIndicator v-if="runningProjectIds.has(item.id)" />
        <osx-icon v-else name="folder" :size="14" />
        <span>{{ item.name }}</span>
      </button>
    </li>
  </ul>
</template>
