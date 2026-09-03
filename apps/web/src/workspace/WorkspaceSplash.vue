<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";

const BRAND_MARK = "/brand/vraxis-code-mark.svg";

const slow = ref(false);
let slowTimer: ReturnType<typeof setTimeout> | undefined;

onMounted(() => {
  slowTimer = setTimeout(() => {
    slow.value = true;
  }, 2_000);
});

onBeforeUnmount(() => {
  if (slowTimer) clearTimeout(slowTimer);
});
</script>

<template>
  <div class="workspace-splash" role="status" aria-label="Loading workspace" aria-live="polite">
    <span class="workspace-splash__mark" aria-hidden="true">
      <img class="workspace-splash__logo" :src="BRAND_MARK" alt="" width="54" height="54" decoding="async">
    </span>
    <p v-if="slow" class="workspace-splash__hint">Starting local service…</p>
  </div>
</template>

<style scoped>
.workspace-splash {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
}

.workspace-splash__mark {
  width: 54px;
  height: 54px;
  display: grid;
  place-items: center;
  border: 1px solid var(--osx-border, #465159);
  border-radius: 14px;
  background: var(--osx-surface-raised, #22282c);
  box-shadow: 0 18px 48px rgb(0 0 0 / 22%);
  animation: workspace-splash-breathe 2.4s ease-in-out infinite;
}

.workspace-splash__logo {
  width: 40px;
  height: 40px;
  display: block;
}

.workspace-splash__hint {
  margin: 0;
  color: var(--osx-muted, #929a9f);
  font-size: 12px;
  letter-spacing: 0.01em;
}

@keyframes workspace-splash-breathe {
  0%, 100% {
    opacity: 0.92;
    transform: scale(1);
  }
  50% {
    opacity: 1;
    transform: scale(1.03);
  }
}

@media (prefers-reduced-motion: reduce) {
  .workspace-splash__mark {
    animation: none;
  }
}
</style>
