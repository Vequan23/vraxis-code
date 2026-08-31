<script setup lang="ts">
import { computed, ref } from "vue";
import { modeAgentProfile, type SessionMode } from "@vraxis/code-contracts";

const selectedMode = ref<SessionMode>("ask");
const profile = computed(() => modeAgentProfile(selectedMode.value));

function eventValue(event: Event): string {
  return String((event as CustomEvent<[unknown]>).detail?.[0] ?? "");
}

function chooseMode(event: Event): void {
  const value = eventValue(event).toLowerCase();
  if (value === "ask" || value === "plan" || value === "build" || value === "review") selectedMode.value = value;
}

function toolLabel(toolId: string): string {
  return toolId.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}
</script>

<template>
  <section class="settings-section agent-defaults" aria-labelledby="agent-defaults-heading">
    <header>
      <span class="section-icon"><osx-icon name="sparkle" :size="19" /></span>
      <div>
        <h2 id="agent-defaults-heading">Agent defaults</h2>
        <p>Vraxis requests a useful, bounded toolset for each mode. Add <code>$skills</code> only when the task needs extra guidance.</p>
      </div>
    </header>

    <osx-segmented-control
      items="Ask,Plan,Build,Review"
      :value="selectedMode.charAt(0).toUpperCase() + selectedMode.slice(1)"
      label="Agent mode defaults"
      @change="chooseMode"
    />

    <article class="agent-profile" aria-live="polite">
      <header>
        <div>
          <strong>{{ profile.title }}</strong>
          <span>{{ profile.description }}</span>
        </div>
        <osx-badge
          :tone="profile.access === 'isolated-worktree' ? 'info' : 'neutral'"
          size="small"
          :label="profile.access === 'isolated-worktree' ? 'Isolated worktree' : 'Read only'"
        />
      </header>

      <div class="agent-profile-groups">
        <section aria-labelledby="default-skills-label">
          <h3 id="default-skills-label">Operating skills</h3>
          <ul class="capability-list">
            <li v-for="skill in profile.skillNames" :key="skill">
              <osx-icon name="check" :size="13" />{{ skill }}
            </li>
          </ul>
        </section>

        <section aria-labelledby="default-tools-label">
          <h3 id="default-tools-label">Default tools</h3>
          <ul class="tool-list">
            <li v-for="tool in profile.toolIds" :key="tool">{{ toolLabel(tool) }}</li>
          </ul>
        </section>

        <section v-if="profile.guardedToolIds.length" aria-labelledby="guarded-tools-label">
          <h3 id="guarded-tools-label">Ask before use</h3>
          <ul class="tool-list guarded">
            <li v-for="tool in profile.guardedToolIds" :key="tool"><osx-icon name="lock" :size="12" />{{ toolLabel(tool) }}</li>
          </ul>
        </section>
      </div>

      <footer>
        <osx-icon name="lock" :size="14" />
        <span>{{ profile.guardedToolIds.length ? 'A tool appears only when the selected harness supports it and Vraxis grants the capability.' : 'The harness may expose a smaller toolset. An attached skill cannot grant write access.' }}</span>
      </footer>
    </article>
  </section>
</template>
