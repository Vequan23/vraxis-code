<script setup lang="ts">
import { ref } from "vue";
import type { SupportBundleV1 } from "@vraxis/code-contracts";

const exporting = ref(false);
const copying = ref(false);
const error = ref("");
const notice = ref("");

async function loadBundle(): Promise<{ response: Response; bundle: SupportBundleV1 }> {
  const response = await fetch("/api/support-bundle");
  if (!response.ok) {
    const result = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(result.error ?? "Support diagnostics could not be generated.");
  }
  return { response, bundle: await response.clone().json() as SupportBundleV1 };
}

function safeSummary(bundle: SupportBundleV1): string {
  const interrupted = bundle.recovery.approvalsInterrupted
    + bundle.recovery.terminalRunsInterrupted
    + bundle.recovery.verificationsInterrupted;
  return [
    `Vraxis Code ${bundle.application.version} support summary`,
    `Generated: ${bundle.generatedAt}`,
    `Environment: ${bundle.environment.platform} ${bundle.environment.architecture}; Node ${bundle.environment.node}; ${bundle.environment.desktop ? "desktop" : "browser development"}`,
    `Unexpected previous exit: ${bundle.recovery.previousUnexpectedExit ? "yes" : "no"}`,
    `Interrupted records: ${interrupted}; worktrees needing review: ${bundle.recovery.worktreesNeedingReview}`,
    `Runtimes: ${bundle.inventory.runtimes.map((runtime) => `${runtime.name} (${runtime.availability}${runtime.version ? `, ${runtime.version}` : ""})`).join(", ") || "none"}`,
    "Privacy: no project content, paths, prompts, commands, output, browser content, or credentials included.",
  ].join("\n");
}

async function exportBundle(): Promise<void> {
  if (exporting.value) return;
  exporting.value = true;
  error.value = "";
  notice.value = "";
  try {
    const { response } = await loadBundle();
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    const disposition = response.headers.get("content-disposition") ?? "";
    link.download = /filename="([^"]+)"/.exec(disposition)?.[1] ?? "vraxis-code-support.json";
    link.click();
    URL.revokeObjectURL(url);
    notice.value = "Private support bundle exported. Review it before sharing.";
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "Support diagnostics could not be generated.";
  } finally {
    exporting.value = false;
  }
}

async function copySafeSummary(): Promise<void> {
  if (copying.value) return;
  copying.value = true;
  error.value = "";
  notice.value = "";
  try {
    const { bundle } = await loadBundle();
    await navigator.clipboard.writeText(safeSummary(bundle));
    notice.value = "Safe incident summary copied. It contains no project or task content.";
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "The safe incident summary could not be copied.";
  } finally {
    copying.value = false;
  }
}

function openBugReport(): void {
  window.open("https://github.com/Vequan23/vraxis-code/issues/new?template=bug.yml", "_blank", "noopener,noreferrer");
}
</script>

<template>
  <section class="settings-section support-diagnostics" aria-labelledby="support-diagnostics-heading">
    <header>
      <span class="section-icon"><osx-icon name="life-buoy" :size="19" /></span>
      <div>
        <h2 id="support-diagnostics-heading">Recovery & diagnostics</h2>
        <p>Export enough system state to diagnose startup and recovery problems without exporting your work.</p>
      </div>
    </header>

    <osx-alert v-if="error" tone="error" title="Diagnostics unavailable" :description="error" />
    <osx-alert v-if="notice" tone="success" title="Support bundle ready" :description="notice" />

    <div class="support-summary">
      <div>
        <strong>Included</strong>
        <span>App and contract versions, platform, harness readiness, unexpected-exit detection, and interrupted-state counts.</span>
      </div>
      <div>
        <strong>Excluded</strong>
        <span>Project names and paths, prompts, source, diffs, command text and output, browser content, and credentials.</span>
      </div>
    </div>

    <footer>
      <span><osx-icon name="lock" :size="14" /> Generated locally. Nothing is uploaded.</span>
      <div class="support-actions">
        <osx-button size="small" icon="copy" :loading="copying" :disabled="exporting" @click="copySafeSummary">Copy safe summary</osx-button>
        <osx-button size="small" icon="download" :loading="exporting" :disabled="copying" @click="exportBundle">Export support bundle</osx-button>
        <osx-button size="small" icon="external-link" @click="openBugReport">Open bug report</osx-button>
      </div>
    </footer>
  </section>
</template>

<style scoped>
.support-diagnostics { display: grid; gap: 14px; }
.support-summary { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1px; overflow: hidden; border: 1px solid var(--osx-border-soft); border-radius: 10px; background: var(--osx-border-soft); }
.support-summary > div { display: grid; gap: 4px; padding: 13px 14px; background: var(--osx-surface-sunken); }
.support-summary strong { font-size: 13px; font-weight: 620; }
.support-summary span, footer { color: var(--osx-muted); font-size: 12px; line-height: 1.45; }
footer { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
footer > span { display: inline-flex; align-items: center; gap: 6px; }
.support-actions { display: flex; align-items: center; justify-content: flex-end; gap: 7px; }
@media (max-width: 680px) {
  .support-summary { grid-template-columns: 1fr; }
  footer { align-items: stretch; flex-direction: column; }
  .support-actions { align-items: stretch; flex-direction: column; }
}
</style>
