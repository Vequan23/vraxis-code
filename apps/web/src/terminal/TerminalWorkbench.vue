<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import type { TerminalRunSummary } from "@vraxis/code-contracts";
import { configureTerminalInput } from "./terminal-input.js";
import { restartInterruptedShellId, terminalTabs } from "./terminal-tabs.js";

const props = defineProps<{
  runs: TerminalRunSummary[];
  initialRunId?: string;
  starting?: boolean;
  error?: string;
}>();

const emit = defineEmits<{
  create: [];
  input: [run: TerminalRunSummary, data: string];
  resize: [run: TerminalRunSummary, columns: number, rows: number];
  interrupt: [run: TerminalRunSummary];
}>();

const host = ref<HTMLElement>();
const selectedRunId = ref("");
const hiddenRunIds = ref<string[]>([]);
let terminal: Terminal | undefined;
let fitAddon: FitAddon | undefined;
let resizeObserver: ResizeObserver | undefined;
let renderedRunId = "";
let renderedOutput = "";
let lastColumns = 0;
let lastRows = 0;
let stream: EventSource | undefined;
let streamRunId = "";
let streamSequence = 0;
let recoveredRestartRunId = "";
const inputBuffers = new Map<string, { run: TerminalRunSummary; data: string; timer: ReturnType<typeof setTimeout> }>();

const visibleRuns = computed(() => terminalTabs(
  props.runs,
  selectedRunId.value,
  props.initialRunId,
  hiddenRunIds.value,
));
const selectedRun = computed(() => visibleRuns.value.find((run) => run.id === selectedRunId.value));

function tabTitle(run: TerminalRunSummary): string {
  if (run.label) return run.label;
  if (run.purpose === "user-shell") return "Shell";
  const executable = run.command.trim().split(/\s+/)[0] ?? "Command";
  const parts = executable.split(/[\\/]/);
  return parts[parts.length - 1] || "Command";
}

function statusLabel(run: TerminalRunSummary): string {
  if (run.status === "pending") return "Waiting for approval";
  if (run.status === "running") return run.purpose === "user-shell" ? "Interactive shell" : "Agent command running";
  if (run.status === "success") return "Exited successfully";
  if (run.status === "interrupted") return "Stopped";
  return `Exited with code ${run.exitCode ?? 1}`;
}

function selectRun(run: TerminalRunSummary): void {
  selectedRunId.value = run.id;
  void nextTick(() => terminal?.focus());
}

function closeRun(run: TerminalRunSummary): void {
  if (run.status === "running") emit("interrupt", run);
  hiddenRunIds.value = [...hiddenRunIds.value, run.id];
  if (selectedRunId.value === run.id) {
    selectedRunId.value = visibleRuns.value.find((item) => item.id !== run.id)?.id ?? "";
  }
}

function fit(): void {
  if (!terminal || !fitAddon || !host.value) return;
  try { fitAddon.fit(); } catch { return; }
  const run = selectedRun.value;
  if (!run || run.status !== "running") return;
  if (terminal.cols === lastColumns && terminal.rows === lastRows) return;
  lastColumns = terminal.cols;
  lastRows = terminal.rows;
  emit("resize", run, terminal.cols, terminal.rows);
}

function renderRun(run: TerminalRunSummary | undefined): void {
  if (!terminal) return;
  if (!run) {
    renderedRunId = "";
    renderedOutput = "";
    terminal.reset();
    return;
  }
  const output = run.output || (run.status === "pending" ? "\u001b[33mWaiting for approval…\u001b[0m\r\n" : "");
  if (renderedRunId !== run.id || (!output.startsWith(renderedOutput) && !renderedOutput.startsWith(output))) {
    terminal.reset();
    if (output) terminal.write(output);
  } else if (output.length > renderedOutput.length) {
    terminal.write(output.slice(renderedOutput.length));
  }
  renderedRunId = run.id;
  if (!renderedOutput.startsWith(output)) renderedOutput = output;
  terminal.options.disableStdin = run.status !== "running";
  if (run.status === "running") terminal.focus();
}

function replaceOutput(runId: string, output: string): void {
  if (!terminal || selectedRunId.value !== runId) return;
  terminal.reset();
  if (output) terminal.write(output);
  renderedRunId = runId;
  renderedOutput = output;
}

function closeStream(): void {
  stream?.close();
  stream = undefined;
  streamRunId = "";
  streamSequence = 0;
}

function connectStream(run: TerminalRunSummary | undefined): void {
  if (!run || run.status !== "running") {
    closeStream();
    return;
  }
  if (streamRunId === run.id) return;
  closeStream();
  streamRunId = run.id;
  const source = new EventSource(`/api/terminal/${encodeURIComponent(run.id)}/stream`);
  stream = source;
  source.addEventListener("snapshot", (message) => {
    const snapshot = JSON.parse((message as MessageEvent<string>).data) as {
      run: TerminalRunSummary;
      sequence: number;
      active: boolean;
    };
    if (stream !== source) return;
    streamSequence = snapshot.sequence;
    replaceOutput(run.id, snapshot.run.output);
    if (!snapshot.active) closeStream();
  });
  source.addEventListener("data", (message) => {
    const event = JSON.parse((message as MessageEvent<string>).data) as { sequence: number; data: string };
    if (stream !== source || event.sequence <= streamSequence) return;
    streamSequence = event.sequence;
    if (selectedRunId.value === run.id && terminal) {
      terminal.write(event.data);
      renderedRunId = run.id;
      renderedOutput += event.data;
    }
  });
  source.addEventListener("exit", (message) => {
    const event = JSON.parse((message as MessageEvent<string>).data) as { run: TerminalRunSummary };
    if (stream !== source) return;
    replaceOutput(run.id, event.run.output);
    if (terminal) terminal.options.disableStdin = true;
    closeStream();
  });
}

function flushInput(runId: string): void {
  const buffered = inputBuffers.get(runId);
  if (!buffered) return;
  inputBuffers.delete(runId);
  for (let offset = 0; offset < buffered.data.length; offset += 4_096) {
    emit("input", buffered.run, buffered.data.slice(offset, offset + 4_096));
  }
}

function bufferInput(run: TerminalRunSummary, data: string): void {
  const pending = inputBuffers.get(run.id);
  if (pending) {
    pending.data += data;
    return;
  }
  inputBuffers.set(run.id, {
    run,
    data,
    timer: setTimeout(() => flushInput(run.id), 8),
  });
}

watch(visibleRuns, (runs) => {
  if (props.initialRunId && runs.some((run) => run.id === props.initialRunId)) {
    selectedRunId.value = props.initialRunId;
    return;
  }
  if (runs.some((run) => run.id === selectedRunId.value)) return;
  selectedRunId.value = runs.find((run) => run.status === "running")?.id ?? runs[0]?.id ?? "";
}, { immediate: true });

watch([() => restartInterruptedShellId(props.runs), () => props.starting], ([runId, starting]) => {
  if (!runId || starting || runId === recoveredRestartRunId) return;
  recoveredRestartRunId = runId;
  emit("create");
}, { immediate: true });

watch(selectedRun, (run) => {
  renderRun(run);
  connectStream(run);
  void nextTick(fit);
}, { immediate: true, deep: true });

onMounted(() => {
  terminal = new Terminal({
    allowProposedApi: false,
    convertEol: true,
    cursorBlink: true,
    cursorStyle: "block",
    disableStdin: selectedRun.value?.status !== "running",
    fontFamily: "SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    fontSize: 12,
    lineHeight: 1.25,
    scrollback: 10_000,
    screenReaderMode: true,
    theme: {
      background: "#0c0d0e",
      foreground: "#d7dadc",
      cursor: "#e5e7e8",
      cursorAccent: "#0c0d0e",
      selectionBackground: "#35576f",
      black: "#161819",
      brightBlack: "#656a6d",
      red: "#e06c75",
      brightRed: "#f07f87",
      green: "#98c379",
      brightGreen: "#a9d488",
      yellow: "#d6b56f",
      brightYellow: "#e5c47d",
      blue: "#61afef",
      brightBlue: "#78bdf5",
      magenta: "#c678dd",
      brightMagenta: "#d68be8",
      cyan: "#56b6c2",
      brightCyan: "#70c8d1",
      white: "#d7dadc",
      brightWhite: "#f4f5f5",
    },
  });
  fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);
  if (host.value) terminal.open(host.value);
  if (terminal.textarea) configureTerminalInput(terminal.textarea);
  terminal.onData((data) => {
    const run = selectedRun.value;
    if (run?.status === "running") bufferInput(run, data);
  });
  resizeObserver = new ResizeObserver(() => fit());
  if (host.value) resizeObserver.observe(host.value);
  renderRun(selectedRun.value);
  requestAnimationFrame(fit);
});

onBeforeUnmount(() => {
  for (const [runId, buffered] of inputBuffers) {
    clearTimeout(buffered.timer);
    flushInput(runId);
  }
  resizeObserver?.disconnect();
  closeStream();
  terminal?.dispose();
});
</script>

<template>
  <section class="terminal-workbench" aria-label="Interactive terminal">
    <header class="terminal-tabs-bar">
      <nav aria-label="Terminal tabs">
        <div
          v-for="run in visibleRuns"
          :key="run.id"
          :class="['terminal-tab', { selected: selectedRunId === run.id }]"
        >
          <button
            type="button"
            class="terminal-tab-select"
            :aria-label="`${tabTitle(run)} terminal`"
            :aria-current="selectedRunId === run.id ? 'page' : undefined"
            @click="selectRun(run)"
          >
            <osx-icon name="terminal" :size="13" />
            <span>{{ tabTitle(run) }}</span>
            <i :data-status="run.status" aria-hidden="true" />
          </button>
          <button type="button" class="terminal-tab-close" :aria-label="`Close ${tabTitle(run)} terminal`" @click="closeRun(run)">
            <osx-icon name="x" :size="12" />
          </button>
        </div>
        <osx-icon-button label="New terminal" icon="plus" size="small" :loading="starting" @click="emit('create')" />
      </nav>
      <span v-if="selectedRun" class="terminal-tab-meta">{{ selectedRun.cwd }}</span>
    </header>

    <div v-if="error || (selectedRun && selectedRun.purpose !== 'user-shell')" class="terminal-context-stack">
      <div v-if="error" class="terminal-workbench-error" role="alert">
        <osx-icon name="warning" :size="14" />
        <span>{{ error }}</span>
      </div>
      <div v-if="selectedRun && selectedRun.purpose !== 'user-shell'" class="terminal-command-context">
        <span>{{ selectedRun.cwd }}</span>
        <b aria-hidden="true">$</b>
        <code>{{ selectedRun.command }}</code>
      </div>
    </div>

    <div v-show="selectedRun" ref="host" class="terminal-emulator" @click="terminal?.focus()" />
    <div v-if="!selectedRun" class="terminal-welcome" role="status">
      <span><osx-icon name="terminal" :size="22" /></span>
      <strong>Open a terminal</strong>
      <small>Start an interactive shell in this task's workspace.</small>
      <osx-button variant="primary" size="small" icon="plus" :loading="starting" @click="emit('create')">New terminal</osx-button>
    </div>

    <footer v-if="selectedRun">
      <span><i :data-status="selectedRun.status" />{{ statusLabel(selectedRun) }}</span>
      <span>{{ selectedRun.columns ?? 100 }} × {{ selectedRun.rows ?? 30 }}</span>
    </footer>
  </section>
</template>

<style scoped>
.terminal-workbench { min-width: 0; min-height: 0; height: 100%; display: grid; grid-template-rows: 38px auto minmax(0, 1fr) 27px; overflow: hidden; color: var(--osx-text); background: #0c0d0e; }
.terminal-tabs-bar { min-width: 0; display: flex; align-items: stretch; justify-content: space-between; border-bottom: 1px solid var(--osx-border-soft); background: var(--osx-surface); }
.terminal-tabs-bar nav { min-width: 0; flex: 1; display: flex; align-items: stretch; overflow-x: auto; }
.terminal-tab { min-width: 112px; max-width: 190px; display: flex; align-items: center; border-right: 1px solid var(--osx-border-soft); color: var(--osx-muted); background: transparent; font: 500 12px var(--osx-font); }
.terminal-tab.selected { color: var(--osx-text); background: #0c0d0e; box-shadow: 0 -2px var(--osx-accent) inset; }
.terminal-tab-select { min-width: 0; flex: 1; align-self: stretch; display: flex; align-items: center; gap: 6px; padding: 0 4px 0 8px; border: 0; color: inherit; background: transparent; font: inherit; cursor: pointer; }
.terminal-tab-select > span { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left; }
.terminal-tab-select > i, .terminal-workbench > footer i { width: 7px; height: 7px; flex: 0 0 auto; border-radius: 50%; background: var(--osx-muted); }
.terminal-tab-select > i[data-status="running"], .terminal-workbench > footer i[data-status="running"] { background: var(--osx-success); }
.terminal-tab-select > i[data-status="pending"] { background: var(--osx-warning); }
.terminal-tab-select > i[data-status="error"], .terminal-workbench > footer i[data-status="error"] { background: var(--osx-danger); }
.terminal-tab-close { width: 24px; height: 24px; flex: 0 0 auto; display: grid; place-items: center; margin-right: 3px; padding: 0; border: 0; border-radius: 4px; color: inherit; background: transparent; opacity: 0; cursor: pointer; }
.terminal-tab:hover .terminal-tab-close, .terminal-tab:focus-within .terminal-tab-close { opacity: .8; }
.terminal-tab-close:hover { background: color-mix(in srgb, var(--osx-text) 8%, transparent); opacity: 1; }
.terminal-tabs-bar osx-icon-button { flex: 0 0 auto; margin: 4px; }
.terminal-tab-meta { max-width: 34%; align-self: center; overflow: hidden; padding: 0 10px; color: var(--osx-muted); font: 12px var(--osx-font-mono); text-overflow: ellipsis; white-space: nowrap; }
.terminal-workbench-error { display: flex; align-items: center; gap: 7px; padding: 6px 10px; border-bottom: 1px solid color-mix(in srgb, var(--osx-danger) 45%, var(--osx-border-soft)); color: var(--osx-danger); background: color-mix(in srgb, var(--osx-danger) 8%, #0c0d0e); font-size: 12px; }
.terminal-command-context { min-width: 0; display: flex; align-items: center; gap: 7px; padding: 6px 10px; border-bottom: 1px solid #242729; color: #899196; background: #111315; font: 12px/1.4 SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
.terminal-command-context span { color: #74b9d5; }
.terminal-command-context b { color: #75be8a; }
.terminal-command-context code { min-width: 0; overflow: hidden; color: #e3e5e6; text-overflow: ellipsis; white-space: nowrap; }
.terminal-emulator { min-width: 0; min-height: 0; padding: 8px 10px; overflow: hidden; }
.terminal-emulator :deep(.xterm) { height: 100%; }
.terminal-emulator :deep(.xterm-viewport) { scrollbar-color: #41474a transparent; scrollbar-width: thin; }
.terminal-welcome { min-height: 0; display: grid; place-content: center; justify-items: center; gap: 7px; padding: 24px; color: var(--osx-muted); text-align: center; }
.terminal-welcome > span { width: 42px; height: 42px; display: grid; place-items: center; border: 1px solid var(--osx-border-soft); border-radius: 10px; }
.terminal-welcome strong { color: var(--osx-text); font-size: 13px; }
.terminal-welcome small { margin-bottom: 4px; font-size: 12px; }
.terminal-workbench > footer { min-width: 0; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 0 9px; border-top: 1px solid #242729; color: #858b8f; background: #111315; font: 12px var(--osx-font-mono); }
.terminal-workbench > footer span { display: inline-flex; align-items: center; gap: 6px; }
</style>
.terminal-context-stack { min-width: 0; }
