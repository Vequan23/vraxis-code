<template>
  <span class="project-activity-indicator" aria-hidden="true">
    <i /><i /><i /><i />
  </span>
</template>

<style scoped>
.project-activity-indicator {
  width: 14px;
  height: 14px;
  flex: 0 0 auto;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  grid-template-rows: repeat(3, 1fr);
  gap: 1px;
  color: var(--osx-text, #eef1f2);
}

.project-activity-indicator i {
  width: 3px;
  height: 3px;
  align-self: center;
  justify-self: center;
  border-radius: 50%;
  background: currentColor;
  opacity: 0.28;
  animation: project-activity-pulse 1.05s ease-in-out infinite;
}

.project-activity-indicator i:nth-child(1) { grid-column: 1; grid-row: 1; animation-delay: 0ms; }
.project-activity-indicator i:nth-child(2) { grid-column: 1; grid-row: 2; animation-delay: 140ms; }
.project-activity-indicator i:nth-child(3) { grid-column: 2; grid-row: 1; animation-delay: 280ms; }
.project-activity-indicator i:nth-child(4) { grid-column: 3; grid-row: 2; animation-delay: 420ms; }

@keyframes project-activity-pulse {
  0%, 70%, 100% { opacity: 0.24; transform: scale(0.88); }
  35% { opacity: 1; transform: scale(1); }
}

@media (prefers-reduced-motion: reduce) {
  .project-activity-indicator i {
    animation: none;
    opacity: 0.82;
  }
}
</style>
