<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import type {
  OsxAgentComposerAttachment,
  OsxAgentComposerContextItem,
  OsxAgentComposerOption,
  OsxAgentComposerSubmission,
  OsxAgentComposerSuggestion,
  OsxPlanStep,
} from "@vraxis/osx-components";
import {
  appThemes,
  promptAttachmentLimits,
  promptSkillLimits,
  type AppTheme,
  type ApprovalDuration,
  type ApprovalRuleSummary,
  type ApprovalSummary,
  type ActivityEvent,
  type BrowserActionRequest,
  type BrowserSessionSummary,
  type BrowserControlSummary,
  type BootstrapState,
  type InspectorView,
  type PromptAttachment,
  type ProjectSummary,
  type ProjectDoctorSummary,
  type RuntimeMaintenanceActionSummary,
  type RuntimeSummary,
  type SessionMode,
  type SessionEventsResponse,
  type SessionMutationResponse,
  type SessionLiveEvidenceResponse,
  type SessionStreamPayload,
  type SessionSummary,
  type SteeringDelivery,
  type TerminalRunSummary,
  type TeamPolicyBundleV1,
  type TeamPolicyCreateRequest,
  type TeamPolicyState,
  type TaskProofEnvelopeV1,
  type TaskEvidenceKindV1,
  type UpdateSettingsRequest,
  type UserSettings,
  type WorkspaceDiff,
  type WorkspaceEvidenceResponse,
  type WorkspaceFileContent,
  type VerificationRunSummary,
  type VerificationHandoffSummary,
} from "@vraxis/code-contracts";
import { demoState, emptyState } from "./workspace/demo-state.js";
import { chooseProjectFolder } from "./projects/project-picker.js";
import ModelProviderSettings from "./settings/ModelProviderSettings.vue";
import McpConnectionCenter from "./settings/McpConnectionCenter.vue";
import AgentHarnessSettings from "./settings/AgentHarnessSettings.vue";
import AgentDefaults from "./settings/AgentDefaults.vue";
import AuthorityModeSettings from "./settings/AuthorityModeSettings.vue";
import PermissionCenter from "./settings/PermissionCenter.vue";
import ProofTrustSettings from "./settings/ProofTrustSettings.vue";
import TeamPolicySettings from "./settings/TeamPolicySettings.vue";
import SupportDiagnostics from "./settings/SupportDiagnostics.vue";
import FirstRunJourney from "./onboarding/FirstRunJourney.vue";
import TerminalWorkbench from "./terminal/TerminalWorkbench.vue";
import WorkspaceSplash from "./workspace/WorkspaceSplash.vue";
import type { FirstRunActionId } from "./onboarding/first-run-readiness.js";
import { highlightCode } from "./workspace/syntax-highlight.js";
import { normalizeMode, selectedProject, selectedSession } from "./workspace/workspace-state.js";
import { normalizeBrowserAddress } from "./browser/browser-address.js";
import {
  captureWorkspaceState,
  cloneWorkspaceValue,
  resetWorkspaceState,
  restoreWorkspaceState,
  workspaceStateKey,
  type WorkspaceStateSnapshot,
} from "./workspace/workspace-cache.js";
import WorkspaceFileTree from "./workspace/WorkspaceFileTree.vue";
import { createActivityPresenter } from "./activity/activity-presenter.js";
import type { DisplayActivityEvent } from "./activity/session-activity.js";

const previewVariant = new URLSearchParams(window.location.search).get("preview");
const previewMode = Boolean(previewVariant);
const state = reactive<BootstrapState>(structuredClone(previewVariant === "project" ? demoState : emptyState));
const activeView = ref<"workspace" | "settings">("workspace");
const inspector = ref<InspectorView>("files");
const mode = ref<SessionMode>(state.settings.defaultMode);
const composer = ref("");
const sessionPane = ref<HTMLElement>();
const taskEnd = ref<HTMLElement>();
const latestMessagesHidden = ref(false);
const composerAttachments = ref<OsxAgentComposerAttachment[]>([]);
const composerContextItems = ref<OsxAgentComposerContextItem[]>([]);
const attachmentReferences = new Map<string, PromptAttachment>();
interface PreparedPrompt {
  prompt: string;
  attachments: PromptAttachment[];
  skillIds: string[];
  projectId: string;
  sessionId?: string;
  mode: SessionMode;
  runtimeId: string;
  modelId: string;
  branchSlug?: string;
  delivery?: SteeringDelivery;
}
const pendingAttachmentHandoff = ref<PreparedPrompt>();
const composerBranchSlug = ref("");
const steeringDelivery = ref<SteeringDelivery>("queue");
const initialRuntimeId = state.settings.defaultRuntimeId
  ?? state.runtimes.find((item) => item.availability === "installed")?.id
  ?? state.runtimes[0]?.id
  ?? "";
const selectedRuntimeId = ref(initialRuntimeId);
const selectedModelId = ref(state.settings.runtimeModels?.[initialRuntimeId] ?? "");
const loading = ref(!previewMode);
const serviceOnline = ref(previewMode);
const loadError = ref("");
const taskError = ref("");
const submitting = ref(false);
const startingNewTask = ref(false);
const registering = ref(false);
const registrationError = ref("");
const selectedFile = ref("");
const filePreview = ref<WorkspaceFileContent>();
const fileLoading = ref(false);
const fileError = ref("");
const selectedChange = ref("");
const changeDiff = ref<WorkspaceDiff>();
const selectedHunkIds = ref<string[]>([]);
const changeLoading = ref(false);
const changeError = ref("");
const settingsSaving = ref(false);
const runtimeRefreshing = ref(false);
const runtimeProbingId = ref("");
const settingsError = ref("");
const runtimeActionNotice = ref("");
const permissionRules = ref<ApprovalRuleSummary[]>([]);
const permissionLoading = ref(false);
const permissionError = ref("");
const permissionNotice = ref("");
const permissionActionId = ref("");
const permissionExporting = ref(false);
const teamPolicy = ref<TeamPolicyState>({ status: "none" });
const teamPolicyBusy = ref(false);
const teamPolicyError = ref("");
const teamPolicyNotice = ref("");
const terminalError = ref("");
const terminalStarting = ref(false);
const browserUrl = ref("http://127.0.0.1:4318/");
const browserAddressInput = ref<HTMLInputElement>();
const browserAddressEditing = ref(false);
const browserActionPending = ref<BrowserActionRequest["action"] | "">("");
const browserHostReady = ref(false);
const browserHostLoading = ref(false);
const browserCanGoBack = ref(false);
const browserCanGoForward = ref(false);
const browserText = ref("");
const browserError = ref("");
const browserDetailsOpen = ref(false);
const selectedBrowserControlRef = ref("");
const selectedBrowserActionId = ref("");
const browserLiveSurface = ref<HTMLElement>();
const selectedTerminalRunId = ref("");
const focusedEvidence = ref<{ kind: TaskEvidenceKindV1; target: string }>();
const approvalActionId = ref("");
const verificationAction = ref("");
const receiptExporting = ref<"html" | "json" | "">("");
const browserReplayExporting = ref(false);
const firstRunJourneyClosed = ref(false);
let runPollTimer: ReturnType<typeof setTimeout> | undefined;
let taskStream: EventSource | undefined;
let taskStreamSessionId = "";
let taskStreamConnected = false;
let stopProtocolListener: (() => void) | undefined;
let stopBrowserStateListener: (() => void) | undefined;
let browserResizeObserver: ResizeObserver | undefined;
let browserEvidenceTimer: ReturnType<typeof setTimeout> | undefined;
let browserEvidenceInterval: ReturnType<typeof setInterval> | undefined;
let lastBrowserLayoutSessionId = "";
let protocolOpenQueue: Promise<void> = Promise.resolve();
const terminalInputWrites = new Map<string, Promise<void>>();
const desktopBrowserAvailable = Boolean(window.vraxisDesktop?.browserView);
const workspaceRefreshing = ref(false);
const workspaceStateCache = new Map<string, WorkspaceStateSnapshot>();
const latestWorkspaceKeyByProject = new Map<string, string>();
interface WorkspaceViewSnapshot {
  inspector: InspectorView;
  selectedFile: string;
  filePreview?: WorkspaceFileContent;
  selectedChange: string;
  changeDiff?: WorkspaceDiff;
  selectedHunkIds: string[];
  composer: string;
  composerAttachments: OsxAgentComposerAttachment[];
  composerContextItems: OsxAgentComposerContextItem[];
  attachmentReferences: Array<[string, PromptAttachment]>;
  firstRunJourneyClosed: boolean;
}
const workspaceViewCache = new Map<string, WorkspaceViewSnapshot>();
const filePreviewCache = new Map<string, WorkspaceFileContent>();
const changeDiffCache = new Map<string, WorkspaceDiff>();
let selectionQueue: Promise<void> = Promise.resolve();
let selectionVersion = 0;
let bootstrapRequestVersion = 0;
let bootstrapAbortController: AbortController | undefined;
let hydrated = previewMode;
let backgroundRefreshes = 0;
let workspaceRefreshTimer: ReturnType<typeof setTimeout> | undefined;
let fileRequestVersion = 0;
let changeRequestVersion = 0;

const project = computed(() => selectedProject(state));
const session = computed(() => selectedSession(state));
const projectSessions = computed(() => state.sessions.filter((item) => item.projectId === project.value?.id));
const showFirstRunJourney = computed(() => !firstRunJourneyClosed.value && projectSessions.value.length <= 1);
const STARTUP_RECOVERY_DISMISS_KEY = "vraxis-code:dismissed-startup-recovery";

function readDismissedStartupRecoveryCheckedAt(): string {
  try {
    return sessionStorage.getItem(STARTUP_RECOVERY_DISMISS_KEY) ?? "";
  } catch {
    return "";
  }
}

const dismissedStartupRecoveryCheckedAt = ref(readDismissedStartupRecoveryCheckedAt());
const showStartupRecoveryAlert = computed(() => {
  const recovery = state.startupRecovery;
  if (!recovery?.previousUnexpectedExit) return false;
  return recovery.checkedAt !== dismissedStartupRecoveryCheckedAt.value;
});

function dismissStartupRecoveryAlert(): void {
  const checkedAt = state.startupRecovery?.checkedAt;
  if (!checkedAt) return;
  dismissedStartupRecoveryCheckedAt.value = checkedAt;
  try {
    sessionStorage.setItem(STARTUP_RECOVERY_DISMISS_KEY, checkedAt);
  } catch {
    // sessionStorage may be unavailable in embedded previews
  }
}

const runtimeIsEnabled = (runtimeId: string): boolean => !state.settings.disabledRuntimeIds?.includes(runtimeId);
const localRuntimes = computed(() => state.runtimes.filter((item) => item.kind !== "hosted-provider"));
const defaultRuntime = computed(() => state.runtimes.find((item) =>
  item.id === state.settings.defaultRuntimeId && item.availability === "installed" && runtimeIsEnabled(item.id))
  ?? state.runtimes.find((item) => item.availability === "installed" && runtimeIsEnabled(item.id))
  ?? state.runtimes[0]);
const runtime = computed(() => {
  const taskRuntime = state.runtimes.find((item) => item.id === selectedRuntimeId.value);
  return taskRuntime ?? defaultRuntime.value
    ?? state.runtimes.find((item) => item.availability === "installed")
    ?? state.runtimes[0];
});
const modelId = computed(() => selectedModelId.value.trim() || undefined);
const runtimeCanBuild = computed(() => runtime.value?.capabilities?.includes("workspace-write") ?? false);
const runtimeCapabilities = computed(() => runtime.value?.productCapabilities ?? []);
const runtimeCapabilitySummary = computed(() => {
  const available = runtimeCapabilities.value.filter((item) => item.state === "available").length;
  const limited = runtimeCapabilities.value.filter((item) => item.state === "limited").length;
  return `${available}/${runtimeCapabilities.value.length} ready${limited ? ` · ${limited} limited` : ""}`;
});
const modelSuggestions = computed(() => runtime.value?.models.filter((item) => item.availability !== "missing") ?? []);
const composerModelOptions = computed<OsxAgentComposerOption[]>(() => {
  const locked = session.value?.status === "running";
  const options: OsxAgentComposerOption[] = [{
    id: "",
    label: "Runtime default",
    icon: "bot",
    disabled: locked,
    ...(locked ? { disabledReason: "Model changes apply after the current turn." } : {}),
  }];
  for (const item of modelSuggestions.value) {
    options.push({
      id: item.id,
      label: item.name,
      description: item.description,
      badge: item.isDefault ? "Default" : undefined,
      icon: "bot",
      disabled: locked,
      ...(locked ? { disabledReason: "Model changes apply after the current turn." } : {}),
    });
  }
  const selected = selectedModelId.value.trim();
  if (selected && !options.some((item) => item.id === selected)) {
    options.push({
      id: selected,
      label: selected,
      description: "Configured for this runtime",
      icon: "bot",
      disabled: locked,
      ...(locked ? { disabledReason: "Model changes apply after the current turn." } : {}),
    });
  }
  return options;
});
const composerModelLabel = computed(() => {
  const selected = modelId.value;
  if (!selected) return "Runtime default";
  return modelSuggestions.value.find((item) => item.id === selected)?.name ?? selected;
});
const composerSuggestions = computed<OsxAgentComposerSuggestion[]>(() => [
  ...state.files.map((file) => ({
    id: `project-file:${file.path}`,
    kind: "file" as const,
    trigger: "@" as const,
    label: file.path,
    description: "Approved project file",
    icon: "file-code" as const,
    keywords: file.path.split("/"),
    selectionBehavior: "attach" as const,
  })),
  ...state.skills.map((skill) => ({
    id: `skill:${skill.id}`,
    kind: "skill" as const,
    trigger: "$" as const,
    label: skill.name,
    description: skill.description,
    icon: "sparkle" as const,
    badge: skill.scopes.includes("project") ? "Project" : "Local",
    group: "Skills",
    keywords: [skill.name, skill.description, ...skill.scopes, ...skill.runtimes],
    selectionBehavior: "attach" as const,
  })),
]);
const browserComposerContext = computed<OsxAgentComposerContextItem | undefined>(() => state.browser?.url ? {
  id: "browser:current-page",
  label: state.browser.title || state.browser.url,
  kind: "custom",
  description: `Current browser page · ${state.browser.url}`,
  icon: "eye",
  removable: false,
} : undefined);
const visibleComposerContextItems = computed<OsxAgentComposerContextItem[]>(() => [
  ...composerContextItems.value.filter((item) => item.id !== "browser:current-page"),
  ...(browserComposerContext.value ? [browserComposerContext.value] : []),
]);
const buildWorktreeBlocked = computed(() => Boolean(session.value?.worktree
  && ["applying", "conflicted", "missing", "stale"].includes(session.value.worktree.status)));
const composerDisabled = computed(() =>
  !runtime.value
  || runtime.value.availability !== "installed"
  || !runtimeIsEnabled(runtime.value.id)
  || (mode.value === "build" && (!runtimeCanBuild.value
    || buildWorktreeBlocked.value)));
const sessionEvents = computed(() => state.events
  .filter((event) => event.sessionId === session.value?.id)
  .sort((left, right) => left.sequence - right.sequence));
const displayedSessionEvents = ref<DisplayActivityEvent[]>([]);
const activityPresenter = createActivityPresenter((events) => {
  displayedSessionEvents.value = events;
});
watch(sessionEvents, (events) => activityPresenter.update(events), { deep: true, immediate: true });
const changedFiles = computed(() => state.changes);
const availableChangeHunks = computed(() => {
  if (!changeDiff.value || !selectedChange.value) return [];
  const applied = new Set(session.value?.worktree?.appliedHunks?.[selectedChange.value] ?? []);
  return changeDiff.value.hunks.filter((hunk) => !applied.has(hunk.id));
});
const conflictingHunkIds = computed(() => new Set(
  session.value?.worktree?.conflicts
    ?.filter((conflict) => conflict.path === selectedChange.value)
    .flatMap((conflict) => conflict.hunkIds ?? []) ?? [],
));
const pendingApprovals = computed(() => state.approvals.filter((item) => item.state === "pending"));
const approvalRules = computed(() => state.approvalRules ?? []);
const latestWorktreeApproval = computed(() => state.approvals.find((item) => item.source === "worktree"));
const worktreeApplyPending = computed(() => latestWorktreeApproval.value?.state === "pending"
  || latestWorktreeApproval.value?.state === "approved"
  || latestWorktreeApproval.value?.state === "executing"
  || session.value?.worktree?.status === "applying");
const verificationRuns = computed(() => state.verificationRuns ?? []);
const verificationHandoffs = computed(() => state.verificationHandoffs ?? []);
const pendingVerificationHandoff = computed(() => verificationHandoffs.value.find((item) => item.state === "requested"));
const latestVerification = computed(() => verificationRuns.value[0]);
const verificationIsActive = computed(() => latestVerification.value?.state === "ready" || latestVerification.value?.state === "running");
const verificationCanStop = computed(() => Boolean(latestVerification.value
  && ["ready", "running", "needs-browser"].includes(latestVerification.value.state)));
const verificationHasRecipe = computed(() => Boolean(
  state.projectDoctor?.verificationChecks.length
  || state.projectDoctor?.verificationServices?.length
  || state.projectDoctor?.verificationSource?.browserRequired,
));
const verificationCanRerun = computed(() => Boolean(latestVerification.value
  && ["passed", "failed", "interrupted"].includes(latestVerification.value.state)));
const verificationBrowserTarget = computed(() => latestVerification.value?.browserTarget
  ?? state.projectDoctor?.verificationSource?.browserTarget
  ?? state.projectDoctor?.devServers[0]?.suggestedUrl);
const browserMatchesVerificationTarget = computed(() => {
  if (!verificationBrowserTarget.value) return Boolean(state.browser?.url);
  if (!state.browser?.url) return false;
  try {
    return new URL(state.browser.url).href === new URL(verificationBrowserTarget.value).href;
  } catch {
    return state.browser.url === verificationBrowserTarget.value;
  }
});
const verificationSteps = computed<OsxPlanStep[]>(() => {
  const services = latestVerification.value?.services ?? state.projectDoctor?.verificationServices ?? [];
  const checks = latestVerification.value?.checks ?? state.projectDoctor?.verificationChecks ?? [];
  const assertions = latestVerification.value?.browserAssertions ?? state.projectDoctor?.verificationBrowserAssertions ?? [];
  const visual = latestVerification.value?.visual ?? state.projectDoctor?.verificationVisual;
  const serviceSteps: OsxPlanStep[] = services.map((service) => {
    const stateValue = "state" in service ? service.state : "pending";
    return {
      id: `service:${service.id}`,
      title: service.title,
      detail: `${service.command} ${service.args.join(" ")} · health ${service.health.url}`,
      state: stateValue === "healthy" || stateValue === "stopped" ? "done" as const
        : stateValue === "failed" ? "failed" as const
          : stateValue === "starting" || stateValue === "awaiting-approval" ? "active" as const : "pending" as const,
    };
  });
  const checkSteps: OsxPlanStep[] = checks.map((check) => {
    const stateValue = "state" in check ? check.state : "pending";
    return {
      id: `check:${check.id}`,
      title: check.title,
      detail: `${check.command} ${check.args.join(" ")} · ${check.source}`,
      state: stateValue === "passed" ? "done"
        : stateValue === "failed" ? "failed"
          : stateValue === "running" || stateValue === "awaiting-approval" ? "active"
            : stateValue === "skipped" ? "skipped" : "pending",
    };
  });
  const assertionSteps: OsxPlanStep[] = assertions.map((assertion) => {
    const stateValue = "state" in assertion ? assertion.state : "pending";
    return {
      id: `browser:${assertion.id}`,
      title: assertion.title,
      detail: `${assertion.kind} ${assertion.match} “${assertion.value}”`,
      state: stateValue === "passed" ? "done" : stateValue === "failed" ? "failed" : "pending",
    };
  });
  const visualSteps: OsxPlanStep[] = visual ? [{
    id: "browser:visual",
    title: "Visual baseline",
    detail: `${visual.baselinePath} · at most ${(visual.maxDiffRatio * 100).toFixed(3)}% different`,
    state: "state" in visual ? (visual.state === "passed" ? "done" : visual.state === "failed" ? "failed" : "pending") : "pending",
  }] : [];
  return [...serviceSteps, ...checkSteps, ...assertionSteps, ...visualSteps];
});
const taskTerminalRuns = computed(() => state.terminalRuns.filter((run) => run.purpose !== "user-shell"));
const liveEvidenceActive = computed(() => pendingApprovals.value.length > 0
  || state.approvals.some((item) => item.state === "executing")
  || state.terminalRuns.some((item) => item.status === "pending" || item.status === "running")
  || verificationIsActive.value);
const browserScreenshot = computed(() => state.browser?.url && state.browser?.screenshotVersion
  ? `/api/browser/${state.browser.sessionId}/screenshot?v=${state.browser.screenshotVersion}`
  : "");
const browserIsLive = computed(() => state.browser?.status === "ready");
const browserCanNavigate = computed(() => browserIsLive.value || (desktopBrowserAvailable && browserHostReady.value));
const browserLoading = computed(() => browserHostLoading.value || Boolean(browserActionPending.value) || state.browser?.loading === true);
const browserBackAvailable = computed(() => browserCanGoBack.value || state.browser?.canGoBack === true);
const browserForwardAvailable = computed(() => browserCanGoForward.value || state.browser?.canGoForward === true);
const browserLocationIcon = computed(() => browserUrl.value.trim().startsWith("https://") ? "lock" : "external");
const desktopBrowserVisible = computed(() => desktopBrowserAvailable
  && activeView.value === "workspace"
  && inspector.value === "browser"
  && Boolean(project.value)
  && Boolean(session.value)
  && (!state.browser || browserIsLive.value));
const selectedBrowserControl = computed(() => state.browser?.controls.find((item) => item.ref === selectedBrowserControlRef.value));
const selectedBrowserAction = computed(() => state.browser?.actions.find((item) => item.id === selectedBrowserActionId.value)
  ?? state.browser?.actions.find((item) => item.beforeFrameId || item.afterFrameId));
const focusedApproval = computed(() => focusedEvidence.value?.kind === "approval"
  ? state.approvals.find((item) => item.id === focusedEvidence.value?.target)
  : undefined);
const focusedEvidenceSummary = computed(() => {
  const focus = focusedEvidence.value;
  if (!focus) return undefined;
  if (focus.kind === "change") return { title: "Change opened from proof", detail: focus.target, icon: "git-branch" as const };
  if (focus.kind === "terminal") {
    const run = state.terminalRuns.find((item) => item.id === focus.target);
    return run ? { title: "Command opened from proof", detail: `${run.command} · ${run.status}`, icon: "terminal" as const } : undefined;
  }
  if (focus.kind === "approval") {
    const approval = state.approvals.find((item) => item.id === focus.target);
    return approval ? { title: "Authority opened from proof", detail: `${approval.title} · ${approval.state}`, icon: "lock" as const } : undefined;
  }
  const action = state.browser?.actions.find((item) => item.id === focus.target);
  return action ? { title: "Browser action opened from proof", detail: `${action.action} · ${action.target}`, icon: "eye" as const } : undefined;
});
const evidenceLedger = computed(() => {
  const passedCommands = taskTerminalRuns.value.filter((item) => item.status === "success").length;
  const activeCommands = taskTerminalRuns.value.filter((item) => item.status === "pending" || item.status === "running").length;
  return {
    passedCommands,
    activeCommands,
    browserActions: state.browser?.actions.length ?? 0,
    pendingApprovals: pendingApprovals.value.length,
    verificationPassed: verificationRuns.value.filter((item) => item.state === "passed").length,
    verificationActive: verificationRuns.value.filter((item) => item.state === "ready" || item.state === "running" || item.state === "needs-browser").length,
    hasEvidence: taskTerminalRuns.value.length > 0 || Boolean(state.browser?.actions.length) || state.approvals.length > 0 || verificationRuns.value.length > 0,
  };
});
const highlightedFile = computed(() => filePreview.value
  ? highlightCode(filePreview.value.content, filePreview.value.language)
  : undefined);
const highlightedLines = computed(() => highlightedFile.value?.html.split("\n") ?? []);
const inspectorWidth = computed(() =>
  (inspector.value === "files" && selectedFile.value) || (inspector.value === "changes" && selectedChange.value)
    ? "680px"
    : inspector.value === "verify" ? "480px"
    : inspector.value === "browser" ? "620px" : inspector.value === "terminal" ? "clamp(540px, 44vw, 920px)" : "360px");
const workspaceBranch = computed(() => session.value?.worktree?.status === "active"
  ? session.value.worktree.branch
  : project.value?.branch ?? "");
const activeBuildBranch = computed(() => session.value?.worktree?.status === "active" ? session.value.worktree.branch : "");
const buildNeedsNewWorktree = computed(() => {
  if (mode.value !== "build") return false;
  const worktree = session.value?.worktree;
  if (!worktree) return true;
  if (worktree.status === "active") return false;
  return ["applied", "reverted", "archived", "cleaned"].includes(worktree.status);
});
const sourceItems = computed(() => state.projects.map((item) => item.name).join(","));
const sourceIcons = computed(() => JSON.stringify(Object.fromEntries(state.projects.map((item) => [item.name, "folder"]))));
const modeLabel = computed(() => mode.value.charAt(0).toUpperCase() + mode.value.slice(1));
const sessionIsRunning = computed(() => session.value?.status === "running");
const composerPending = computed(() => submitting.value || sessionIsRunning.value);
const activeToolSequence = computed(() => {
  if (!sessionIsRunning.value) return undefined;
  const latestUserSequence = [...sessionEvents.value].reverse()
    .find((event) => event.kind === "message" && event.actor === "user")?.sequence
    ?? Number.NEGATIVE_INFINITY;
  const currentTurn = sessionEvents.value.filter((event) => event.sequence > latestUserSequence);
  if (currentTurn.some((event) => event.kind === "message" && event.actor === "agent")) return undefined;
  return [...currentTurn].reverse().find((event) => event.kind === "tool")?.sequence;
});
const composerModeOptions = computed<OsxAgentComposerOption[]>(() => {
  const locked = sessionIsRunning.value;
  const disabledReason = locked ? "Mode changes apply after the current turn." : undefined;
  const options: OsxAgentComposerOption[] = [
    { id: "ask", label: "Ask", description: "Read the project and answer without editing.", icon: "search" },
    { id: "plan", label: "Plan", description: "Investigate and prepare an implementation plan.", icon: "list-checks" },
    { id: "build", label: "Build", description: "Make changes inside an isolated worktree.", icon: "code" },
    { id: "review", label: "Review", description: "Inspect changes without editing them.", icon: "eye" },
  ];
  return options.map((item) => ({ ...item, disabled: locked, ...(disabledReason ? { disabledReason } : {}) }));
});
const composerState = computed(() => submitting.value
  ? "submitting"
  : taskError.value ? "error"
  : sessionIsRunning.value ? "streaming"
  : "idle");
const firstRunBusy = computed(() => registering.value
  || runtimeRefreshing.value
  || Boolean(runtimeProbingId.value)
  || Boolean(verificationAction.value)
  || Boolean(receiptExporting.value));
const composerError = computed(() => taskError.value
  || (mode.value === "build" && buildWorktreeBlocked.value ? "Finish or recover the current Build worktree before continuing." : "")
  || (mode.value === "build" && !runtimeCanBuild.value ? "Choose a runtime that supports guarded isolated-workspace writes for Build mode." : "")
  || (runtime.value && runtime.value.availability !== "installed" ? runtime.value.detail : ""));
const authorityModeLabel = computed(() => state.settings.authorityMode === "full-access"
  ? "Project-scoped approvals"
  : state.settings.authorityMode === "trusted-worktree" ? "Task-scoped approvals" : "Approve each action");
const composerStatus = computed(() => sessionIsRunning.value
  ? session.value?.steering?.state === "redirecting"
    ? `Redirecting agent · ${session.value.steering.pendingCount} pending`
    : session.value?.steering?.pendingCount
      ? `Agent working · ${session.value.steering.pendingCount} ${session.value.steering.pendingCount === 1 ? "message" : "messages"} queued`
      : "Agent working · Send another message without stopping the task"
  : `${modeLabel.value} · ${runtime.value?.name ?? "Choose runtime"} · ${mode.value === "build"
  ? activeBuildBranch.value
    ? `Branch ${activeBuildBranch.value}`
    : buildNeedsNewWorktree.value && composerBranchSlug.value.trim()
      ? `Branch vraxis/${composerBranchSlug.value.trim()}`
      : session.value?.worktree && ["applied", "reverted", "archived", "cleaned"].includes(session.value.worktree.status)
        ? "New isolated worktree on send"
        : "Isolated worktree"
  : "Read only"} · ${authorityModeLabel.value}`);
const pendingImportedAttachments = computed(() => pendingAttachmentHandoff.value?.attachments.filter((item) => item.source === "imported") ?? []);
const pendingHandoffDestination = computed(() => {
  const pending = pendingAttachmentHandoff.value;
  if (!pending) return "the selected runtime";
  const runtimeName = state.runtimes.find((item) => item.id === pending.runtimeId)?.name ?? pending.runtimeId;
  return pending.modelId ? `${runtimeName} · ${pending.modelId}` : runtimeName;
});
const themeOptions = [
  { value: "graphite-dark", label: "Graphite Dark", description: "Near-black surfaces with restrained neutral controls." },
  { value: "panther", label: "Panther", description: "Dark surfaces for focused work." },
  { value: "aqua", label: "Aqua", description: "Bright surfaces with blue accents." },
  { value: "graphite", label: "Graphite", description: "Neutral surfaces with quieter accents." },
];
const inspectorOptions = [
  { value: "files" as const, label: "Files", icon: "file-code" as const },
  { value: "changes" as const, label: "Changes", icon: "git-branch" as const },
  { value: "terminal" as const, label: "Terminal", icon: "terminal" as const },
  { value: "browser" as const, label: "Browser", icon: "eye" as const },
];
const inspectorUsesTab = computed(() => inspectorOptions.some((item) => item.value === inspector.value));
function syncTaskSelection(): void {
  if (session.value) {
    selectedRuntimeId.value = session.value.runtimeId;
    selectedModelId.value = session.value.modelId ?? "";
    return;
  }
  const selectedIsInstalled = state.runtimes.some((item) =>
    item.id === selectedRuntimeId.value && item.availability === "installed" && runtimeIsEnabled(item.id));
  if (!selectedIsInstalled) selectedRuntimeId.value = defaultRuntime.value?.id ?? "";
  selectedModelId.value = state.settings.runtimeModels?.[selectedRuntimeId.value] ?? "";
}

function modeForSession(item: SessionSummary | undefined, fallback: SessionMode): SessionMode {
  return item?.mode ?? fallback;
}

function visibleSessionMode(item: SessionSummary): SessionMode {
  return item.id === state.selectedSessionId ? mode.value : item.mode;
}

function cacheCurrentWorkspace(): string | undefined {
  const snapshot = captureWorkspaceState(state);
  if (!snapshot) return undefined;
  const key = workspaceStateKey(snapshot.projectId, snapshot.sessionId);
  workspaceStateCache.set(key, snapshot);
  latestWorkspaceKeyByProject.set(snapshot.projectId, key);
  workspaceViewCache.set(key, cloneWorkspaceValue({
    inspector: inspector.value,
    selectedFile: selectedFile.value,
    ...(filePreview.value ? { filePreview: filePreview.value } : {}),
    selectedChange: selectedChange.value,
    ...(changeDiff.value ? { changeDiff: changeDiff.value } : {}),
    selectedHunkIds: selectedHunkIds.value,
    composer: composer.value,
    composerAttachments: composerAttachments.value,
    composerContextItems: composerContextItems.value,
    attachmentReferences: [...attachmentReferences.entries()],
    firstRunJourneyClosed: firstRunJourneyClosed.value,
  }));
  return key;
}

function restoreWorkspaceView(key: string): void {
  const view = workspaceViewCache.get(key);
  if (!view) {
    inspector.value = "files";
    closeFilePreview();
    closeChangeDiff();
    composer.value = "";
    composerAttachments.value = [];
    composerContextItems.value = [];
    attachmentReferences.clear();
    firstRunJourneyClosed.value = false;
    return;
  }
  inspector.value = view.inspector;
  selectedFile.value = view.selectedFile;
  filePreview.value = view.filePreview ? cloneWorkspaceValue(view.filePreview) : undefined;
  selectedChange.value = view.selectedChange;
  changeDiff.value = view.changeDiff ? cloneWorkspaceValue(view.changeDiff) : undefined;
  selectedHunkIds.value = [...view.selectedHunkIds];
  composer.value = view.composer;
  composerAttachments.value = cloneWorkspaceValue(view.composerAttachments);
  composerContextItems.value = cloneWorkspaceValue(view.composerContextItems);
  attachmentReferences.clear();
  for (const [id, attachment] of view.attachmentReferences) attachmentReferences.set(id, cloneWorkspaceValue(attachment));
  firstRunJourneyClosed.value = view.firstRunJourneyClosed;
  fileLoading.value = false;
  fileError.value = "";
  changeLoading.value = false;
  changeError.value = "";
}

function restoreCachedWorkspace(projectId: string, sessionId?: string): boolean {
  const preferredKey = sessionId
    ? workspaceStateKey(projectId, sessionId)
    : latestWorkspaceKeyByProject.get(projectId);
  const snapshot = preferredKey ? workspaceStateCache.get(preferredKey) : undefined;
  if (!snapshot) {
    const fallbackSession = sessionId ?? state.sessions.find((item) => item.projectId === projectId)?.id;
    resetWorkspaceState(state, projectId, fallbackSession);
    restoreWorkspaceView(workspaceStateKey(projectId, fallbackSession));
    mode.value = modeForSession(state.sessions.find((item) => item.id === fallbackSession), state.settings.defaultMode);
    syncTaskSelection();
    return false;
  }
  restoreWorkspaceState(state, snapshot);
  restoreWorkspaceView(workspaceStateKey(snapshot.projectId, snapshot.sessionId));
  mode.value = modeForSession(state.sessions.find((item) => item.id === snapshot.sessionId), state.settings.defaultMode);
  syncTaskSelection();
  if (state.browser?.url) syncBrowserAddress(state.browser.url);
  scheduleRunPoll();
  return true;
}

function queueSelection(path: string): Promise<void> {
  const request = selectionQueue.then(async () => { await post(path, {}); });
  selectionQueue = request.catch(() => undefined);
  return request;
}

function beginBackgroundRefresh(): void {
  backgroundRefreshes += 1;
  if (workspaceRefreshTimer || workspaceRefreshing.value) return;
  workspaceRefreshTimer = setTimeout(() => {
    workspaceRefreshTimer = undefined;
    if (backgroundRefreshes > 0) workspaceRefreshing.value = true;
  }, 140);
}

function finishBackgroundRefresh(): void {
  backgroundRefreshes = Math.max(0, backgroundRefreshes - 1);
  if (backgroundRefreshes) return;
  if (workspaceRefreshTimer) clearTimeout(workspaceRefreshTimer);
  workspaceRefreshTimer = undefined;
  workspaceRefreshing.value = false;
}

async function fetchBootstrap(scope: "shell" | "workspace" | "catalog" | "full", signal: AbortSignal): Promise<Partial<BootstrapState>> {
  const response = await fetch(`/api/bootstrap?scope=${scope}`, { signal });
  if (!response.ok) throw new Error("The local service did not respond.");
  return await response.json() as Partial<BootstrapState>;
}

function applyBootstrapPatch(next: Partial<BootstrapState>): void {
  const patch: Partial<BootstrapState> = {
    ...next,
    approvals: next.approvals ?? [],
    approvalRules: next.approvalRules ?? [],
    terminalRuns: next.terminalRuns ?? [],
    verificationRuns: next.verificationRuns ?? [],
  };
  if ("selectedSessionId" in patch && !patch.selectedSessionId) delete state.selectedSessionId;
  if ("browser" in patch) {
    if (patch.browser) state.browser = patch.browser;
    else delete state.browser;
    delete patch.browser;
  }
  if ("selectedSessionId" in patch && !patch.selectedSessionId) delete patch.selectedSessionId;
  Object.assign(state, patch);
}

function syncBootstrapSelection(projectChanged: boolean): void {
  if (state.browser?.url) syncBrowserAddress(state.browser.url);
  const nextSession = state.sessions.find((item) => item.id === state.selectedSessionId);
  mode.value = modeForSession(nextSession, state.settings.defaultMode);
  syncTaskSelection();
  if (projectChanged) firstRunJourneyClosed.value = false;
  if (projectChanged || (selectedFile.value && !state.files.some((file) => file.path === selectedFile.value))) closeFilePreview();
  if (projectChanged || (selectedChange.value && !state.changes.some((file) => file.path === selectedChange.value))) closeChangeDiff();
}

async function loadState(options: { blocking?: boolean } = {}): Promise<void> {
  if (previewMode) return;
  const blocking = options.blocking ?? !hydrated;
  const requestVersion = ++bootstrapRequestVersion;
  bootstrapAbortController?.abort();
  const controller = new AbortController();
  bootstrapAbortController = controller;
  if (blocking) {
    loading.value = true;
    loadError.value = "";
  } else beginBackgroundRefresh();
  try {
    const staged = blocking && !hydrated;
    const shell = await fetchBootstrap(staged ? "shell" : "full", controller.signal);
    if (requestVersion !== bootstrapRequestVersion) return;
    const projectChanged = state.selectedProjectId !== shell.selectedProjectId;
    applyBootstrapPatch(shell);
    serviceOnline.value = true;
    syncBootstrapSelection(projectChanged);
    if (staged) {
      hydrated = true;
      loading.value = false;
      cacheCurrentWorkspace();
      scheduleRunPoll();
      const [workspace, catalog] = await Promise.all([
        fetchBootstrap("workspace", controller.signal),
        fetchBootstrap("catalog", controller.signal),
      ]);
      if (requestVersion !== bootstrapRequestVersion) return;
      applyBootstrapPatch(workspace);
      applyBootstrapPatch(catalog);
      syncBootstrapSelection(false);
      cacheCurrentWorkspace();
      scheduleRunPoll();
      return;
    }
    hydrated = true;
    cacheCurrentWorkspace();
    scheduleRunPoll();
  } catch (error) {
    if (controller.signal.aborted) return;
    serviceOnline.value = false;
    if (blocking) loadError.value = error instanceof Error ? error.message : "The local service did not respond.";
  } finally {
    if (requestVersion === bootstrapRequestVersion) bootstrapAbortController = undefined;
    if (blocking) loading.value = false;
    else finishBackgroundRefresh();
  }
}

function eventValue(event: Event): unknown {
  return (event as CustomEvent<[unknown]>).detail?.[0];
}

function filename(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] ?? path;
}

function attachmentSizeLabel(size = 0): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function chooseInspectorView(view: InspectorView): void {
  inspector.value = view;
  if (view === "terminal") void ensureUserTerminal();
}

function handleWorkspaceShortcut(event: KeyboardEvent): void {
  if (activeView.value !== "workspace" || !project.value) return;
  if (event.code === "Backquote" && event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey) {
    event.preventDefault();
    chooseInspectorView("terminal");
    void nextTick(() => document.querySelector<HTMLElement>(".terminal-emulator .xterm-helper-textarea")?.focus());
    return;
  }
  if (inspector.value !== "browser") return;
  const command = event.metaKey || event.ctrlKey;
  if (command && event.key.toLowerCase() === "l") {
    event.preventDefault();
    browserAddressEditing.value = true;
    void nextTick(() => browserAddressInput.value?.select());
  } else if (command && event.key.toLowerCase() === "r") {
    event.preventDefault();
    if (browserCanNavigate.value && browserUrl.value) void requestBrowserAction("reload");
  } else if (event.altKey && event.key === "ArrowLeft") {
    event.preventDefault();
    if (browserBackAvailable.value) void requestBrowserAction("back");
  } else if (event.altKey && event.key === "ArrowRight") {
    event.preventDefault();
    if (browserForwardAvailable.value) void requestBrowserAction("forward");
  }
}

function verificationLabel(run: VerificationRunSummary): string {
  if (run.state === "needs-browser") return "Browser proof needed";
  if (run.state === "passed") return "Passed";
  if (run.state === "failed") return "Failed";
  if (run.state === "interrupted") return "Interrupted";
  return run.state === "running" ? "Running" : "Ready";
}

function verificationTone(run: VerificationRunSummary): "neutral" | "info" | "success" | "warning" | "error" {
  if (run.state === "passed") return "success";
  if (run.state === "failed") return "error";
  if (run.state === "needs-browser" || run.state === "interrupted") return "warning";
  return run.state === "running" ? "info" : "neutral";
}

function approvalDescription(approval: ApprovalSummary): string {
  const detail = approval.failure ? `${approval.description} ${approval.failure}` : approval.description;
  if (!approval.teamPolicy) return detail;
  const requirement = approval.teamPolicy.effect === "deny"
    ? `${approval.teamPolicy.organization} policy blocks this capability.`
    : `${approval.teamPolicy.organization} policy requires a fresh decision.`;
  return `${detail} ${requirement}`;
}

function updateBrowserUrl(event: Event): void {
  browserUrl.value = event.target instanceof HTMLInputElement
    ? event.target.value
    : String(eventValue(event) ?? "");
  browserError.value = "";
}

function syncBrowserAddress(url: string): void {
  if (!browserAddressEditing.value) browserUrl.value = url;
}

async function submitBrowserAddress(): Promise<void> {
  try {
    browserUrl.value = normalizeBrowserAddress(browserUrl.value);
    browserAddressEditing.value = false;
    browserAddressInput.value?.blur();
    await requestBrowserAction("navigate");
  } catch (error) {
    browserError.value = error instanceof Error ? error.message : "Enter a valid browser URL.";
    browserAddressInput.value?.focus();
  }
}

function restoreBrowserAddress(): void {
  browserAddressEditing.value = false;
  browserUrl.value = state.browser?.url || "";
  browserError.value = "";
  browserAddressInput.value?.blur();
}

function updateBrowserText(event: Event): void {
  browserText.value = String(eventValue(event) ?? "");
  browserError.value = "";
}

function selectBrowserControl(control: BrowserControlSummary): void {
  selectedBrowserControlRef.value = control.ref;
  browserText.value = "";
  browserError.value = "";
}

function browserControlIcon(control: BrowserControlSummary): "play" | "pencil" | "external" | "check" | "list-checks" {
  if (control.kind === "link") return "external";
  if (control.kind === "textbox") return "pencil";
  if (control.kind === "checkbox" || control.kind === "radio") return "check";
  if (control.kind === "combobox") return "list-checks";
  return "play";
}

function browserMarkerStyle(control: BrowserControlSummary): Record<string, string> {
  const width = state.browser?.viewport.width ?? 1280;
  const height = state.browser?.viewport.height ?? 820;
  return {
    left: `${Math.min(99, Math.max(1, ((control.bounds.x + control.bounds.width / 2) / width) * 100))}%`,
    top: `${Math.min(98, Math.max(2, ((control.bounds.y + control.bounds.height / 2) / height) * 100))}%`,
  };
}

function browserFrameUrl(frameId: string | undefined): string {
  return frameId && state.browser ? `/api/browser/${state.browser.sessionId}/frames/${frameId}` : "";
}

function moveInspectorFocus(event: KeyboardEvent, index: number): void {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  let nextIndex = index;
  if (event.key === "Home") nextIndex = 0;
  else if (event.key === "End") nextIndex = inspectorOptions.length - 1;
  else if (event.key === "ArrowRight") nextIndex = (index + 1) % inspectorOptions.length;
  else nextIndex = (index - 1 + inspectorOptions.length) % inspectorOptions.length;
  const next = inspectorOptions[nextIndex];
  if (!next) return;
  inspector.value = next.value;
  const tabs = (event.currentTarget as HTMLElement)
    .closest<HTMLElement>("[role=\"tablist\"]")
    ?.querySelectorAll<HTMLButtonElement>("[role=\"tab\"]");
  tabs?.[nextIndex]?.focus();
}

function taskPaneIsNearBottom(): boolean {
  const pane = sessionPane.value;
  if (!pane) return true;
  return pane.scrollHeight - pane.scrollTop - pane.clientHeight <= 80;
}

// Observe the end of the transcript, not individual messages: streamed content,
// expanded tools, and pane resizes all update visibility without polling.
watch([sessionPane, taskEnd], ([pane, end], _previous, onCleanup) => {
  latestMessagesHidden.value = false;
  if (!pane || !end) return;
  const observer = new IntersectionObserver(([entry]) => {
    latestMessagesHidden.value = Boolean(entry && !entry.isIntersecting);
  }, { rootMargin: "0px 0px 8px 0px" });
  observer.observe(end);
  onCleanup(() => observer.disconnect());
}, { flush: "post" });

async function jumpToLatest(): Promise<void> {
  const pane = sessionPane.value;
  const end = taskEnd.value;
  if (!pane || !end) return;
  // Keep keyboard focus in the conversation when the jump button disappears.
  pane.focus({ preventScroll: true });
  let cancelled = false;
  const cancel = () => { cancelled = true; };
  for (const event of ["wheel", "touchstart", "keydown"] as const) {
    window.addEventListener(event, cancel, { passive: true, capture: true });
  }
  try {
    let stableFrames = 0;
    let previousHeight = -1;
    // content-visibility replaces estimated message heights during a jump.
    // Follow the end through that layout work, but never fight user scrolling.
    for (let frame = 0; frame < 24 && stableFrames < 4; frame += 1) {
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      if (cancelled || sessionPane.value !== pane || taskEnd.value !== end) return;
      const height = pane.scrollHeight;
      const bounds = end.getBoundingClientRect();
      const paneBounds = pane.getBoundingClientRect();
      const bottom = Math.min(window.innerHeight, paneBounds.bottom);
      const atEnd = bounds.bottom <= bottom + 2 && bounds.top >= Math.max(0, paneBounds.top);
      stableFrames = atEnd && height === previousHeight ? stableFrames + 1 : 0;
      previousHeight = height;
      // Also handles the narrow layout, where the document itself scrolls.
      if (!atEnd) end.scrollIntoView({ block: "end", behavior: "instant" });
    }
  } finally {
    for (const event of ["wheel", "touchstart", "keydown"] as const) {
      window.removeEventListener(event, cancel, true);
    }
  }
}

async function scrollTaskToBottom(): Promise<void> {
  await nextTick();
  for (let frame = 0; frame < 2; frame += 1) {
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    const pane = sessionPane.value;
    if (!pane) return;
    pane.scrollTop = pane.scrollHeight;
  }
}

watch(
  () => pendingApprovals.value.map((approval) => approval.id).sort().join(","),
  (currentIds, previousIds) => {
    if (!currentIds) return;
    const previous = new Set(previousIds.split(",").filter(Boolean));
    if (currentIds.split(",").some((id) => !previous.has(id))) void scrollTaskToBottom();
  },
  { flush: "post" },
);

function chooseMode(event: Event): void {
  if (sessionIsRunning.value) return;
  const nextMode = normalizeMode(eventValue(event));
  mode.value = nextMode;
  taskError.value = "";
  if (nextMode === "review") void scrollTaskToBottom();
}

function chooseTaskRuntime(event: Event): void {
  selectedRuntimeId.value = (event.target as HTMLSelectElement).value;
  selectedModelId.value = state.settings.runtimeModels?.[selectedRuntimeId.value] ?? "";
  taskError.value = "";
}

function chooseTaskModel(event: Event): void {
  selectedModelId.value = String(eventValue(event) ?? "");
  taskError.value = "";
}

function updateComposerValue(event: Event): void {
  composer.value = String(eventValue(event) ?? "");
  taskError.value = "";
}

function syncComposerAttachments(event: Event): void {
  const next = (eventValue(event) as OsxAgentComposerAttachment[] | undefined) ?? [];
  const retained = new Set(next.map((item) => item.id));
  for (const [id, attachment] of attachmentReferences) {
    if (retained.has(id)) continue;
    attachmentReferences.delete(id);
    if (attachment.source === "imported") void discardImportedAttachment(attachment);
  }
  composerAttachments.value = next;
}

function syncComposerContext(event: Event): void {
  composerContextItems.value = ((eventValue(event) as OsxAgentComposerContextItem[] | undefined) ?? [])
    .filter((item) => item.id !== "browser:current-page");
}

async function acceptNativeAttachments(event: Event): Promise<void> {
  const files = (eventValue(event) as File[] | undefined) ?? [];
  const next = [...composerAttachments.value];
  const errors: string[] = [];
  for (const file of files) {
    if (next.filter((item) => item.status !== "error").length >= promptAttachmentLimits.maximumCount) {
      errors.push(`Attach no more than ${promptAttachmentLimits.maximumCount} files.`);
      break;
    }
    const pendingId = `importing-file:${crypto.randomUUID()}`;
    const pending: OsxAgentComposerAttachment = {
      id: pendingId,
      name: file.name,
      kind: file.type.startsWith("image/") ? "image" : "file",
      mediaType: file.type || "File",
      status: "loading",
      removable: true,
    };
    next.push(pending);
    composerAttachments.value = [...next];
    try {
      const imported = await importAttachment(file);
      attachmentReferences.set(imported.id, imported);
      const index = next.findIndex((item) => item.id === pendingId);
      if (index >= 0) next[index] = { ...pending, id: imported.id, mediaType: imported.mediaType ?? "File", status: "ready" };
    } catch (error) {
      const message = error instanceof Error ? error.message : "The file could not be attached.";
      const index = next.findIndex((item) => item.id === pendingId);
      if (index >= 0) next[index] = { ...pending, status: "error", error: message };
      errors.push(`${file.name}: ${message}`);
    }
    composerAttachments.value = [...next];
  }
  taskError.value = errors.join(" ");
}

async function importAttachment(file: File): Promise<PromptAttachment> {
  const response = await fetch("/api/attachments", {
    method: "POST",
    headers: {
      "content-type": file.type || "application/octet-stream",
      "x-vraxis-file-name": encodeURIComponent(file.name),
    },
    body: file,
  });
  const result = await response.json() as PromptAttachment & { error?: string };
  if (!response.ok) throw new Error(result.error ?? "The file could not be imported.");
  return result;
}

async function discardImportedAttachment(attachment: PromptAttachment): Promise<void> {
  try { await fetch(`/api/attachments/${attachment.path}`, { method: "DELETE" }); } catch { /* Draft cleanup is best effort. */ }
}

function submissionAttachments(submission?: OsxAgentComposerSubmission): PromptAttachment[] {
  const references = new Map<string, PromptAttachment>();
  for (const attachment of submission?.attachments ?? composerAttachments.value) {
    const reference = attachmentReferences.get(attachment.id);
    if (reference) references.set(reference.id, reference);
  }
  for (const item of submission?.contextItems ?? []) {
    if (!item.id.startsWith("project-file:")) continue;
    const path = item.id.slice("project-file:".length);
    if (!state.files.some((file) => file.path === path)) continue;
    references.set(item.id, { id: item.id, name: filename(path), path });
  }
  return [...references.values()].slice(0, promptAttachmentLimits.maximumCount);
}

function submissionSkillIds(submission?: OsxAgentComposerSubmission): string[] {
  const available = new Set(state.skills.map((skill) => skill.id));
  const selected = (submission?.contextItems ?? [])
    .filter((item) => item.id.startsWith("skill:"))
    .map((item) => item.id.slice("skill:".length))
    .filter((id) => available.has(id));
  return [...new Set(selected)].slice(0, promptSkillLimits.maximumCount);
}

async function chooseProject(event: Event): Promise<void> {
  const name = String(eventValue(event));
  const next = state.projects.find((item) => item.name === name);
  activeView.value = "workspace";
  if (!next || next.id === state.selectedProjectId) return;
  const previousKey = cacheCurrentWorkspace();
  const requestVersion = ++selectionVersion;
  focusedEvidence.value = undefined;
  restoreCachedWorkspace(next.id);
  loadError.value = "";
  try {
    await queueSelection(`/api/projects/${next.id}/select`);
    if (requestVersion !== selectionVersion) return;
    await loadState({ blocking: false });
  } catch (error) {
    if (requestVersion !== selectionVersion) return;
    const previous = previousKey ? workspaceStateCache.get(previousKey) : undefined;
    if (previous) {
      restoreWorkspaceState(state, previous);
      restoreWorkspaceView(previousKey!);
      mode.value = modeForSession(state.sessions.find((item) => item.id === previous.sessionId), state.settings.defaultMode);
      syncTaskSelection();
    }
    taskError.value = error instanceof Error ? error.message : "The project could not be opened.";
  }
}

async function chooseSession(item: SessionSummary): Promise<void> {
  activeView.value = "workspace";
  if (item.id === state.selectedSessionId) {
    if (item.mode === "review" || mode.value === "review" || pendingApprovals.value.length) await scrollTaskToBottom();
    return;
  }
  const previousKey = cacheCurrentWorkspace();
  const requestVersion = ++selectionVersion;
  focusedEvidence.value = undefined;
  restoreCachedWorkspace(item.projectId, item.id);
  mode.value = item.mode;
  try {
    await queueSelection(`/api/sessions/${item.id}/select`);
    if (requestVersion !== selectionVersion) return;
    await loadState({ blocking: false });
    if (item.mode === "review" || pendingApprovals.value.length) await scrollTaskToBottom();
  } catch (error) {
    if (requestVersion !== selectionVersion) return;
    const previous = previousKey ? workspaceStateCache.get(previousKey) : undefined;
    if (previous) {
      restoreWorkspaceState(state, previous);
      restoreWorkspaceView(previousKey!);
      mode.value = modeForSession(state.sessions.find((candidate) => candidate.id === previous.sessionId), state.settings.defaultMode);
      syncTaskSelection();
    }
    taskError.value = error instanceof Error ? error.message : "The task could not be opened.";
  }
}

async function startNewTask(): Promise<void> {
  if (!project.value || previewMode || startingNewTask.value) return;
  const projectId = project.value.id;
  const retainedMode = mode.value;
  const retainedRuntimeId = selectedRuntimeId.value;
  const retainedModelId = selectedModelId.value;
  startingNewTask.value = true;
  taskError.value = "";
  try {
    await post(`/api/projects/${projectId}/new-task`, {});
    focusedEvidence.value = undefined;
    selectedTerminalRunId.value = "";
    selectedBrowserActionId.value = "";
    activeView.value = "workspace";
    cacheCurrentWorkspace();
    resetWorkspaceState(state, projectId);
    restoreWorkspaceView(workspaceStateKey(projectId));
    await loadState({ blocking: false });
    mode.value = retainedMode;
    if (state.runtimes.some((item) => item.id === retainedRuntimeId)) {
      selectedRuntimeId.value = retainedRuntimeId;
      selectedModelId.value = retainedModelId;
    }
    await nextTick();
    document.querySelector<HTMLElement>("osx-agent-composer")?.focus();
  } catch (error) {
    taskError.value = error instanceof Error ? error.message : "A new task could not be started.";
  } finally {
    startingNewTask.value = false;
  }
}

function chooseFilePath(path: string): void {
  selectedFile.value = path;
  void loadSelectedFile();
}

function closeFilePreview(): void {
  selectedFile.value = "";
  filePreview.value = undefined;
  fileLoading.value = false;
  fileError.value = "";
}

function openChangedFile(path: string): void {
  inspector.value = "changes";
  selectedChange.value = path;
  selectedHunkIds.value = [];
  void loadChangeDiff();
}

function closeChangeDiff(): void {
  selectedChange.value = "";
  changeDiff.value = undefined;
  selectedHunkIds.value = [];
  changeLoading.value = false;
  changeError.value = "";
}

async function loadChangeDiff(): Promise<void> {
  if (!session.value || !selectedChange.value) {
    changeDiff.value = undefined;
    return;
  }
  const sessionId = session.value.id;
  const path = selectedChange.value;
  const cacheKey = `${sessionId}:${path}`;
  const cached = changeDiffCache.get(cacheKey);
  const requestVersion = ++changeRequestVersion;
  if (cached) {
    changeDiff.value = cloneWorkspaceValue(cached);
    selectedHunkIds.value = selectedHunkIds.value.filter((id) => cached.hunks.some((hunk) => hunk.id === id));
  }
  changeLoading.value = !cached;
  changeError.value = "";
  try {
    if (previewMode) {
      changeDiff.value = {
        path: selectedChange.value,
        patch: `diff --git a/${selectedChange.value} b/${selectedChange.value}\n--- a/${selectedChange.value}\n+++ b/${selectedChange.value}\n@@ -1 +1 @@\n-export const ready = false;\n+export const ready = true;\n`,
        language: "typescript",
        additions: 1,
        deletions: 1,
        binary: false,
        partialSelection: true,
        hunks: [{ id: "preview-hunk", header: "@@ -1 +1 @@", additions: 1, deletions: 1 }],
      };
      return;
    }
    const response = await fetch(`/api/sessions/${sessionId}/diff?path=${encodeURIComponent(path)}`);
    const result = await response.json() as WorkspaceDiff & { error?: string };
    if (!response.ok) throw new Error(result.error ?? "The diff could not be loaded.");
    changeDiffCache.set(cacheKey, cloneWorkspaceValue(result));
    if (requestVersion !== changeRequestVersion || session.value?.id !== sessionId || selectedChange.value !== path) return;
    changeDiff.value = result;
    selectedHunkIds.value = selectedHunkIds.value.filter((id) => result.hunks.some((hunk) => hunk.id === id));
  } catch (error) {
    if (requestVersion !== changeRequestVersion) return;
    if (!cached) changeDiff.value = undefined;
    changeError.value = error instanceof Error ? error.message : "The diff could not be refreshed.";
  } finally {
    if (requestVersion === changeRequestVersion) changeLoading.value = false;
  }
}

async function loadSelectedFile(): Promise<void> {
  if (!project.value || !selectedFile.value) {
    filePreview.value = undefined;
    return;
  }
  const projectId = project.value.id;
  const sessionId = session.value?.id;
  const path = selectedFile.value;
  const cacheKey = `${projectId}:${sessionId ?? "project"}:${path}`;
  const cached = filePreviewCache.get(cacheKey);
  const requestVersion = ++fileRequestVersion;
  if (cached) filePreview.value = cloneWorkspaceValue(cached);
  fileLoading.value = !cached;
  fileError.value = "";
  try {
    if (previewMode) {
      const fileParts = selectedFile.value.split(".");
      filePreview.value = {
        path: selectedFile.value,
        language: fileParts[fileParts.length - 1] ?? "text",
        content: Array.from(
          { length: 64 },
          (_, index) => `export const previewLine${index + 1}: string = "${index === 0 ? selectedFile.value : "Approved project content"}";`,
        ).join("\n"),
        truncated: false,
      };
      return;
    }
    const fileRoute = sessionId
      ? `/api/sessions/${sessionId}/file?path=${encodeURIComponent(path)}`
      : `/api/projects/${projectId}/file?path=${encodeURIComponent(path)}`;
    const response = await fetch(fileRoute);
    const result = await response.json() as WorkspaceFileContent & { error?: string };
    if (!response.ok) throw new Error(result.error ?? "The file could not be previewed.");
    filePreviewCache.set(cacheKey, cloneWorkspaceValue(result));
    if (requestVersion !== fileRequestVersion || project.value?.id !== projectId || session.value?.id !== sessionId || selectedFile.value !== path) return;
    filePreview.value = result;
  } catch (error) {
    if (requestVersion !== fileRequestVersion) return;
    if (!cached) filePreview.value = undefined;
    fileError.value = error instanceof Error ? error.message : "The file could not be refreshed.";
  } finally {
    if (requestVersion === fileRequestVersion) fileLoading.value = false;
  }
}

function useSuggestion(prompt: string, nextMode: SessionMode): void {
  composer.value = prompt;
  mode.value = nextMode;
}

function submitPrompt(event: Event): void {
  event.preventDefault();
  const detail = (event as CustomEvent<[string, OsxAgentComposerSubmission]>).detail;
  const submission = detail?.[1];
  const attachments = submissionAttachments(submission);
  const skillIds = submissionSkillIds(submission);
  const prompt = String(detail?.[0] ?? composer.value).trim()
    || (attachments.length ? "Review the attached project files." : skillIds.length ? "Apply the attached skills to this project." : "");
  if (!prompt || !project.value || !runtime.value) return;
  if (mode.value === "build" && !runtimeCanBuild.value) {
    taskError.value = "Choose a runtime that supports guarded isolated-workspace writes for Build mode.";
    return;
  }
  const submittedModelId = String(submission?.modelId ?? selectedModelId.value).trim();
  const prepared: PreparedPrompt = {
    prompt,
    attachments,
    skillIds,
    projectId: project.value.id,
    ...(session.value ? { sessionId: session.value.id } : {}),
    mode: mode.value,
    runtimeId: runtime.value.id,
    modelId: submittedModelId,
    ...(mode.value === "build" && buildNeedsNewWorktree.value && composerBranchSlug.value.trim()
      ? { branchSlug: composerBranchSlug.value.trim() }
      : {}),
    ...(sessionIsRunning.value ? { delivery: steeringDelivery.value } : {}),
  };
  if (attachments.some((item) => item.source === "imported")) {
    pendingAttachmentHandoff.value = prepared;
    return;
  }
  void sendPreparedPrompt(prepared);
}

function closeAttachmentHandoff(): void {
  pendingAttachmentHandoff.value = undefined;
}

function confirmAttachmentHandoff(): void {
  const prepared = pendingAttachmentHandoff.value;
  if (!prepared) return;
  pendingAttachmentHandoff.value = undefined;
  void sendPreparedPrompt(prepared);
}

async function sendPreparedPrompt(prepared: PreparedPrompt): Promise<void> {
  const importedIds = prepared.attachments.filter((item) => item.source === "imported").map((item) => item.id);
  const attachmentConsent = importedIds.length ? {
    attachmentIds: importedIds,
    runtimeId: prepared.runtimeId,
    ...(prepared.modelId ? { modelId: prepared.modelId } : {}),
    confirmed: true,
  } as const : undefined;
  submitting.value = true;
  taskError.value = "";
  try {
    let update: SessionMutationResponse;
    if (prepared.sessionId) {
      update = await post(`/api/sessions/${prepared.sessionId}/messages`, {
        prompt: prepared.prompt,
        mode: prepared.mode,
        runtimeId: prepared.runtimeId,
        modelId: prepared.modelId || null,
        ...(prepared.delivery ? { delivery: prepared.delivery } : {}),
        ...(prepared.branchSlug ? { branchSlug: prepared.branchSlug } : {}),
        ...(prepared.attachments.length ? { attachments: prepared.attachments } : {}),
        ...(prepared.skillIds.length ? { skillIds: prepared.skillIds } : {}),
        ...(attachmentConsent ? { attachmentConsent } : {}),
      }) as SessionMutationResponse;
    } else {
      update = await post("/api/sessions", {
        projectId: prepared.projectId,
        mode: prepared.mode,
        runtimeId: prepared.runtimeId,
        ...(prepared.modelId ? { modelId: prepared.modelId } : {}),
        prompt: prepared.prompt,
        ...(prepared.branchSlug ? { branchSlug: prepared.branchSlug } : {}),
        ...(prepared.attachments.length ? { attachments: prepared.attachments } : {}),
        ...(prepared.skillIds.length ? { skillIds: prepared.skillIds } : {}),
        ...(attachmentConsent ? { attachmentConsent } : {}),
      }) as SessionMutationResponse;
    }
    applySessionMutation(update);
    composer.value = "";
    composerBranchSlug.value = "";
    composerAttachments.value = [];
    composerContextItems.value = [];
    attachmentReferences.clear();
    await scrollTaskToBottom();
  } catch (error) {
    taskError.value = error instanceof Error ? error.message : "The task could not be saved.";
  } finally {
    submitting.value = false;
  }
}

function applySessionMutation(update: SessionMutationResponse): void {
  const { events, ...nextSession } = update;
  const previousSessionId = state.selectedSessionId;
  const sessionIndex = state.sessions.findIndex((item) => item.id === nextSession.id);
  if (sessionIndex >= 0) state.sessions[sessionIndex] = nextSession;
  else state.sessions.unshift(nextSession);
  state.selectedSessionId = nextSession.id;
  const knownEvents = new Set(state.events.map((item) => item.id));
  state.events.push(...events.filter((item) => !knownEvents.has(item.id)));
  mode.value = nextSession.mode;
  selectedRuntimeId.value = nextSession.runtimeId;
  selectedModelId.value = nextSession.modelId ?? "";
  serviceOnline.value = true;
  if (previousSessionId !== nextSession.id) {
    state.changes = [];
    state.approvals = [];
    state.approvalRules = [];
    state.terminalRuns = [];
    state.verificationRuns = [];
    delete state.browser;
    browserHostReady.value = false;
    browserHostLoading.value = false;
    browserCanGoBack.value = false;
    browserCanGoForward.value = false;
    browserAddressEditing.value = false;
    closeChangeDiff();
  }
  if (nextSession.worktree) void refreshWorkspaceEvidence(nextSession.id);
  scheduleRunPoll();
}

async function refreshWorkspaceEvidence(sessionId = session.value?.id): Promise<void> {
  if (!sessionId || previewMode) return;
  try {
    const response = await fetch(`/api/sessions/${sessionId}/workspace`);
    const result = await response.json() as WorkspaceEvidenceResponse & { error?: string };
    if (!response.ok) throw new Error(result.error ?? "Build evidence is unavailable.");
    if (session.value?.id !== sessionId) return;
    state.files = result.files;
    state.changes = result.changes;
    if (selectedFile.value && !state.files.some((file) => file.path === selectedFile.value)) closeFilePreview();
    if (selectedChange.value) {
      if (!state.changes.some((file) => file.path === selectedChange.value)) closeChangeDiff();
      else await loadChangeDiff();
    }
  } catch (error) {
    if (session.value?.id === sessionId) {
      taskError.value = error instanceof Error ? error.message : "Build evidence is unavailable.";
    }
  }
}

function applyLiveEvidence(update: SessionLiveEvidenceResponse): void {
  const knownApprovalIds = new Set(state.approvals.map((item) => item.id));
  const knownTerminalRunIds = new Set(state.terminalRuns.map((item) => item.id));
  const knownBrowserActionIds = new Set(state.browser?.actions.map((item) => item.id) ?? []);
  state.approvals = update.approvals;
  state.approvalRules = update.approvalRules ?? [];
  state.terminalRuns = update.terminalRuns;
  state.verificationRuns = update.verificationRuns ?? [];
  state.verificationHandoffs = update.verificationHandoffs ?? [];
  if (update.browser) {
    state.browser = update.browser;
    if (update.browser.url) syncBrowserAddress(update.browser.url);
  } else delete state.browser;

  const newApproval = update.approvals.find((item) => item.source === "agent" && item.state === "pending" && !knownApprovalIds.has(item.id));
  const newTerminalRun = update.terminalRuns.find((item) => !knownTerminalRunIds.has(item.id)
    && update.approvals.some((approval) => approval.id === item.approvalId && approval.source === "agent"));
  const newBrowserAction = update.browser?.actions.find((item) => item.actor === "agent" && !knownBrowserActionIds.has(item.id));
  if (newBrowserAction || newApproval?.capability === "browser") inspector.value = "browser";
  else if (newTerminalRun || newApproval?.capability === "command") inspector.value = "terminal";
}

async function refreshLiveEvidence(sessionId = session.value?.id): Promise<void> {
  if (!sessionId || previewMode || Number(state.contractVersion) < 2) return;
  const response = await fetch(`/api/sessions/${sessionId}/live-evidence`);
  const result = await response.json() as SessionLiveEvidenceResponse & { error?: string };
  if (!response.ok) throw new Error(result.error ?? "Live evidence is unavailable.");
  if (session.value?.id === sessionId) applyLiveEvidence(result);
}

async function ensureUserTerminal(force = false): Promise<void> {
  if (!session.value || terminalStarting.value || previewMode) return;
  if (!force && state.terminalRuns.some((run) => run.purpose === "user-shell" && (run.status === "pending" || run.status === "running"))) return;
  terminalStarting.value = true;
  terminalError.value = "";
  try {
    const result = await post(`/api/sessions/${session.value.id}/terminal-shell`, {}) as { run: TerminalRunSummary };
    const existingRun = state.terminalRuns.findIndex((run) => run.id === result.run.id);
    if (existingRun >= 0) state.terminalRuns[existingRun] = result.run;
    else state.terminalRuns.unshift(result.run);
    scheduleRunPoll(true);
  } catch (error) {
    terminalError.value = error instanceof Error ? error.message : "The terminal could not be opened.";
  } finally {
    terminalStarting.value = false;
  }
}

function upsertVerification(run: VerificationRunSummary): void {
  state.verificationRuns ??= [];
  const index = state.verificationRuns.findIndex((item) => item.id === run.id);
  if (index >= 0) state.verificationRuns[index] = run;
  else state.verificationRuns.unshift(run);
}

async function refreshProjectDoctor(): Promise<void> {
  if (!project.value || previewMode || verificationAction.value) return;
  verificationAction.value = "doctor";
  taskError.value = "";
  try {
    const response = await fetch(`/api/projects/${project.value.id}/doctor`);
    const result = await response.json() as ProjectDoctorSummary & { error?: string };
    if (!response.ok) throw new Error(result.error ?? "Project inspection failed.");
    state.projectDoctor = result;
  } catch (error) {
    taskError.value = error instanceof Error ? error.message : "Project inspection failed.";
  } finally {
    verificationAction.value = "";
  }
}

async function startVerification(handoffId = pendingVerificationHandoff.value?.id): Promise<void> {
  if (!session.value || verificationIsActive.value || !verificationHasRecipe.value) return;
  verificationAction.value = "start";
  taskError.value = "";
  try {
    const result = await post(`/api/sessions/${session.value.id}/verifications`, handoffId ? { handoffId } : {}) as {
      run: VerificationRunSummary;
      approval?: ApprovalSummary;
      handoff?: VerificationHandoffSummary;
    };
    upsertVerification(result.run);
    if (result.handoff) {
      state.verificationHandoffs ??= [];
      const index = state.verificationHandoffs.findIndex((item) => item.id === result.handoff!.id);
      if (index >= 0) state.verificationHandoffs[index] = result.handoff;
      else state.verificationHandoffs.unshift(result.handoff);
    }
    if (result.approval && !state.approvals.some((item) => item.id === result.approval!.id)) state.approvals.unshift(result.approval);
    inspector.value = "verify";
    scheduleRunPoll(true);
  } catch (error) {
    taskError.value = error instanceof Error ? error.message : "Verification could not be started.";
  } finally {
    verificationAction.value = "";
  }
}

async function dismissVerificationHandoff(): Promise<void> {
  const handoff = pendingVerificationHandoff.value;
  if (!handoff || verificationAction.value) return;
  verificationAction.value = "handoff";
  taskError.value = "";
  try {
    const result = await post(`/api/verification-handoffs/${handoff.id}/dismiss`, {}) as { handoff: VerificationHandoffSummary };
    const index = state.verificationHandoffs?.findIndex((item) => item.id === result.handoff.id) ?? -1;
    if (index >= 0 && state.verificationHandoffs) state.verificationHandoffs[index] = result.handoff;
  } catch (error) {
    taskError.value = error instanceof Error ? error.message : "The verification handoff could not be dismissed.";
  } finally {
    verificationAction.value = "";
  }
}

async function stopVerification(): Promise<void> {
  const run = latestVerification.value;
  if (!run || !verificationCanStop.value || verificationAction.value) return;
  verificationAction.value = "stop";
  taskError.value = "";
  try {
    const result = await post(`/api/verifications/${run.id}/stop`, {}) as { run: VerificationRunSummary };
    upsertVerification(result.run);
    await refreshLiveEvidence(run.sessionId);
  } catch (error) {
    taskError.value = error instanceof Error ? error.message : "Verification could not be stopped.";
  } finally {
    verificationAction.value = "";
  }
}

async function rerunVerification(): Promise<void> {
  const source = latestVerification.value;
  if (!session.value || !source || !verificationCanRerun.value || verificationAction.value) return;
  verificationAction.value = "rerun";
  taskError.value = "";
  try {
    const result = await post(`/api/verifications/${source.id}/rerun`, {}) as { run: VerificationRunSummary; approval?: ApprovalSummary };
    upsertVerification(result.run);
    if (result.approval && !state.approvals.some((item) => item.id === result.approval!.id)) state.approvals.unshift(result.approval);
    inspector.value = "verify";
    scheduleRunPoll(true);
  } catch (error) {
    taskError.value = error instanceof Error ? error.message : "The retained verification recipe could not be rerun.";
  } finally {
    verificationAction.value = "";
  }
}

async function captureVerificationBrowser(): Promise<void> {
  const run = latestVerification.value;
  if (!run || run.state !== "needs-browser" || verificationAction.value) return;
  verificationAction.value = "browser";
  browserError.value = "";
  try {
    const result = await post(`/api/verifications/${run.id}/browser`, {}) as { run: VerificationRunSummary; browser: BrowserSessionSummary };
    upsertVerification(result.run);
    state.browser = result.browser;
    scheduleRunPoll(true);
  } catch (error) {
    browserError.value = error instanceof Error ? error.message : "Browser proof could not be captured.";
  } finally {
    verificationAction.value = "";
  }
}

async function openVerificationBrowser(): Promise<void> {
  inspector.value = "browser";
  const target = verificationBrowserTarget.value;
  if (!target || browserMatchesVerificationTarget.value) return;
  browserUrl.value = target;
  await requestBrowserAction("navigate");
}

async function decideApproval(
  approval: ApprovalSummary,
  decision: "approve" | "deny",
  duration: ApprovalDuration = "once",
): Promise<void> {
  if (approvalActionId.value) return;
  const index = state.approvals.findIndex((item) => item.id === approval.id);
  const previous = index >= 0 ? cloneWorkspaceValue(state.approvals[index]!) : undefined;
  approvalActionId.value = approval.id;
  if (index >= 0) state.approvals[index] = {
    ...state.approvals[index]!,
    state: decision === "approve" ? "approved" : "denied",
  };
  try {
    const result = await post(`/api/approvals/${approval.id}/decision`, { decision, duration }) as { approval?: ApprovalSummary };
    if (result.approval && index >= 0) state.approvals[index] = result.approval;
    void refreshLiveEvidence(approval.sessionId).catch(() => undefined);
    scheduleRunPoll(true);
  } catch (error) {
    if (previous && index >= 0) state.approvals[index] = previous;
    taskError.value = error instanceof Error ? error.message : "The approval decision could not be saved.";
  } finally {
    approvalActionId.value = "";
  }
}

function toggleSelectedHunk(id: string, checked: boolean): void {
  const next = new Set(selectedHunkIds.value);
  if (checked) next.add(id);
  else next.delete(id);
  selectedHunkIds.value = [...next];
}

function updateSelectedHunk(id: string, event: Event): void {
  toggleSelectedHunk(id, (event.target as HTMLInputElement).checked);
}

function selectAllAvailableHunks(): void {
  selectedHunkIds.value = availableChangeHunks.value.map((hunk) => hunk.id);
}

async function requestApplySelectedHunks(): Promise<void> {
  if (!selectedChange.value || !selectedHunkIds.value.length) return;
  await requestApplyChanges(undefined, [{ path: selectedChange.value, hunkIds: [...selectedHunkIds.value] }]);
}

async function requestApplyChanges(paths?: string[], hunks?: Array<{ path: string; hunkIds: string[] }>): Promise<void> {
  if (!session.value?.worktree || !["active", "conflicted"].includes(session.value.worktree.status)
    || !changedFiles.value.length || worktreeApplyPending.value) return;
  taskError.value = "";
  try {
    const result = await post(`/api/sessions/${session.value.id}/worktree/apply`, {
      ...(paths ? { paths } : {}),
      ...(hunks ? { hunks } : {}),
    }) as { approval: ApprovalSummary };
    state.approvals.unshift(result.approval);
    scheduleRunPoll();
  } catch (error) {
    taskError.value = error instanceof Error ? error.message : "The Build changes could not be prepared for approval.";
  }
}

async function requestWorktreeAction(action: "archive" | "restore" | "revert" | "cleanup"): Promise<void> {
  if (!session.value?.worktree || approvalActionId.value) return;
  approvalActionId.value = `worktree-${action}`;
  taskError.value = "";
  try {
    const result = await post(`/api/sessions/${session.value.id}/worktree/${action}`, {}) as {
      approval?: ApprovalSummary;
      session?: SessionSummary;
    };
    if (result.approval) {
      state.approvals.unshift(result.approval);
      scheduleRunPoll(true);
    }
    if (result.session) {
      const index = state.sessions.findIndex((item) => item.id === result.session!.id);
      if (index >= 0) state.sessions[index] = result.session;
      await refreshWorkspaceEvidence(result.session.id);
    }
  } catch (error) {
    taskError.value = error instanceof Error ? error.message : "The worktree action could not be completed.";
  } finally {
    approvalActionId.value = "";
  }
}

async function refreshPermissionRules(): Promise<void> {
  if (previewMode || permissionLoading.value) return;
  permissionLoading.value = true;
  permissionError.value = "";
  try {
    const response = await fetch("/api/approval-rules");
    const result = await response.json() as { rules?: ApprovalRuleSummary[]; error?: string };
    if (!response.ok) throw new Error(result.error ?? "Remembered access could not be loaded.");
    permissionRules.value = result.rules ?? [];
  } catch (error) {
    permissionError.value = error instanceof Error ? error.message : "Remembered access could not be loaded.";
  } finally {
    permissionLoading.value = false;
  }
}

async function revokePermissionRule(id: string): Promise<void> {
  if (permissionActionId.value) return;
  permissionActionId.value = id;
  permissionError.value = "";
  permissionNotice.value = "";
  try {
    const response = await fetch(`/api/approval-rules/${id}`, { method: "DELETE" });
    const result = await response.json() as { error?: string };
    if (!response.ok) throw new Error(result.error ?? "The remembered approval could not be revoked.");
    permissionRules.value = permissionRules.value.filter((item) => item.id !== id);
    state.approvalRules = approvalRules.value.filter((item) => item.id !== id);
    permissionNotice.value = "The next matching action will ask for approval again.";
  } catch (error) {
    permissionError.value = error instanceof Error ? error.message : "The remembered approval could not be revoked.";
  } finally {
    permissionActionId.value = "";
  }
}

async function exportPermissionAudit(): Promise<void> {
  if (permissionExporting.value) return;
  permissionExporting.value = true;
  permissionError.value = "";
  try {
    const response = await fetch("/api/approval-rules/audit");
    if (!response.ok) {
      const result = await response.json().catch(() => ({})) as { error?: string };
      throw new Error(result.error ?? "The access audit could not be generated.");
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `vraxis-code-approval-policy-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    permissionNotice.value = "The approval policy audit was downloaded.";
  } catch (error) {
    permissionError.value = error instanceof Error ? error.message : "The access audit could not be generated.";
  } finally {
    permissionExporting.value = false;
  }
}

async function refreshTeamPolicy(): Promise<void> {
  if (previewMode || teamPolicyBusy.value) return;
  teamPolicyBusy.value = true;
  teamPolicyError.value = "";
  try {
    const response = await fetch("/api/team-policy");
    const result = await response.json() as TeamPolicyState & { error?: string };
    if (!response.ok) throw new Error(result.error ?? "Team policy could not be loaded.");
    teamPolicy.value = result;
  } catch (error) {
    teamPolicyError.value = error instanceof Error ? error.message : "Team policy could not be loaded.";
  } finally {
    teamPolicyBusy.value = false;
  }
}

async function createTeamPolicy(request: TeamPolicyCreateRequest): Promise<void> {
  if (teamPolicyBusy.value) return;
  teamPolicyBusy.value = true;
  teamPolicyError.value = "";
  teamPolicyNotice.value = "";
  try {
    const response = await fetch("/api/team-policy/sign", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });
    if (!response.ok) {
      const result = await response.json().catch(() => ({})) as { error?: string };
      throw new Error(result.error ?? "The signed team policy could not be created.");
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `vraxis-team-policy-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    teamPolicyNotice.value = "The signed policy pack was downloaded. Share it with installations that trust this proof identity.";
  } catch (error) {
    teamPolicyError.value = error instanceof Error ? error.message : "The signed team policy could not be created.";
  } finally {
    teamPolicyBusy.value = false;
  }
}

async function importTeamPolicy(bundle: TeamPolicyBundleV1): Promise<void> {
  if (teamPolicyBusy.value) return;
  teamPolicyBusy.value = true;
  teamPolicyError.value = "";
  teamPolicyNotice.value = "";
  try {
    const response = await fetch("/api/team-policy", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(bundle),
    });
    const result = await response.json() as TeamPolicyState & { error?: string };
    if (!response.ok) throw new Error(result.error ?? "The signed team policy could not be imported.");
    teamPolicy.value = result;
    teamPolicyNotice.value = "The signed team policy is active.";
  } catch (error) {
    teamPolicyError.value = error instanceof Error ? error.message : "The signed team policy could not be imported.";
  } finally {
    teamPolicyBusy.value = false;
  }
}

async function removeTeamPolicy(): Promise<void> {
  if (teamPolicyBusy.value) return;
  teamPolicyBusy.value = true;
  teamPolicyError.value = "";
  teamPolicyNotice.value = "";
  try {
    const response = await fetch("/api/team-policy", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirmed: true }),
    });
    const result = await response.json() as TeamPolicyState & { error?: string };
    if (!response.ok) throw new Error(result.error ?? "The team policy could not be removed.");
    teamPolicy.value = result;
    teamPolicyNotice.value = "The team policy was removed. Local approval decisions apply again.";
  } catch (error) {
    teamPolicyError.value = error instanceof Error ? error.message : "The team policy could not be removed.";
  } finally {
    teamPolicyBusy.value = false;
  }
}

async function requestBrowserAction(
  action: BrowserActionRequest["action"],
  options: { target?: string; tabId?: string } = {},
): Promise<void> {
  if (!session.value) return;
  browserError.value = "";
  if (action === "navigate" && !browserUrl.value.trim()) {
    browserError.value = "Enter a URL to open.";
    return;
  }
  const control = selectedBrowserControl.value;
  if ((action === "click" || action === "type") && !control && !options.target) {
    browserError.value = "Choose a numbered page control first.";
    return;
  }
  if (action === "type" && !browserText.value) {
    browserError.value = "Enter the text to type.";
    return;
  }
  const payload = {
    sessionId: session.value.id,
    action,
    ...(action === "navigate" ? { target: browserUrl.value.trim() } : {}),
    ...((action === "click" || action === "type") ? { target: options.target ?? control?.ref } : {}),
    ...(action === "type" ? { value: browserText.value } : {}),
    ...(options.tabId ? { tabId: options.tabId } : {}),
  };
  browserActionPending.value = action;
  try {
    const result = await post("/api/browser/actions", payload) as { approval?: ApprovalSummary; browser?: BrowserSessionSummary };
    if (result.approval) state.approvals.unshift(result.approval);
    if (result.browser) {
      state.browser = result.browser;
      syncBrowserAddress(result.browser.url);
    }
    if (["type", "click", "navigate", "reload", "back", "forward", "select-tab", "close-tab"].includes(action)) {
      browserText.value = "";
      selectedBrowserControlRef.value = "";
    }
    scheduleRunPoll();
  } catch (error) {
    browserError.value = error instanceof Error ? error.message : "The browser action could not be created.";
  } finally {
    browserActionPending.value = "";
  }
}

async function interruptTerminal(run: TerminalRunSummary): Promise<void> {
  const index = state.terminalRuns.findIndex((item) => item.id === run.id);
  const previous = index >= 0 ? cloneWorkspaceValue(state.terminalRuns[index]!) : undefined;
  if (index >= 0) state.terminalRuns[index] = { ...state.terminalRuns[index]!, status: "interrupted" };
  try {
    await post(`/api/terminal/${run.id}/interrupt`, {});
    void refreshLiveEvidence(run.sessionId).catch(() => undefined);
  } catch (error) {
    if (previous && index >= 0) state.terminalRuns[index] = previous;
    terminalError.value = error instanceof Error ? error.message : "The command could not be stopped.";
  }
}

function sendTerminalData(run: TerminalRunSummary, data: string): void {
  if (run.status !== "running" || !data) return;
  const previous = terminalInputWrites.get(run.id) ?? Promise.resolve();
  const write = previous.then(async () => {
    await post(`/api/terminal/${run.id}/input`, { data });
    scheduleRunPoll(true);
  }).catch((error: unknown) => {
    terminalError.value = error instanceof Error ? error.message : "Terminal input could not be sent.";
  });
  terminalInputWrites.set(run.id, write);
  void write.finally(() => {
    if (terminalInputWrites.get(run.id) === write) terminalInputWrites.delete(run.id);
  });
}

async function resizeTerminal(run: TerminalRunSummary, columns: number, rows: number): Promise<void> {
  if (run.status !== "running") return;
  try {
    const result = await post(`/api/terminal/${run.id}/resize`, { columns, rows }) as { run: TerminalRunSummary };
    const index = state.terminalRuns.findIndex((item) => item.id === result.run.id);
    if (index >= 0) state.terminalRuns[index] = result.run;
  } catch {
    // A resize may race with process exit. The next evidence refresh owns the final state.
  }
}

async function exportTaskReceipt(format: "html" | "json"): Promise<void> {
  if (!session.value || receiptExporting.value) return;
  receiptExporting.value = format;
  taskError.value = "";
  try {
    const response = await fetch(`/api/sessions/${session.value.id}/${format === "html" ? "receipt.html" : "proof.json"}`);
    if (!response.ok) {
      const failure = await response.json().catch(() => ({})) as { error?: string };
      throw new Error(failure.error ?? "The task receipt could not be generated.");
    }
    const blob = format === "html"
      ? await response.blob()
      : new Blob([`${JSON.stringify(await response.json() as TaskProofEnvelopeV1, null, 2)}\n`], { type: "application/vnd.vraxis.task-proof+json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${project.value?.name ?? "vraxis"}-${session.value.id.slice(0, 8)}-${format === "html" ? "proof.html" : "proof.json"}`;
    link.click();
    URL.revokeObjectURL(url);
  } catch (error) {
    taskError.value = error instanceof Error ? error.message : "The task receipt could not be generated.";
  } finally {
    receiptExporting.value = "";
  }
}

async function exportBrowserReplay(): Promise<void> {
  if (!session.value || browserReplayExporting.value) return;
  browserReplayExporting.value = true;
  browserError.value = "";
  try {
    const response = await fetch(`/api/sessions/${session.value.id}/browser-replay.html`);
    if (!response.ok) {
      const failure = await response.json().catch(() => ({})) as { error?: string };
      throw new Error(failure.error ?? "The browser replay could not be generated.");
    }
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement("a");
    link.href = url;
    link.download = `${project.value?.name ?? "vraxis"}-${session.value.id.slice(0, 8)}-browser-replay.html`;
    link.click();
    URL.revokeObjectURL(url);
  } catch (error) {
    browserError.value = error instanceof Error ? error.message : "The browser replay could not be generated.";
  } finally {
    browserReplayExporting.value = false;
  }
}

async function interruptRun(): Promise<void> {
  if (!session.value || !sessionIsRunning.value) return;
  const sessionId = session.value.id;
  const index = state.sessions.findIndex((item) => item.id === sessionId);
  const previous = index >= 0 ? cloneWorkspaceValue(state.sessions[index]!) : undefined;
  taskError.value = "";
  if (index >= 0) state.sessions[index] = { ...state.sessions[index]!, status: "interrupted", updatedAt: new Date().toISOString() };
  try {
    await post(`/api/sessions/${sessionId}/interrupt`, {});
    void loadState({ blocking: false });
  } catch (error) {
    if (previous && index >= 0) state.sessions[index] = previous;
    taskError.value = error instanceof Error ? error.message : "The task could not be stopped.";
  }
}

async function resumeRun(): Promise<void> {
  if (!session.value || sessionIsRunning.value) return;
  const sessionId = session.value.id;
  const index = state.sessions.findIndex((item) => item.id === sessionId);
  const previous = index >= 0 ? cloneWorkspaceValue(state.sessions[index]!) : undefined;
  submitting.value = true;
  taskError.value = "";
  if (index >= 0) state.sessions[index] = { ...state.sessions[index]!, status: "running", updatedAt: new Date().toISOString() };
  try {
    await post(`/api/sessions/${sessionId}/resume`, {});
    scheduleRunPoll(true);
    void loadState({ blocking: false });
  } catch (error) {
    if (previous && index >= 0) state.sessions[index] = previous;
    taskError.value = error instanceof Error ? error.message : "The task could not be resumed.";
  } finally {
    submitting.value = false;
  }
}

function clearRunPoll(): void {
  if (runPollTimer) clearTimeout(runPollTimer);
  runPollTimer = undefined;
}

function closeTaskStream(): void {
  taskStream?.close();
  taskStream = undefined;
  taskStreamSessionId = "";
  taskStreamConnected = false;
}

async function applyTaskStreamPayload(update: SessionStreamPayload): Promise<void> {
  if (session.value?.id !== update.session.id) return;
  const followNewestActivity = taskPaneIsNearBottom();
  const sessionIndex = state.sessions.findIndex((item) => item.id === update.session.id);
  const wasRunning = sessionIndex >= 0 && state.sessions[sessionIndex]?.status === "running";
  if (sessionIndex >= 0) state.sessions[sessionIndex] = update.session;
  else state.sessions.unshift(update.session);

  let activityChanged = false;
  for (const event of update.events) {
    const eventIndex = state.events.findIndex((item) => item.id === event.id);
    if (eventIndex < 0) {
      state.events.push(event);
      activityChanged = true;
    } else if (JSON.stringify(state.events[eventIndex]) !== JSON.stringify(event)) {
      state.events[eventIndex] = event;
      activityChanged = true;
    }
  }
  applyLiveEvidence(update.evidence);
  serviceOnline.value = true;
  cacheCurrentWorkspace();
  if (followNewestActivity && activityChanged) await scrollTaskToBottom();
  if (wasRunning && update.session.status !== "running" && update.session.worktree) {
    await refreshWorkspaceEvidence(update.session.id);
  }
}

function connectTaskStream(): void {
  const sessionId = session.value?.id;
  if (previewMode || !state.realtime?.sessionEvents || !sessionId) {
    closeTaskStream();
    scheduleRunPoll();
    return;
  }
  if (taskStream && taskStreamSessionId === sessionId) return;
  closeTaskStream();
  taskStreamSessionId = sessionId;
  const source = new EventSource(`/api/sessions/${encodeURIComponent(sessionId)}/stream`);
  taskStream = source;
  const receive = (message: Event) => {
    if (taskStream !== source) return;
    const update = JSON.parse((message as MessageEvent<string>).data) as SessionStreamPayload;
    void applyTaskStreamPayload(update);
  };
  source.addEventListener("snapshot", receive);
  source.addEventListener("update", receive);
  source.addEventListener("refresh", () => {
    if (taskStream === source) scheduleRunPoll(true);
  });
  source.onopen = () => {
    if (taskStream !== source) return;
    taskStreamConnected = true;
    serviceOnline.value = true;
    clearRunPoll();
  };
  source.onerror = () => {
    if (taskStream !== source) return;
    taskStreamConnected = false;
    scheduleRunPoll(true);
  };
}

function scheduleRunPoll(force = false): void {
  clearRunPoll();
  if (!force && taskStreamConnected) return;
  if (previewMode || !session.value || (!force && session.value.status !== "running" && !liveEvidenceActive.value)) return;
  runPollTimer = setTimeout(() => void pollRun(), 500);
}

async function pollRun(): Promise<void> {
  if (!session.value) return;
  const sessionId = session.value.id;
  const steeringCanChangeExistingEvents = sessionEvents.value.some((event) => event.steering?.state === "queued" || event.steering?.state === "running");
  const lastSequence = steeringCanChangeExistingEvents ? 0 : sessionEvents.value[sessionEvents.value.length - 1]?.sequence ?? 0;
  try {
    const response = await fetch(`/api/sessions/${sessionId}/events?after=${lastSequence}`);
    if (!response.ok) throw new Error("Run updates are unavailable.");
    const update = await response.json() as SessionEventsResponse;
    const followNewestActivity = taskPaneIsNearBottom();
    const sessionIndex = state.sessions.findIndex((item) => item.id === sessionId);
    const wasRunning = sessionIndex >= 0 && state.sessions[sessionIndex]?.status === "running";
    if (sessionIndex >= 0) state.sessions[sessionIndex] = update.session;
    let activityChanged = false;
    for (const event of update.events) {
      const eventIndex = state.events.findIndex((item) => item.id === event.id);
      if (eventIndex < 0) {
        state.events.push(event);
        activityChanged = true;
      } else if (JSON.stringify(state.events[eventIndex]) !== JSON.stringify(event)) {
        state.events[eventIndex] = event;
        activityChanged = true;
      }
    }
    if (followNewestActivity && activityChanged) await scrollTaskToBottom();
    await refreshLiveEvidence(sessionId);
    serviceOnline.value = true;
    if (wasRunning && update.session.status !== "running" && update.session.worktree) {
      await refreshWorkspaceEvidence(sessionId);
    }
  } catch {
    serviceOnline.value = false;
  } finally {
    scheduleRunPoll();
  }
}

async function post(path: string, payload: unknown): Promise<unknown> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const result = await response.json() as { error?: string };
  if (!response.ok) throw new Error(result.error ?? "The request failed.");
  return result;
}

async function openProjectPicker(): Promise<void> {
  registrationError.value = "";
  registering.value = true;
  try {
    const result = await chooseProjectFolder<ProjectSummary>(
      window.vraxisDesktop?.chooseDirectory
        ? { chooseDirectory: () => window.vraxisDesktop!.chooseDirectory!() }
        : undefined,
      async (path) => post("/api/projects", { path }) as Promise<ProjectSummary>,
      async () => {
        const selection = await post("/api/projects/pick-folder", {}) as {
          cancelled: boolean;
          project?: ProjectSummary;
        };
        return selection.cancelled ? null : selection.project ?? null;
      },
    );
    if (!result) return;
    if (!state.projects.some((item) => item.id === result.id)) state.projects.push(result);
    state.selectedProjectId = result.id;
    activeView.value = "workspace";
    await loadState();
  } catch (error) {
    registrationError.value = error instanceof Error ? error.message : "The project chooser could not open.";
  } finally {
    registering.value = false;
  }
}

function openSettings(): void {
  settingsError.value = "";
  runtimeActionNotice.value = "";
  activeView.value = "settings";
  void refreshPermissionRules();
  void refreshTeamPolicy();
}

async function openHarnessSetup(): Promise<void> {
  openSettings();
  await nextTick();
  document.getElementById("harness-settings-heading")?.scrollIntoView({ block: "start" });
}

async function handleFirstRunAction(action: FirstRunActionId): Promise<void> {
  if (firstRunBusy.value) return;
  if (action === "setup-runtime") {
    await openHarnessSetup();
    return;
  }
  if (action === "verify-runtime") {
    if (runtime.value) await probeRuntime(runtime.value);
    return;
  }
  if (action === "choose-project") {
    await openProjectPicker();
    return;
  }
  if (action === "inspect-project") {
    await refreshProjectDoctor();
    return;
  }
  if (action === "draft-task") {
    useSuggestion("Inspect this project and explain its architecture with file-backed evidence.", "ask");
    await nextTick();
    document.querySelector<HTMLElement>("osx-agent-composer")?.focus();
    return;
  }
  if (action === "review-verification") {
    inspector.value = "verify";
    return;
  }
  await exportTaskReceipt("json");
}

function closeSettings(): void {
  activeView.value = "workspace";
}

async function updateSettings(patch: UpdateSettingsRequest): Promise<void> {
  if (settingsSaving.value) return;
  const previous: UserSettings = {
    ...state.settings,
    ...(state.settings.runtimeModels ? { runtimeModels: { ...state.settings.runtimeModels } } : {}),
    ...(state.settings.disabledRuntimeIds ? { disabledRuntimeIds: [...state.settings.disabledRuntimeIds] } : {}),
  };
  if (patch.theme) state.settings.theme = patch.theme;
  if (patch.defaultMode) state.settings.defaultMode = patch.defaultMode;
  if (patch.authorityMode) state.settings.authorityMode = patch.authorityMode;
  if (patch.defaultRuntimeId === null) delete state.settings.defaultRuntimeId;
  else if (patch.defaultRuntimeId) state.settings.defaultRuntimeId = patch.defaultRuntimeId;
  if (patch.runtimeModels) {
    const runtimeModels = { ...(state.settings.runtimeModels ?? {}) };
    for (const [runtimeId, nextModelId] of Object.entries(patch.runtimeModels)) {
      if (nextModelId) runtimeModels[runtimeId] = nextModelId;
      else delete runtimeModels[runtimeId];
    }
    if (Object.keys(runtimeModels).length) state.settings.runtimeModels = runtimeModels;
    else delete state.settings.runtimeModels;
  }
  if (patch.disabledRuntimeIds) {
    if (patch.disabledRuntimeIds.length) state.settings.disabledRuntimeIds = [...patch.disabledRuntimeIds];
    else delete state.settings.disabledRuntimeIds;
  }
  settingsSaving.value = true;
  settingsError.value = "";
  try {
    const saved = await post("/api/settings", patch) as UserSettings;
    state.settings = saved;
    if (patch.defaultMode && !session.value) mode.value = saved.defaultMode;
    if (!session.value && (patch.defaultRuntimeId !== undefined || patch.runtimeModels)) syncTaskSelection();
  } catch (error) {
    state.settings = previous;
    settingsError.value = error instanceof Error ? error.message : "Settings could not be saved.";
  } finally {
    settingsSaving.value = false;
  }
}

function chooseTheme(event: Event): void {
  const theme = String(eventValue(event));
  if (appThemes.includes(theme as AppTheme)) void updateSettings({ theme: theme as AppTheme });
}

async function refreshRuntimes(): Promise<void> {
  if (runtimeRefreshing.value) return;
  runtimeRefreshing.value = true;
  settingsError.value = "";
  try {
    const result = await post("/api/runtimes/refresh", {}) as { runtimes: RuntimeSummary[] };
    state.runtimes = [...result.runtimes, ...state.runtimes.filter((item) => item.kind === "hosted-provider")];
    syncTaskSelection();
  } catch (error) {
    settingsError.value = error instanceof Error ? error.message : "Harnesses could not be checked.";
  } finally {
    runtimeRefreshing.value = false;
  }
}

async function probeRuntime(runtime: RuntimeSummary): Promise<void> {
  if (runtimeProbingId.value || runtime.availability !== "installed") return;
  runtimeProbingId.value = runtime.id;
  settingsError.value = "";
  runtimeActionNotice.value = "";
  try {
    const result = await post(`/api/runtimes/${encodeURIComponent(runtime.id)}/probe`, {
      consent: true,
      ...(state.settings.runtimeModels?.[runtime.id] ? { modelId: state.settings.runtimeModels[runtime.id] } : {}),
    }) as { runtimeId: string; conformance: NonNullable<RuntimeSummary["conformance"]> };
    const index = state.runtimes.findIndex((item) => item.id === result.runtimeId);
    if (index >= 0) state.runtimes[index] = { ...state.runtimes[index]!, conformance: result.conformance };
    runtimeActionNotice.value = result.conformance.state === "ready"
      ? `${runtime.name} passed the live Vraxis conformance probe.`
      : `${runtime.name} completed with ${result.conformance.state} capability. Review the checks before using it.`;
  } catch (error) {
    settingsError.value = error instanceof Error ? error.message : "The bounded runtime probe could not finish.";
  } finally {
    runtimeProbingId.value = "";
  }
}

const runtimeDocumentationHosts = new Set(["developers.openai.com", "docs.anthropic.com", "docs.cursor.com", "opencode.ai"]);

function terminalArgument(value: string): string {
  return /^[a-zA-Z0-9_./:@%+=,-]+$/.test(value) ? value : `'${value.replace(/'/g, "'\\''")}'`;
}

async function maintainRuntime(runtime: RuntimeSummary, action: RuntimeMaintenanceActionSummary): Promise<void> {
  settingsError.value = "";
  runtimeActionNotice.value = "";
  if (action.kind === "documentation") {
    try {
      const url = new URL(action.url ?? "");
      if (url.protocol !== "https:" || !runtimeDocumentationHosts.has(url.hostname)) throw new TypeError("Unsupported harness documentation URL.");
      window.open(url.href, "_blank", "noopener,noreferrer");
      runtimeActionNotice.value = `Opened the official ${runtime.name} setup guide. Return here and check again after installation.`;
    } catch (error) {
      settingsError.value = error instanceof Error ? error.message : "The setup guide could not be opened.";
    }
    return;
  }
  if (!action.executable) {
    settingsError.value = "This harness did not provide a safe executable for the action.";
    return;
  }
  const command = [action.executable, ...(action.arguments ?? [])].map(terminalArgument).join(" ");
  if (!project.value) {
    try {
      await navigator.clipboard.writeText(command);
      runtimeActionNotice.value = `${action.label} was copied. Open a project, then run it from the governed terminal.`;
    } catch {
      settingsError.value = "Choose a project before running this harness action.";
    }
    return;
  }
  try {
    const result = await post(`/api/runtimes/${encodeURIComponent(runtime.id)}/maintenance`, {
      projectId: project.value.id,
      actionId: action.id,
    }) as SessionMutationResponse & { approval: ApprovalSummary; run: TerminalRunSummary };
    applySessionMutation(result);
    state.approvals.unshift(result.approval);
    state.terminalRuns.unshift(result.run);
    activeView.value = "workspace";
    inspector.value = "terminal";
    scheduleRunPoll(true);
    runtimeActionNotice.value = `${action.label} is ready for approval in the terminal.`;
  } catch (error) {
    settingsError.value = error instanceof Error ? error.message : "Runtime maintenance could not be prepared.";
  }
}

async function providerConnected(providerId: string): Promise<void> {
  await loadState();
  const connectedRuntime = state.runtimes.find((item) => item.providerProfileId === providerId);
  const provider = state.modelProviders.find((item) => item.id === providerId);
  if (!connectedRuntime || !provider) return;
  await updateSettings({
    defaultRuntimeId: connectedRuntime.id,
    runtimeModels: { [connectedRuntime.id]: provider.model },
  });
}

async function providersChanged(): Promise<void> {
  await loadState();
}

async function mcpServersChanged(): Promise<void> {
  await loadState();
}

function eventStatus(event: ActivityEvent): "complete" | "streaming" | "error" {
  if (event.state === "failed") return "error";
  if (event.state === "running" || event.state === "pending") return "streaming";
  return "complete";
}

function toolActivityStatus(event: ActivityEvent): "queued" | "running" | "success" | "error" {
  if (event.sequence === activeToolSequence.value) return "running";
  if (event.state === "pending") return "queued";
  if (event.state === "running") return "running";
  if (event.state === "complete") return "success";
  return "error";
}

function eventIcon(event: ActivityEvent): "warning" | "stop" | "loader" | "check" {
  if (event.state === "failed") return "warning";
  if (event.state === "interrupted") return "stop";
  if (event.state === "running") return "loader";
  return "check";
}

function progressStatus(event: ActivityEvent): "complete" | "streaming" | "error" {
  if (event.state === "failed") return "error";
  if (event.state === "running" && session.value?.status === "running") return "streaming";
  return "complete";
}

function parseEvidenceFocus(url: URL): { kind: TaskEvidenceKindV1; target: string } | undefined {
  const kind = url.searchParams.get("evidence");
  const target = url.searchParams.get("target");
  if (!kind && !target) return undefined;
  if (!kind || !target || !["change", "terminal", "approval", "browser"].includes(kind)) {
    throw new TypeError("The evidence link is invalid.");
  }
  if (target.length > 2_048 || target.includes("\0")) throw new TypeError("The evidence target is invalid.");
  return { kind: kind as TaskEvidenceKindV1, target };
}

function evidenceDomId(kind: TaskEvidenceKindV1, target: string): string {
  return `evidence-${kind}-${encodeURIComponent(target)}`;
}

async function focusLinkedEvidence(focus: { kind: TaskEvidenceKindV1; target: string }): Promise<void> {
  selectedTerminalRunId.value = "";
  selectedBrowserActionId.value = "";
  if (focus.kind === "change") {
    if (!state.changes.some((item) => item.path === focus.target)) throw new TypeError("The linked change is no longer available in this task.");
    inspector.value = "changes";
    selectedChange.value = focus.target;
    await loadChangeDiff();
  } else if (focus.kind === "terminal") {
    if (!state.terminalRuns.some((item) => item.id === focus.target)) throw new TypeError("The linked command is no longer available in this task.");
    inspector.value = "terminal";
    selectedTerminalRunId.value = focus.target;
  } else if (focus.kind === "approval") {
    if (!state.approvals.some((item) => item.id === focus.target)) throw new TypeError("The linked authority decision is no longer available in this task.");
  } else {
    if (!state.browser?.actions.some((item) => item.id === focus.target)) throw new TypeError("The linked browser action is no longer available in this task.");
    inspector.value = "browser";
    selectedBrowserActionId.value = focus.target;
  }
  focusedEvidence.value = focus;
  await nextTick();
  document.getElementById(evidenceDomId(focus.kind, focus.target))?.scrollIntoView({ block: "center" });
}

function clearEvidenceFocus(): void {
  focusedEvidence.value = undefined;
  selectedTerminalRunId.value = "";
}

async function syncDesktopBrowserLayout(): Promise<void> {
  const bridge = window.vraxisDesktop?.browserView;
  if (!bridge) return;
  await nextTick();
  const sessionId = session.value?.id ?? lastBrowserLayoutSessionId;
  if (!sessionId) return;
  const surface = browserLiveSurface.value;
  const visible = desktopBrowserVisible.value && Boolean(surface);
  if (!visible) {
    await bridge.setLayout({ sessionId, visible: false, bounds: { x: 0, y: 0, width: 1, height: 1 } }).catch(() => undefined);
    return;
  }
  const bounds = surface!.getBoundingClientRect();
  if (bounds.width < 1 || bounds.height < 1) return;
  lastBrowserLayoutSessionId = sessionId;
  await bridge.setLayout({
    sessionId,
    visible: true,
    bounds: {
      x: Math.max(0, Math.round(bounds.x)),
      y: Math.max(0, Math.round(bounds.y)),
      width: Math.max(1, Math.round(bounds.width)),
      height: Math.max(1, Math.round(bounds.height)),
    },
  }).catch(() => undefined);
}

function scheduleBrowserEvidenceRefresh(sessionId: string, delay = 140): void {
  if (browserEvidenceTimer) clearTimeout(browserEvidenceTimer);
  browserEvidenceTimer = setTimeout(() => {
    browserEvidenceTimer = undefined;
    if (session.value?.id === sessionId) void refreshLiveEvidence(sessionId).catch(() => undefined);
  }, delay);
}

function observeDesktopBrowserSurface(): void {
  browserResizeObserver?.disconnect();
  browserResizeObserver = undefined;
  if (!desktopBrowserAvailable || !browserLiveSurface.value) return;
  browserResizeObserver = new ResizeObserver(() => void syncDesktopBrowserLayout());
  browserResizeObserver.observe(browserLiveSurface.value);
}

async function loadInitialState(): Promise<void> {
  const requestedUrl = new URL(window.location.href);
  const requestedTask = requestedUrl.searchParams.get("task")?.trim();
  let deepLinkError = "";
  let evidenceFocus: { kind: TaskEvidenceKindV1; target: string } | undefined;
  if (requestedTask) {
    try {
      if (!/^[a-z0-9_-]{1,128}$/i.test(requestedTask)) throw new TypeError("The task link is invalid.");
      evidenceFocus = parseEvidenceFocus(requestedUrl);
      await post(`/api/sessions/${encodeURIComponent(requestedTask)}/select`, {});
      window.history.replaceState({}, "", window.location.pathname);
    } catch (error) {
      deepLinkError = error instanceof Error ? error.message : "The linked task could not be opened.";
    }
  }
  await loadState();
  if ((mode.value === "review" || pendingApprovals.value.length) && !evidenceFocus) await scrollTaskToBottom();
  if (evidenceFocus) {
    try {
      await focusLinkedEvidence(evidenceFocus);
    } catch (error) {
      deepLinkError = error instanceof Error ? error.message : "The linked evidence could not be opened.";
    }
  }
  if (deepLinkError) taskError.value = deepLinkError;
}

async function openProtocolLink(value: string): Promise<void> {
  try {
    const url = new URL(value);
    if (url.protocol !== "vraxis-code:" || url.hostname !== "task") throw new TypeError("Vraxis Code received an unsupported app link.");
    const requestedTask = decodeURIComponent(url.pathname.replace(/^\//, ""));
    if (!/^[a-z0-9_-]{1,128}$/i.test(requestedTask)) throw new TypeError("The task link is invalid.");
    const evidenceFocus = parseEvidenceFocus(url);
    await post(`/api/sessions/${encodeURIComponent(requestedTask)}/select`, {});
    activeView.value = "workspace";
    await loadState();
    if (evidenceFocus) await focusLinkedEvidence(evidenceFocus);
  } catch (error) {
    taskError.value = error instanceof Error ? error.message : "The linked task could not be opened.";
  }
}

onMounted(() => {
  stopProtocolListener = window.vraxisDesktop?.onOpenUrl?.((url) => {
    protocolOpenQueue = protocolOpenQueue.then(() => openProtocolLink(url));
  });
  stopBrowserStateListener = window.vraxisDesktop?.browserView?.onState((browserState) => {
    if (browserState.sessionId !== session.value?.id) return;
    browserHostReady.value = true;
    browserHostLoading.value = browserState.loading;
    browserCanGoBack.value = browserState.canGoBack;
    browserCanGoForward.value = browserState.canGoForward;
    syncBrowserAddress(browserState.url);
    if (!browserState.loading) scheduleBrowserEvidenceRefresh(browserState.sessionId);
  });
  window.addEventListener("resize", syncDesktopBrowserLayout);
  window.addEventListener("scroll", syncDesktopBrowserLayout, true);
  window.addEventListener("keydown", handleWorkspaceShortcut);
  if (desktopBrowserAvailable) {
    browserEvidenceInterval = setInterval(() => {
      if (desktopBrowserVisible.value && session.value?.id && state.browser?.url) {
        void refreshLiveEvidence(session.value.id).catch(() => undefined);
      }
    }, 1_500);
  }
  void loadInitialState();
});
onBeforeUnmount(() => {
  activityPresenter.dispose();
  clearRunPoll();
  closeTaskStream();
  bootstrapAbortController?.abort();
  if (workspaceRefreshTimer) clearTimeout(workspaceRefreshTimer);
  stopProtocolListener?.();
  stopBrowserStateListener?.();
  browserResizeObserver?.disconnect();
  if (browserEvidenceTimer) clearTimeout(browserEvidenceTimer);
  if (browserEvidenceInterval) clearInterval(browserEvidenceInterval);
  window.removeEventListener("resize", syncDesktopBrowserLayout);
  window.removeEventListener("scroll", syncDesktopBrowserLayout, true);
  window.removeEventListener("keydown", handleWorkspaceShortcut);
  void window.vraxisDesktop?.browserView?.setLayout({
    sessionId: session.value?.id ?? lastBrowserLayoutSessionId,
    visible: false,
    bounds: { x: 0, y: 0, width: 1, height: 1 },
  }).catch(() => undefined);
});

watch([browserLiveSurface, desktopBrowserVisible, () => session.value?.id, browserDetailsOpen], async () => {
  observeDesktopBrowserSurface();
  await syncDesktopBrowserLayout();
});

watch([() => state.selectedSessionId, () => state.realtime?.sessionEvents], () => {
  connectTaskStream();
});
</script>

<template>
  <main class="product-root" :data-osx-theme="state.settings.theme">
    <osx-app-shell
      app-title="Vraxis Code"
      sidebar-width="248px"
      :inspector-width="inspectorWidth"
      :inspector-open="activeView === 'workspace' && Boolean(project)"
      :resizable="activeView === 'workspace' && Boolean(project)"
      :sidebar-min-width="220"
      :sidebar-max-width="340"
      :inspector-min-width="320"
      :inspector-max-width="inspector === 'terminal' || inspector === 'browser' ? 1200 : 760"
    >
      <div v-if="activeView === 'workspace' && project" slot="toolbar" class="workspace-identity" aria-label="Current project">
        <osx-icon name="folder" :size="15" />
        <span>{{ project.name }}</span>
        <template v-if="activeBuildBranch">
          <span class="workspace-branch-group" :title="`Build branch ${activeBuildBranch}`">
            <osx-icon name="git-branch" :size="14" />
            <span class="workspace-branch-label">{{ activeBuildBranch }}</span>
          </span>
          <osx-badge size="small" tone="info" label="Build" />
        </template>
        <osx-badge v-else size="small" :label="`Source · ${workspaceBranch}`" />
        <osx-badge
          v-if="session?.worktree"
          size="small"
          :label="session.worktree.status === 'applied' ? 'Applied' : session.worktree.status === 'applying' ? 'Applying' : session.worktree.status === 'stale' ? 'Needs review' : 'Worktree'"
          :tone="session.worktree.status === 'applied' ? 'success' : session.worktree.status === 'stale' ? 'warning' : 'info'"
        />
        <span v-if="workspaceRefreshing" class="workspace-sync-status" role="status">
          <osx-spinner size="small" label="Refreshing workspace" />
          Refreshing
        </span>
      </div>

      <nav slot="sidebar" class="sidebar" aria-label="Projects and tasks">
        <div class="sidebar-heading">
          <span>Projects</span>
          <osx-icon-button v-if="state.projects.length" label="Choose another project" icon="plus" size="small" :disabled="registering" @click="openProjectPicker" />
        </div>

        <osx-source-list
          v-if="state.projects.length"
          label="Projects"
          heading=""
          :items="sourceItems"
          :icons="sourceIcons"
          :value="project?.name"
          compact
          @change="chooseProject"
        />
        <p v-else class="sidebar-empty-copy">No projects yet.</p>

        <section v-if="project" class="sidebar-section" aria-labelledby="tasks-heading">
          <div class="sidebar-heading">
            <span id="tasks-heading">Tasks</span>
          </div>
          <button class="new-task-button" type="button" :disabled="startingNewTask" @click="startNewTask">
            <osx-icon :name="startingNewTask ? 'loader' : 'plus'" :size="14" />
            <span>{{ startingNewTask ? "Starting…" : "New task" }}</span>
          </button>
          <button
            v-for="item in projectSessions"
            :key="item.id"
            :class="['session-link', { selected: item.id === state.selectedSessionId }]"
            type="button"
            @click="chooseSession(item)"
          >
            <span>{{ item.title }}</span>
            <small>{{ visibleSessionMode(item) }}</small>
          </button>
          <p v-if="projectSessions.length === 0" class="sidebar-empty-copy">Your tasks will appear here.</p>
        </section>

        <div class="sidebar-footer">
          <button
            type="button"
            :class="['settings-link', { selected: activeView === 'settings' }]"
            :aria-current="activeView === 'settings' ? 'page' : undefined"
            @click="openSettings"
          >
            <osx-icon name="settings" :size="16" />
            <span>Settings</span>
          </button>
        </div>
      </nav>

      <section ref="sessionPane" class="session-pane" tabindex="-1" :aria-label="activeView === 'settings' ? 'Settings' : 'Agent task'">
        <div v-if="activeView === 'settings'" class="settings-pane">
          <header class="settings-header">
            <div>
              <span class="settings-mark"><osx-icon name="settings" :size="22" /></span>
              <span>
                <h1>Settings</h1>
                <p>Choose defaults for new tasks and this device.</p>
              </span>
            </div>
            <osx-button size="small" @click="closeSettings">Done</osx-button>
          </header>

          <div class="settings-sections">
            <osx-alert
              v-if="settingsError"
              tone="error"
              title="Settings not saved"
              :description="settingsError"
            />
            <osx-alert
              v-if="runtimeActionNotice"
              tone="info"
              title="Harness action ready"
              :description="runtimeActionNotice"
            />

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
                :value="state.settings.theme"
                :disabled="settingsSaving"
                @change="chooseTheme"
              />
            </section>

            <AgentDefaults />

            <AuthorityModeSettings
              :value="state.settings.authorityMode ?? 'supervised'"
              :saving="settingsSaving"
              @change="updateSettings({ authorityMode: $event })"
            />

            <PermissionCenter
              :rules="permissionRules"
              :projects="state.projects"
              :loading="permissionLoading"
              :exporting="permissionExporting"
              :action-id="permissionActionId"
              :error="permissionError"
              :notice="permissionNotice"
              @refresh="refreshPermissionRules"
              @export="exportPermissionAudit"
              @revoke="revokePermissionRule"
            />

            <ProofTrustSettings />

            <TeamPolicySettings
              :state="teamPolicy"
              :busy="teamPolicyBusy"
              :error="teamPolicyError"
              :notice="teamPolicyNotice"
              @refresh="refreshTeamPolicy"
              @create="createTeamPolicy"
              @import="importTeamPolicy"
              @remove="removeTeamPolicy"
              @error="teamPolicyError = $event"
            />

            <SupportDiagnostics />

            <AgentHarnessSettings
              :runtimes="localRuntimes"
              :settings="state.settings"
              :saving="settingsSaving"
              :refreshing="runtimeRefreshing"
              :probing-runtime-id="runtimeProbingId"
              @update="updateSettings"
              @refresh="refreshRuntimes"
              @maintain="maintainRuntime"
              @probe="probeRuntime"
            />

            <McpConnectionCenter
              :servers="state.mcpServers"
              :projects="state.projects"
              :selected-project-id="state.selectedProjectId"
              @changed="mcpServersChanged"
            />

            <ModelProviderSettings
              :providers="state.modelProviders"
              @connected="providerConnected"
              @changed="providersChanged"
            />

            <osx-alert
              tone="info"
              title="Settings stay on this device"
              description="The local Vraxis Code service saves these defaults. They are not added to agent transcripts."
            />
          </div>

          <footer class="settings-save-state" aria-live="polite">
            <osx-spinner v-if="settingsSaving" size="small" label="Saving settings" show-label />
            <span v-else-if="settingsError"><osx-icon name="warning" :size="14" /> Previous settings restored</span>
            <span v-else><osx-icon name="check" :size="14" /> Saved on this device</span>
          </footer>
        </div>

        <div v-else-if="loading" class="center-state">
          <WorkspaceSplash />
        </div>

        <div v-else-if="loadError" class="center-state">
          <osx-empty-state
            title="Local service is offline"
            description="Start Vraxis Code again, then retry. Your project data stays on this device."
            action-label="Retry"
            icon="warning"
            @action="loadState"
          />
        </div>

        <div v-else-if="!project" class="onboarding-state first-run-onboarding">
          <FirstRunJourney
            :runtime="runtime"
            :sessions="[]"
            :verification-runs="[]"
            :busy="firstRunBusy"
            @action="handleFirstRunAction"
          />
          <small>Vraxis Code only reads folders you approve. Harness verification never opens a project.</small>
        </div>

        <template v-else>
          <header class="task-header">
            <div class="task-title">
              <h1>{{ session?.title ?? "New task" }}</h1>
            </div>
          </header>

          <osx-alert
            v-if="showStartupRecoveryAlert"
            tone="warning"
            title="Recovered after an unexpected exit"
            description="Active approvals, terminal runs, verification, and worktree application were reconciled before this workspace opened. Review retained evidence before continuing unfinished work."
            dismissible
            @dismiss="dismissStartupRecoveryAlert"
          />

          <osx-alert
            v-if="mode === 'build'"
            :tone="runtimeCanBuild ? 'info' : 'warning'"
            :title="runtimeCanBuild ? 'Build uses an isolated worktree' : 'This runtime cannot start Build tasks'"
            :description="runtimeCanBuild
              ? session?.worktree
                ? `Changes stay on ${session.worktree.branch}. The source project stays unchanged.`
                : 'Vraxis Code will create a new branch from the current HEAD before the agent can edit files.'
              : 'Choose a runtime that supports guarded isolated-workspace writes.'"
          />

          <details v-if="runtime && runtimeCapabilities.length" class="runtime-preflight">
            <summary>
              <span><osx-icon name="shield-check" :size="15" /> {{ runtime.name }} capabilities</span>
              <span>{{ runtimeCapabilitySummary }}</span>
            </summary>
            <ul>
              <li v-for="item in runtimeCapabilities" :key="item.id" :data-state="item.state">
                <span><osx-icon :name="item.state === 'available' ? 'check' : item.state === 'limited' ? 'info' : 'minus'" :size="14" /></span>
                <span><strong>{{ item.label }}</strong><small>{{ item.detail }}</small></span>
                <osx-badge size="small" :label="item.state === 'available' ? 'Ready' : item.state === 'limited' ? 'Limited' : 'Unavailable'" :tone="item.state === 'available' ? 'success' : item.state === 'limited' ? 'warning' : 'neutral'" />
              </li>
            </ul>
          </details>

          <FirstRunJourney
            v-if="showFirstRunJourney"
            :runtime="runtime"
            :project="project"
            :project-doctor="state.projectDoctor"
            :sessions="projectSessions"
            :verification-runs="verificationRuns"
            :busy="firstRunBusy"
            :closable="verificationRuns.some((run) => run.state === 'passed')"
            @action="handleFirstRunAction"
            @close="firstRunJourneyClosed = true"
          />

          <section
            v-if="focusedEvidenceSummary"
            :id="focusedApproval ? evidenceDomId('approval', focusedApproval.id) : undefined"
            class="evidence-deep-link-focus"
            aria-label="Evidence opened from signed proof"
          >
            <span class="evidence-deep-link-icon"><osx-icon :name="focusedEvidenceSummary.icon" :size="16" /></span>
            <span>
              <strong>{{ focusedEvidenceSummary.title }}</strong>
              <small>{{ focusedEvidenceSummary.detail }}</small>
              <code v-if="focusedApproval">{{ focusedApproval.scope }}</code>
            </span>
            <osx-badge v-if="focusedApproval" size="small" :label="focusedApproval.state" :tone="focusedApproval.state === 'completed' ? 'success' : focusedApproval.state === 'denied' || focusedApproval.state === 'failed' ? 'danger' : 'warning'" />
            <osx-icon-button label="Close evidence focus" icon="close" size="small" @click="clearEvidenceFocus" />
          </section>

          <div v-if="displayedSessionEvents.length" class="conversation" aria-live="polite">
            <template v-for="item in displayedSessionEvents" :key="item.id">
              <osx-agent-message
                v-if="item.kind === 'message'"
                :message-role="item.actor === 'agent' ? 'assistant' : 'user'"
                :author="item.actor === 'agent' ? runtime?.name : 'You'"
                :model="item.actor === 'agent' ? modelId : undefined"
                :timestamp="new Date(item.timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })"
                :status="eventStatus(item)"
              >
                <osx-markdown v-if="item.actor === 'agent'" :content="item.title" code-copy />
                <template v-else>
                  <span>{{ item.title }}</span>
                  <span v-if="item.steering" :class="['message-delivery', item.steering.state]">
                    <osx-icon :name="item.steering.delivery === 'redirect' ? 'corner-down-left' : 'list-checks'" :size="13" />
                    {{ item.steering.state === 'queued'
                      ? item.steering.delivery === 'redirect' ? 'Interrupting current turn' : 'Queued for the next turn'
                      : item.steering.state === 'running' ? 'Agent is handling this message'
                        : item.steering.state === 'superseded' ? 'Not delivered' : 'Delivered' }}
                  </span>
                  <div v-if="item.attachments?.length || item.skills?.length" class="message-attachments" aria-label="Attached context">
                    <span v-for="attachment in item.attachments" :key="attachment.id">
                      <osx-icon name="file-code" :size="14" />{{ attachment.path }}
                    </span>
                    <span v-for="skill in item.skills" :key="skill.id">
                      <osx-icon name="sparkle" :size="14" />{{ skill.name }}
                    </span>
                  </div>
                </template>
              </osx-agent-message>
              <osx-thinking
                v-else-if="item.kind === 'progress'"
                :title="item.title"
                :summary="item.detail"
                :status="progressStatus(item)"
                :open="progressStatus(item) === 'streaming'"
              />
              <div v-else-if="item.kind === 'tool'" class="tool-activity-frame" role="status" aria-live="polite">
                <Transition name="activity-swap" mode="out-in">
                  <osx-tool-call
                    :key="`${item.id}:${item.sequence}`"
                    :name="item.title"
                    :summary="item.detail"
                    :status="toolActivityStatus(item)"
                  />
                </Transition>
              </div>
              <div v-else-if="item.kind === 'lifecycle' || item.kind === 'verification' || item.kind === 'telemetry' || item.kind === 'approval'" :class="['session-note', item.kind, item.state]">
                <osx-icon :name="item.kind === 'approval' ? 'lock' : eventIcon(item)" :size="15" />
                <div><strong>{{ item.title }}</strong><span>{{ item.detail }}</span></div>
              </div>
            </template>
            <div v-if="session?.status === 'failed' || session?.status === 'interrupted'" class="resume-run">
              <div>
                <strong>{{ session.settlement?.state === "recovery-needed" ? "Recovered unfinished task" : session.status === "interrupted" ? "Continue this task" : "Try the runtime again" }}</strong>
                <span>{{ session.settlement?.reason ?? "Your messages and completed activity will stay in this task." }}</span>
                <small v-if="session.settlement">Attempt {{ session.settlement.attempt }} · completed activity and receipts were retained</small>
              </div>
              <osx-button size="small" icon="play" :loading="submitting" @click="resumeRun">Resume task</osx-button>
            </div>
          </div>

          <div v-else-if="!showFirstRunJourney" class="new-task-state">
            <h1>What do you want to do?</h1>
            <p>Ask about the code or describe a change.</p>
            <div class="suggestions" aria-label="Task suggestions">
              <button type="button" @click="useSuggestion('Explain how this project is structured', 'ask')">Explain this project</button>
              <button type="button" @click="useSuggestion('Plan the next implementation step', 'plan')">Plan a change</button>
              <button type="button" @click="useSuggestion('Find the cause of a failing test', 'ask')">Investigate a failure</button>
            </div>
          </div>

          <section v-if="pendingApprovals.length" class="approval-queue" aria-label="Approval requests" aria-live="polite" aria-atomic="true">
            <header>
              <div>
                <strong>{{ pendingApprovals.length === 1 ? "Action needs your approval" : `${pendingApprovals.length} actions need your approval` }}</strong>
                <span>Review the exact authority and scope before the agent continues.</span>
              </div>
              <osx-badge size="small" :label="String(pendingApprovals.length)" tone="warning" />
            </header>
            <div v-for="approval in pendingApprovals" :key="approval.id" class="approval-request">
              <osx-agent-approval
                :title="approval.title"
                :description="approvalDescription(approval)"
                :risk="approval.risk"
                :scope="approval.scope"
                approve-label="Allow once"
                reject-label="Deny"
                :disabled="approvalActionId === approval.id"
                @approve="decideApproval(approval, 'approve')"
                @reject="decideApproval(approval, 'deny')"
              />
              <div v-if="approval.rememberable !== false" class="approval-duration-actions" aria-label="Remember this approval">
                <span>{{ approval.authority?.reason ?? 'Trust this exact scope:' }}</span>
                <osx-button
                  v-if="(state.settings.authorityMode ?? 'supervised') !== 'supervised' && approval.capability !== 'credentials' && approval.capability !== 'destructive'"
                  size="small"
                  variant="secondary"
                  :disabled="Boolean(approvalActionId)"
                  @click="decideApproval(approval, 'approve', 'session')"
                >
                  For this task
                </osx-button>
                <osx-button
                  v-if="state.settings.authorityMode === 'full-access' && approval.capability !== 'credentials' && approval.capability !== 'destructive'"
                  size="small"
                  variant="secondary"
                  :disabled="Boolean(approvalActionId)"
                  @click="decideApproval(approval, 'approve', 'project')"
                >
                  For this project
                </osx-button>
              </div>
            </div>
          </section>
        </template>
        <div v-if="activeView === 'workspace'" ref="taskEnd" class="task-end" aria-hidden="true" />
      </section>

      <div v-if="activeView === 'workspace' && project" slot="composer" class="task-composer-shell">
        <div :class="['task-composer-frame', { 'is-pending': composerPending }]">
          <div v-if="latestMessagesHidden" class="task-jump-latest">
            <osx-tooltip text="Jump to latest" placement="top">
              <osx-icon-button label="Jump to latest" icon="chevron-down" @click="jumpToLatest" />
            </osx-tooltip>
          </div>
          <osx-agent-composer
            :value="composer"
            :placeholder="sessionIsRunning ? 'Steer the agent or queue the next instruction…' : session ? 'Send a follow-up. @ adds files. $ adds skills.' : 'Describe the task. @ adds files. $ adds skills.'"
            label="Message to agent"
            :model="composerModelLabel"
            :model-id="modelId ?? ''"
            :models="composerModelOptions"
            :access-mode="modeLabel"
            :access-mode-id="mode"
            :access-modes="composerModeOptions"
            :suggestions="composerSuggestions"
            :context-items="visibleComposerContextItems"
            :attachments="composerAttachments"
            :state="composerState"
            :status-text="composerStatus"
            :error="composerError"
            :disabled="composerDisabled"
            :allow-submit-while-running="true"
            :allow-attachments="true"
            attachment-accept="*/*"
            :rows="3"
            :max-rows="8"
            submit-shortcut="enter"
            @input="updateComposerValue"
            @model-change="chooseTaskModel"
            @access-mode-change="chooseMode"
            @attachment-add="acceptNativeAttachments"
            @attachments-change="syncComposerAttachments"
            @context-change="syncComposerContext"
            @submit="submitPrompt"
            @stop="interruptRun"
          >
            <label v-if="sessionIsRunning" slot="controls" class="composer-runtime-control steering-delivery-control">
              <osx-icon :name="steeringDelivery === 'redirect' ? 'corner-down-left' : 'list-checks'" :size="14" />
              <span class="visually-hidden">Message delivery</span>
              <select v-model="steeringDelivery" aria-label="Message delivery" :disabled="submitting">
                <option value="queue">Send after this turn</option>
                <option value="redirect">Interrupt and send</option>
              </select>
              <osx-icon name="chevron-down" :size="12" />
            </label>
            <label v-if="buildNeedsNewWorktree" slot="controls" class="composer-runtime-control composer-branch-control">
              <osx-icon name="git-branch" :size="14" />
              <span class="visually-hidden">Branch slug</span>
              <input
                v-model="composerBranchSlug"
                type="text"
                aria-label="Branch slug"
                placeholder="fix/login-bug"
                spellcheck="false"
                :disabled="submitting || composerPending"
              />
            </label>
            <label slot="controls" class="composer-runtime-control">
              <osx-icon name="terminal" :size="14" />
              <span class="visually-hidden">Runtime</span>
              <select
                aria-label="Runtime"
                :value="runtime?.id"
                :disabled="submitting || sessionIsRunning"
                @change="chooseTaskRuntime"
              >
                <option
                  v-for="item in state.runtimes"
                  :key="item.id"
                  :value="item.id"
                  :disabled="item.availability !== 'installed' || !runtimeIsEnabled(item.id)"
                >
                  {{ item.name }}{{ item.availability !== "installed" ? " (setup needed)" : !runtimeIsEnabled(item.id) ? " (disabled)" : "" }}
                </option>
              </select>
              <osx-icon name="chevron-down" :size="12" />
            </label>
          </osx-agent-composer>
        </div>
      </div>

      <aside v-if="activeView === 'workspace' && project" slot="inspector" class="inspector" aria-label="Project evidence">
        <div class="evidence-tabs" role="tablist" aria-label="Project evidence">
          <button
            v-for="(item, index) in inspectorOptions"
            :id="`evidence-tab-${item.value}`"
            :key="item.value"
            type="button"
            role="tab"
            :class="['evidence-tab', { selected: inspector === item.value }]"
            :aria-label="item.label"
            :aria-selected="inspector === item.value"
            :data-tooltip="item.value === 'terminal' ? 'Terminal · Ctrl+`' : item.label"
            aria-controls="evidence-panel"
            :tabindex="inspector === item.value ? 0 : -1"
            @click="chooseInspectorView(item.value)"
            @keydown="moveInspectorFocus($event, index)"
          >
            <osx-icon :name="item.icon" :size="17" />
          </button>
        </div>

        <section
          id="evidence-panel"
          :class="['evidence-panel', { 'has-ledger': evidenceLedger.hasEvidence }]"
          :role="inspectorUsesTab ? 'tabpanel' : 'region'"
          :aria-labelledby="inspectorUsesTab ? `evidence-tab-${inspector}` : undefined"
          :aria-label="inspectorUsesTab ? undefined : 'Project verification'"
        >
          <section v-if="evidenceLedger.hasEvidence" class="evidence-ledger" aria-label="Task evidence ledger">
            <span class="evidence-ledger-title"><osx-icon name="list-checks" :size="14" /><strong>Evidence</strong></span>
            <span v-if="evidenceLedger.activeCommands"><osx-icon name="loader" :size="13" />{{ evidenceLedger.activeCommands }} running</span>
            <span v-if="evidenceLedger.passedCommands"><osx-icon name="check" :size="13" />{{ evidenceLedger.passedCommands }} passed</span>
            <span v-if="evidenceLedger.verificationPassed"><osx-icon name="shield-check" :size="13" />{{ evidenceLedger.verificationPassed }} verified</span>
            <span v-if="evidenceLedger.verificationActive" class="warning"><osx-icon name="list-checks" :size="13" />{{ evidenceLedger.verificationActive }} verifying</span>
            <span v-if="evidenceLedger.browserActions"><osx-icon name="eye" :size="13" />{{ evidenceLedger.browserActions }} browser {{ evidenceLedger.browserActions === 1 ? 'action' : 'actions' }}</span>
            <span v-if="evidenceLedger.pendingApprovals" class="warning"><osx-icon name="lock" :size="13" />{{ evidenceLedger.pendingApprovals }} waiting</span>
          </section>
          <div v-if="inspector === 'files'" class="evidence-view file-inspector">
            <div
              v-if="state.files.length"
              :class="['file-workbench', { 'preview-open': selectedFile }]"
              role="group"
              :aria-label="selectedFile ? 'Code and project files' : 'Project files'"
            >
              <section v-if="selectedFile" class="file-preview" aria-label="File preview">
                <header>
                  <span><osx-icon name="file-code" :size="14" /> {{ selectedFile || "Choose a file" }}</span>
                  <span class="file-preview-actions">
                    <osx-badge v-if="filePreview" size="small" :label="filePreview.language" />
                    <osx-icon-button label="Close file preview" icon="close" size="small" @click="closeFilePreview" />
                  </span>
                </header>
                <div v-if="fileLoading" class="file-preview-state"><osx-spinner size="small" label="Loading file" show-label /></div>
                <osx-alert v-else-if="fileError" tone="error" title="File not opened" :description="fileError" />
                <template v-else-if="filePreview">
                  <osx-alert v-if="filePreview.truncated" tone="warning" title="Preview truncated" description="This preview shows the first 512 KB of the file." />
                  <pre tabindex="0" :aria-label="`Preview of ${filePreview.path}`"><code :class="{ hljs: highlightedFile?.highlighted }">
                    <span v-for="(line, index) in highlightedLines" :key="index" class="code-line">
                      <span class="line-number" aria-hidden="true">{{ index + 1 }}</span>
                      <!-- Highlight.js escapes repository content before producing token spans. -->
                      <!-- eslint-disable-next-line vue/no-v-html -->
                      <span class="line-source" v-html="line || ' '" />
                    </span>
                  </code></pre>
                </template>
                <div v-else class="evidence-empty" role="status">
                  <span><osx-icon name="file-text" :size="18" /></span>
                  <div><strong>Choose a file</strong><small>Select a text file to preview it.</small></div>
                </div>
              </section>
              <div v-if="selectedFile" class="file-workbench-divider" aria-hidden="true" />
              <div class="file-tree-region">
                <WorkspaceFileTree :files="state.files" :selected="selectedFile" @select="chooseFilePath" />
              </div>
            </div>
            <div v-else class="evidence-empty" role="status">
              <span><osx-icon name="file" :size="18" /></span>
              <div><strong>No files found</strong><small>This project has no readable files.</small></div>
            </div>
          </div>

          <div v-else-if="inspector === 'changes'" class="evidence-view change-inspector">
            <section v-if="session?.worktree" class="worktree-finish" aria-label="Build recovery">
              <osx-alert
                v-if="session.worktree.status === 'applied'"
                tone="success"
                title="Changes applied"
                :description="`The approved project contains this Build. Its checkpoint remains on ${session.worktree.branch}.`"
              />
              <osx-alert
                v-else-if="session.worktree.status === 'conflicted'"
                tone="warning"
                title="Apply needs attention"
                :description="session.worktree.conflict ?? 'The project changed. Review the overlap, then retry the preserved checkpoint.'"
              />
              <div v-if="session.worktree.conflicts?.length" class="conflict-summary" role="status">
                <strong>{{ session.worktree.status === "conflicted" ? "Overlap isolated" : "Known overlap remains" }}</strong>
                <ul>
                  <li v-for="conflict in session.worktree.conflicts" :key="`${conflict.path}:${conflict.hunkIds?.join(',')}`">
                    <button v-if="state.changes.some((change) => change.path === conflict.path)" type="button" @click="openChangedFile(conflict.path)">{{ conflict.path }}</button>
                    <span v-else>{{ conflict.path }}</span>
                    <small>{{ conflict.detail }}</small>
                  </li>
                </ul>
                <small>The approved project was not changed. Select a safe file or hunk and apply it separately.</small>
              </div>
              <osx-alert
                v-else-if="session.worktree.status === 'archived'"
                tone="info"
                title="Build archived"
                :description="`The checkpoint and ${session.worktree.branch} recovery branch are preserved.`"
              />
              <osx-alert
                v-else-if="session.worktree.status === 'cleaned'"
                tone="neutral"
                title="Worktree cleaned"
                :description="`The local worktree was removed. Restore it from ${session.worktree.branch} whenever you need it.`"
              />
              <osx-alert
                v-else-if="session.worktree.status === 'reverted'"
                tone="info"
                title="Changes reverted"
                description="The exact checkpoint patch was removed from the project. The recovery branch is still available."
              />
              <osx-alert
                v-else-if="session.worktree.status === 'applying'"
                tone="info"
                title="Applying changes"
                description="The checkpoint is being validated against the approved project."
              />
              <osx-alert
                v-else-if="session.worktree.status === 'stale'"
                tone="error"
                title="Apply state needs review"
                description="The project and checkpoint both changed while application was interrupted. Your recovery branch is preserved."
              />
              <osx-alert
                v-else-if="latestWorktreeApproval?.state === 'failed'"
                tone="error"
                title="Worktree action failed"
                :description="latestWorktreeApproval.failure ?? 'Review the project and try again.'"
              />
              <div class="worktree-finish-actions">
                <div>
                  <strong>{{ session.worktree.status === "active" ? "Ready to finish?" : "Recovery controls" }}</strong>
                  <small>Every destructive step asks again. The checkpoint branch remains the source of recovery.</small>
                </div>
                <span class="worktree-action-buttons">
                  <osx-button
                    v-if="session.worktree.status === 'active' || session.worktree.status === 'conflicted'"
                    variant="primary"
                    size="small"
                    icon="check"
                    :disabled="sessionIsRunning || worktreeApplyPending || changedFiles.length === 0"
                    @click="requestApplyChanges"
                  >{{ worktreeApplyPending ? "Waiting for approval" : session.worktree.status === "conflicted" ? "Retry apply" : "Apply changes" }}</osx-button>
                  <osx-button
                    v-if="['active', 'conflicted'].includes(session.worktree.status) && selectedChange && !session.worktree.appliedPaths?.includes(selectedChange)"
                    variant="secondary"
                    size="small"
                    :disabled="sessionIsRunning || worktreeApplyPending"
                    @click="requestApplyChanges([selectedChange])"
                  >Apply file</osx-button>
                  <osx-button
                    v-if="['active', 'conflicted', 'applied', 'reverted'].includes(session.worktree.status)"
                    variant="secondary"
                    size="small"
                    :disabled="sessionIsRunning || Boolean(approvalActionId)"
                    @click="requestWorktreeAction('archive')"
                  >Archive</osx-button>
                  <osx-button
                    v-if="session.worktree.status === 'applied'"
                    variant="secondary"
                    size="small"
                    :disabled="Boolean(approvalActionId)"
                    @click="requestWorktreeAction('revert')"
                  >Revert</osx-button>
                  <osx-button
                    v-if="session.worktree.status === 'archived' || session.worktree.status === 'cleaned'"
                    variant="primary"
                    size="small"
                    :disabled="Boolean(approvalActionId)"
                    @click="requestWorktreeAction('restore')"
                  >Restore</osx-button>
                  <osx-button
                    v-if="session.worktree.status === 'archived'"
                    variant="secondary"
                    size="small"
                    :disabled="Boolean(approvalActionId)"
                    @click="requestWorktreeAction('cleanup')"
                  >Clean local copy</osx-button>
                </span>
              </div>
            </section>
            <div v-if="changedFiles.length === 0" class="evidence-empty" role="status">
              <span><osx-icon name="git-branch" :size="18" /></span>
              <div><strong>No changes</strong><small>Build task changes will appear here.</small></div>
            </div>
            <template v-else>
              <div :class="['change-workbench', { 'preview-open': selectedChange }]" aria-label="Build changes">
                <section
                  v-if="selectedChange"
                  :id="evidenceDomId('change', selectedChange)"
                  class="diff-preview"
                  aria-label="Change diff"
                >
                  <header>
                    <span><osx-icon name="git-branch" :size="14" /> {{ selectedChange }}</span>
                    <span class="file-preview-actions">
                      <osx-badge v-if="changeDiff" size="small" :label="`+${changeDiff.additions} −${changeDiff.deletions}`" />
                      <osx-icon-button label="Close change diff" icon="close" size="small" @click="closeChangeDiff" />
                    </span>
                  </header>
                  <div v-if="changeLoading" class="file-preview-state"><osx-spinner size="small" label="Loading diff" show-label /></div>
                  <osx-alert v-else-if="changeError" tone="error" title="Diff not opened" :description="changeError" />
                  <template v-else-if="changeDiff">
                    <fieldset v-if="changeDiff.partialSelection && availableChangeHunks.length" class="hunk-selector">
                      <legend>Apply exact hunks</legend>
                      <div class="hunk-selector-list">
                        <label
                          v-for="(hunk, index) in availableChangeHunks"
                          :key="hunk.id"
                          :class="{ conflict: conflictingHunkIds.has(hunk.id) }"
                        >
                          <input
                            type="checkbox"
                            :checked="selectedHunkIds.includes(hunk.id)"
                            :aria-label="`Select hunk ${index + 1}: ${hunk.header}`"
                            @change="updateSelectedHunk(hunk.id, $event)"
                          >
                          <span><strong>Hunk {{ index + 1 }}</strong><code>{{ hunk.header }}</code></span>
                          <small>+{{ hunk.additions }} −{{ hunk.deletions }}</small>
                          <osx-badge v-if="conflictingHunkIds.has(hunk.id)" size="small" tone="warning" label="Overlaps" />
                        </label>
                      </div>
                      <footer>
                        <span>
                          <button type="button" @click="selectAllAvailableHunks">Select all</button>
                          <button v-if="selectedHunkIds.length" type="button" @click="selectedHunkIds = []">Clear</button>
                        </span>
                        <osx-button
                          variant="primary"
                          size="small"
                          :disabled="!selectedHunkIds.length || sessionIsRunning || worktreeApplyPending"
                          @click="requestApplySelectedHunks"
                        >
                          Apply {{ selectedHunkIds.length }} {{ selectedHunkIds.length === 1 ? "hunk" : "hunks" }}
                        </osx-button>
                      </footer>
                    </fieldset>
                    <osx-alert
                      v-else-if="!changeDiff.partialSelection && !changeDiff.binary && changeDiff.hunks.length"
                      tone="neutral"
                      title="Whole-file change"
                      description="New, deleted, renamed, and already-partial files are applied as a whole to preserve Git semantics."
                    />
                    <osx-diff-viewer
                      :file="changeDiff.path"
                      :patch="changeDiff.patch"
                      view="unified"
                      :language="changeDiff.language"
                      :additions="changeDiff.additions"
                      :deletions="changeDiff.deletions"
                      :label="`Diff for ${changeDiff.path}`"
                    />
                  </template>
                </section>
                <div class="changed-file-list">
                  <header class="changed-file-summary">
                    <strong>{{ changedFiles.length }} {{ changedFiles.length === 1 ? "file" : "files" }} changed</strong>
                    <small>Select a file to review</small>
                  </header>
                  <button
                    v-for="file in changedFiles"
                    :key="file.path"
                    :class="{ selected: selectedChange === file.path }"
                    :aria-label="`${file.path} ${file.status}`"
                    :aria-pressed="selectedChange === file.path"
                    type="button"
                    @click="openChangedFile(file.path)"
                  >
                    <span class="changed-file-identity">
                      <osx-icon name="file-text" :size="14" />
                      <span class="changed-file-path">{{ file.path }}</span>
                    </span>
                    <osx-badge size="small" :label="file.status" />
                    <osx-badge v-if="session?.worktree?.appliedPaths?.includes(file.path)" size="small" label="Applied" tone="success" />
                  </button>
                </div>
              </div>
            </template>
          </div>

          <div v-else-if="inspector === 'verify'" class="evidence-view verification-inspector">
            <section class="project-doctor-card" aria-label="Project Doctor">
              <header>
                <span class="project-doctor-title">
                  <span><osx-icon name="stethoscope" :size="16" /></span>
                  <span><strong>Project Doctor</strong><small>Manifest-backed checks. Nothing runs during inspection.</small></span>
                </span>
                <span class="project-doctor-actions">
                  <osx-badge
                    v-if="state.projectDoctor?.verificationSource"
                    size="small"
                    :label="state.projectDoctor.verificationSource.kind === 'project' ? 'Project recipe' : 'Discovered'"
                    :tone="state.projectDoctor.verificationSource.kind === 'project' ? 'info' : 'neutral'"
                  />
                  <osx-badge
                    size="small"
                    :label="!state.projectDoctor ? 'Not inspected' : state.projectDoctor.ok && verificationHasRecipe ? 'Ready' : 'Needs setup'"
                    :tone="state.projectDoctor?.ok && verificationHasRecipe ? 'success' : 'warning'"
                  />
                  <osx-icon-button label="Inspect project again" icon="refresh-cw" size="small" :loading="verificationAction === 'doctor'" @click="refreshProjectDoctor" />
                </span>
              </header>
              <template v-if="state.projectDoctor">
                <div class="project-facts" aria-label="Detected project facts">
                  <span v-if="state.projectDoctor.packageManager"><strong>{{ state.projectDoctor.packageManager.name }}</strong><small>{{ state.projectDoctor.packageManager.lockfile ?? 'No lockfile' }}</small></span>
                  <span><strong>{{ state.projectDoctor.projectKind.replace('-', ' ') }}</strong><small>Project shape</small></span>
                  <span v-if="state.projectDoctor.frameworks.length"><strong>{{ state.projectDoctor.frameworks.map(item => item.name).join(', ') }}</strong><small>Frameworks</small></span>
                  <span v-else><strong>{{ state.projectDoctor.ecosystems.map(item => item.label).join(', ') || 'Unknown' }}</strong><small>Ecosystem</small></span>
                  <span v-if="state.projectDoctor.verificationServices?.length"><strong>{{ state.projectDoctor.verificationServices.length }}</strong><small>Governed {{ state.projectDoctor.verificationServices.length === 1 ? 'service' : 'services' }}</small></span>
                </div>
                <osx-alert
                  v-for="issue in state.projectDoctor.issues.slice(0, 3)"
                  :key="issue.code"
                  :tone="issue.severity === 'error' ? 'error' : issue.severity === 'warning' ? 'warning' : 'info'"
                  :title="issue.message"
                  :description="issue.remediation"
                />
              </template>
              <div v-else class="doctor-loading"><osx-spinner size="small" label="Inspecting project" show-label /></div>
            </section>

            <section class="verification-workflow" aria-label="Verification plan">
              <header>
                <span>
                  <strong>{{ latestVerification ? verificationLabel(latestVerification) : 'Verification plan' }}</strong>
                  <small>{{ latestVerification ? `Recipe ${latestVerification.recipeFingerprint?.slice(0, 12) ?? 'legacy'} · ${latestVerification.services.length} ${latestVerification.services.length === 1 ? 'service' : 'services'} · ${latestVerification.checks.length} command ${latestVerification.checks.length === 1 ? 'receipt' : 'receipts'} · ${latestVerification.browserAssertions?.length ?? 0} browser ${(latestVerification.browserAssertions?.length ?? 0) === 1 ? 'assertion' : 'assertions'}` : state.projectDoctor?.verificationSource?.kind === 'project' ? `Project contract · ${state.projectDoctor.verificationSource.path}` : 'Run the checks this project already declares.' }}</small>
                </span>
                <osx-badge v-if="latestVerification" size="small" :label="verificationLabel(latestVerification)" :tone="verificationTone(latestVerification)" />
              </header>
              <section v-if="pendingVerificationHandoff" class="verification-handoff" aria-label="Agent verification handoff">
                <span class="verification-handoff-icon"><osx-icon name="shield-check" :size="17" /></span>
                <span>
                  <strong>{{ pendingVerificationHandoff.requestedBy.runtimeId }} handed verification back to you</strong>
                  <small>{{ pendingVerificationHandoff.note ?? 'The agent requested the exact project-owned recipe. It did not choose commands or start any process.' }}</small>
                </span>
                <div>
                  <osx-button size="small" variant="secondary" :loading="verificationAction === 'handoff'" @click="dismissVerificationHandoff">Dismiss</osx-button>
                  <osx-button size="small" variant="primary" icon="play" :loading="verificationAction === 'start'" :disabled="!verificationHasRecipe" @click="startVerification(pendingVerificationHandoff.id)">Start governed verification</osx-button>
                </div>
              </section>
              <div v-if="latestVerification?.services.length" class="verification-services" aria-label="Governed service health">
                <article v-for="service in latestVerification.services" :key="service.id">
                  <span>
                    <strong>{{ service.title }}</strong>
                    <small>{{ service.health.url }} · HTTP {{ service.lastHealthStatus ?? 'waiting' }} · {{ service.healthAttempts }} {{ service.healthAttempts === 1 ? 'attempt' : 'attempts' }}</small>
                  </span>
                  <osx-badge
                    size="small"
                    :label="service.state.replace('-', ' ')"
                    :tone="service.state === 'healthy' || service.state === 'stopped' ? 'success' : service.state === 'failed' ? 'error' : 'info'"
                  />
                </article>
              </div>
              <div v-if="latestVerification?.browserAssertions?.length" class="verification-services" aria-label="Browser acceptance assertions">
                <article v-for="assertion in latestVerification.browserAssertions" :key="assertion.id">
                  <span>
                    <strong>{{ assertion.title }}</strong>
                    <small>{{ assertion.kind }} {{ assertion.match }} “{{ assertion.value }}”<template v-if="assertion.actual"> · saw “{{ assertion.actual.slice(0, 120) }}”</template></small>
                  </span>
                  <osx-badge
                    size="small"
                    :label="assertion.state"
                    :tone="assertion.state === 'passed' ? 'success' : assertion.state === 'failed' ? 'error' : 'neutral'"
                  />
                </article>
              </div>
              <div v-if="latestVerification?.visual" class="verification-visual" aria-label="Visual comparison evidence">
                <header>
                  <span>
                    <strong>Visual baseline</strong>
                    <small>{{ latestVerification.visual.baselinePath }} · tolerance {{ (latestVerification.visual.maxDiffRatio * 100).toFixed(3) }}%</small>
                  </span>
                  <osx-badge
                    size="small"
                    :label="latestVerification.visual.state"
                    :tone="latestVerification.visual.state === 'passed' ? 'success' : latestVerification.visual.state === 'failed' ? 'error' : 'neutral'"
                  />
                </header>
                <small v-if="latestVerification.visual.diffRatio !== undefined">
                  {{ latestVerification.visual.diffPixels }} of {{ latestVerification.visual.totalPixels }} pixels differ · {{ (latestVerification.visual.diffRatio * 100).toFixed(3) }}%
                </small>
                <img
                  v-if="latestVerification.visual.diffAvailable"
                  :src="`/api/verifications/${latestVerification.id}/visual-diff`"
                  alt="Visual regression difference map"
                >
              </div>
              <osx-plan v-if="verificationSteps.length" :steps="verificationSteps" label="Verification recipe" compact show-progress />
              <div v-else class="evidence-empty" role="status">
                <span><osx-icon name="list-checks" :size="18" /></span>
                <div><strong>No verification recipe</strong><small>Add a check, service, or browser proof target to make delivery reproducible.</small></div>
              </div>
              <osx-alert
                v-if="latestVerification?.state === 'needs-browser'"
                tone="info"
                title="Prove the visible result"
                :description="verificationBrowserTarget ? `Command checks passed. Open ${verificationBrowserTarget}, then capture its console and network evidence.` : 'Command checks passed. Capture the current task browser page to check its console and network evidence.'"
              />
              <osx-alert
                v-else-if="latestVerification?.state === 'failed'"
                tone="error"
                title="Verification needs attention"
                :description="latestVerification.services.find(item => item.state === 'failed')?.failure ?? latestVerification.checks.find(item => item.state === 'failed')?.failure ?? latestVerification.browserAssertions?.find(item => item.state === 'failed')?.failure ?? latestVerification.visual?.failure ?? latestVerification.browserFailure ?? 'Open the related terminal receipt for details.'"
              />
              <osx-alert v-if="browserError && inspector === 'verify'" tone="error" title="Browser proof not captured" :description="browserError" />
              <div class="verification-actions">
                <osx-button
                  v-if="latestVerification?.state === 'needs-browser'"
                  variant="primary"
                  size="small"
                  icon="camera"
                  :loading="verificationAction === 'browser'"
                  @click="browserMatchesVerificationTarget ? captureVerificationBrowser() : openVerificationBrowser()"
                >
                  {{ browserMatchesVerificationTarget ? 'Capture browser proof' : verificationBrowserTarget ? 'Open verification target' : 'Open task browser' }}
                </osx-button>
                <osx-button
                  v-else-if="!pendingVerificationHandoff"
                  :variant="latestVerification?.state === 'passed' ? 'secondary' : 'primary'"
                  size="small"
                  icon="play"
                  :loading="verificationAction === 'start' || verificationAction === 'rerun'"
                  :disabled="!session || verificationIsActive || (!verificationCanRerun && !verificationHasRecipe)"
                  @click="verificationCanRerun ? rerunVerification() : startVerification()"
                >
                  {{ verificationCanRerun ? 'Rerun exact recipe' : verificationIsActive ? 'Verification running' : 'Run verification' }}
                </osx-button>
                <osx-button
                  v-if="verificationCanStop"
                  variant="secondary"
                  size="small"
                  icon="square"
                  :loading="verificationAction === 'stop'"
                  @click="stopVerification"
                >
                  Stop and tear down
                </osx-button>
                <small v-if="!session">Start a task first so every check can be attached to its receipt.</small>
                <small v-else-if="verificationBrowserTarget">Browser target · {{ verificationBrowserTarget }}</small>
              </div>
            </section>

            <details v-if="verificationRuns.length > 1" class="verification-history">
              <summary>Previous verification · {{ verificationRuns.length - 1 }}</summary>
              <ol>
                <li v-for="run in verificationRuns.slice(1, 6)" :key="run.id">
                  <span><strong>{{ verificationLabel(run) }}</strong><small>{{ new Date(run.createdAt).toLocaleString() }}</small></span>
                  <osx-badge size="small" :label="`${run.checks.filter(item => item.state === 'passed').length}/${run.checks.length}`" :tone="verificationTone(run)" />
                </li>
              </ol>
            </details>
          </div>

          <div v-else-if="inspector === 'terminal'" class="evidence-view terminal-inspector">
            <TerminalWorkbench
              :runs="state.terminalRuns"
              :initial-run-id="selectedTerminalRunId"
              :starting="terminalStarting"
              :error="terminalError"
              @create="ensureUserTerminal(true)"
              @input="sendTerminalData"
              @resize="resizeTerminal"
              @interrupt="interruptTerminal"
            />
          </div>

          <div v-else :class="['evidence-view', 'browser-inspector', { 'details-open': browserDetailsOpen, 'native-browser': desktopBrowserAvailable }]">
            <header class="browser-chrome">
              <nav v-if="state.browser?.tabs.length" class="browser-tabs" aria-label="Browser tabs">
                <div
                  v-for="tab in state.browser.tabs"
                  :key="tab.id"
                  class="browser-tab"
                  :class="{ selected: tab.active }"
                >
                  <button type="button" :disabled="!browserCanNavigate || tab.active" :aria-current="tab.active ? 'page' : undefined" @click="!tab.active && requestBrowserAction('select-tab', { tabId: tab.id })">
                    <osx-icon name="external" :size="13" />
                    <span>{{ tab.title || "New tab" }}</span>
                  </button>
                  <osx-icon-button label="Close tab" icon="close" size="small" :disabled="!browserCanNavigate" @click="requestBrowserAction('close-tab', { tabId: tab.id })" />
                </div>
                <osx-icon-button label="New tab" icon="plus" size="small" :disabled="!browserCanNavigate" @click="requestBrowserAction('new-tab')" />
              </nav>
              <span v-else class="browser-window-label"><osx-icon name="external" :size="14" /> Browser</span>
              <div class="browser-chrome-actions">
                <osx-icon-button :label="browserIsLive ? 'Sync current page' : 'Restore browser'" icon="refresh" size="small" :disabled="!state.browser?.url" @click="requestBrowserAction('capture')" />
                <osx-icon-button v-if="state.browser?.frames?.length" label="Export replay" icon="download" size="small" :disabled="browserReplayExporting" @click="exportBrowserReplay" />
                <osx-icon-button :label="browserDetailsOpen ? 'Hide browser activity' : 'Show browser activity'" icon="list-checks" size="small" :pressed="browserDetailsOpen" :disabled="!state.browser?.url" @click="browserDetailsOpen = !browserDetailsOpen" />
              </div>
            </header>

            <form class="browser-address" @submit.prevent="submitBrowserAddress">
              <div class="browser-history-actions">
                <osx-icon-button label="Back (Option-Left)" icon="chevron-left" size="small" :disabled="!browserCanNavigate || !browserBackAvailable || browserLoading" @click="requestBrowserAction('back')" />
                <osx-icon-button label="Forward (Option-Right)" icon="chevron-right" size="small" :disabled="!browserCanNavigate || !browserForwardAvailable || browserLoading" @click="requestBrowserAction('forward')" />
                <osx-icon-button :label="browserLoading ? 'Loading page' : 'Reload (Command-R)'" :icon="browserLoading ? 'close' : 'refresh'" size="small" :disabled="!browserCanNavigate || !browserUrl || browserLoading" @click="requestBrowserAction('reload')" />
              </div>
              <label class="browser-location">
                <span class="visually-hidden">Address</span>
                <osx-spinner v-if="browserLoading" size="small" label="Loading page" />
                <osx-icon v-else :name="browserLocationIcon" :size="14" />
                <input
                  ref="browserAddressInput"
                  name="browser-address"
                  type="text"
                  inputmode="url"
                  autocomplete="off"
                  autocapitalize="none"
                  spellcheck="false"
                  aria-label="Address"
                  :value="browserUrl"
                  :disabled="!session"
                  placeholder="Enter a URL"
                  @focus="browserAddressEditing = true"
                  @blur="browserAddressEditing = false"
                  @keydown.esc.prevent="restoreBrowserAddress"
                  @input="updateBrowserUrl"
                >
              </label>
            </form>
            <p v-if="browserError" class="browser-error" role="alert"><osx-icon name="warning" :size="13" /> {{ browserError }}</p>

            <section
              v-if="verificationHasRecipe || latestVerification || pendingVerificationHandoff"
              class="browser-verification-studio"
              aria-labelledby="browser-verification-heading"
            >
              <header>
                <span class="browser-verification-icon"><osx-icon name="shield-check" :size="16" /></span>
                <span>
                  <h3 id="browser-verification-heading">Verify this page</h3>
                  <small v-if="latestVerification?.browserEvidence">
                    Captured {{ new Date(latestVerification.browserEvidence.capturedAt).toLocaleTimeString() }} · {{ latestVerification.browserEvidence.consoleErrors }} console · {{ latestVerification.browserEvidence.networkErrors }} network errors
                  </small>
                  <small v-else-if="latestVerification?.state === 'needs-browser'">Command checks passed. Capture the visible page and browser diagnostics.</small>
                  <small v-else>{{ verificationBrowserTarget ?? 'Use the current page as retained verification evidence.' }}</small>
                </span>
                <osx-badge
                  size="small"
                  :label="latestVerification ? verificationLabel(latestVerification) : 'Ready'"
                  :tone="latestVerification ? verificationTone(latestVerification) : 'neutral'"
                />
              </header>
              <div class="browser-verification-progress">
                <span><strong>{{ latestVerification?.checks.filter(item => item.state === 'passed').length ?? 0 }}/{{ latestVerification?.checks.length ?? state.projectDoctor?.verificationChecks.length ?? 0 }}</strong><small>checks passed</small></span>
                <span><strong>{{ latestVerification?.browserAssertions.filter(item => item.state === 'passed').length ?? 0 }}/{{ latestVerification?.browserAssertions.length ?? state.projectDoctor?.verificationBrowserAssertions?.length ?? 0 }}</strong><small>page assertions</small></span>
                <span><strong>{{ latestVerification?.browserEvidence?.actionCount ?? state.browser?.actions.length ?? 0 }}</strong><small>retained actions</small></span>
              </div>
              <footer>
                <osx-button
                  v-if="latestVerification?.state === 'needs-browser'"
                  variant="primary"
                  size="small"
                  icon="camera"
                  :loading="verificationAction === 'browser'"
                  @click="browserMatchesVerificationTarget ? captureVerificationBrowser() : openVerificationBrowser()"
                >
                  {{ browserMatchesVerificationTarget ? 'Capture proof' : 'Open target' }}
                </osx-button>
                <osx-button
                  v-else
                  :variant="latestVerification?.state === 'passed' ? 'secondary' : 'primary'"
                  size="small"
                  icon="play"
                  :loading="verificationAction === 'start' || verificationAction === 'rerun'"
                  :disabled="verificationIsActive || (!verificationCanRerun && !verificationHasRecipe)"
                  @click="verificationCanRerun ? rerunVerification() : startVerification()"
                >
                  {{ verificationCanRerun ? 'Rerun recipe' : verificationIsActive ? 'Checks running' : 'Run checks' }}
                </osx-button>
                <osx-button v-if="verificationCanStop" size="small" variant="secondary" icon="square" :loading="verificationAction === 'stop'" @click="stopVerification">Stop</osx-button>
              </footer>
            </section>

            <section v-if="selectedBrowserControl" class="browser-control-action" aria-label="Selected page control">
              <span>
                <code>{{ selectedBrowserControl.ref }}</code>
                <span><strong>{{ selectedBrowserControl.label }}</strong><small>{{ selectedBrowserControl.kind }}</small></span>
              </span>
              <template v-if="selectedBrowserControl.action === 'type'">
                <osx-text-field
                  :label="selectedBrowserControl.kind === 'combobox' ? 'Option value' : 'Text to type'"
                  name="browser-text"
                  :type="selectedBrowserControl.sensitive ? 'password' : 'text'"
                  :placeholder="selectedBrowserControl.sensitive ? 'Value stays out of receipts' : 'Enter text'"
                  :value="browserText"
                  :disabled="!browserIsLive"
                  @input="updateBrowserText"
                />
                <osx-button variant="primary" size="small" :disabled="!browserIsLive || !browserText" @click="requestBrowserAction('type')">
                  {{ selectedBrowserControl.kind === "combobox" ? "Choose" : "Type" }}
                </osx-button>
              </template>
              <osx-button v-else variant="primary" size="small" :disabled="!browserIsLive" @click="requestBrowserAction('click')">Click</osx-button>
              <osx-icon-button label="Clear selected control" icon="close" size="small" @click="selectedBrowserControlRef = ''" />
            </section>

            <section v-if="desktopBrowserAvailable && session && (!state.browser || browserIsLive)" class="browser-live-frame" aria-label="Live embedded browser">
              <div ref="browserLiveSurface" class="browser-live-surface" />
            </section>

            <figure v-else-if="browserScreenshot" class="browser-frame">
              <div class="browser-stage">
                <img :src="browserScreenshot" :alt="`Captured page ${state.browser?.title || state.browser?.url}`">
                <button
                  v-for="control in state.browser?.controls.slice(0, 36)"
                  :key="control.ref"
                  type="button"
                  class="browser-marker"
                  :class="{ selected: selectedBrowserControlRef === control.ref }"
                  :style="browserMarkerStyle(control)"
                  :aria-label="`Choose ${control.ref}, ${control.label}`"
                  @click="selectBrowserControl(control)"
                >
                  {{ control.ref }}
                </button>
              </div>
              <figcaption>
                <span><strong>{{ state.browser?.title || "Untitled page" }}</strong><small>{{ browserIsLive ? "Connected" : "Retained after restart" }}</small></span>
                <span>{{ state.browser?.controls.length ?? 0 }} controls · synced {{ state.browser?.updatedAt ? new Date(state.browser.updatedAt).toLocaleTimeString() : "now" }}</span>
              </figcaption>
            </figure>

            <section v-if="browserDetailsOpen && state.browser?.url" class="browser-details-panel" aria-label="Browser activity and evidence">
              <section class="browser-control-map" aria-labelledby="browser-control-map-heading">
                <header>
                  <span>
                    <strong id="browser-control-map-heading">Interactive controls</strong>
                    <small>{{ browserIsLive ? "Select a control here or directly on the page." : "Restore the browser before acting on retained controls." }}</small>
                  </span>
                  <osx-badge :label="`${state.browser.controls.length} found`" tone="info" size="small" />
                </header>
                <div v-if="state.browser.controls.length" class="browser-control-list" role="listbox" aria-label="Visible page controls">
                  <button
                    v-for="control in state.browser.controls"
                    :key="control.ref"
                    type="button"
                    role="option"
                    class="browser-control-row"
                    :class="{ selected: selectedBrowserControlRef === control.ref }"
                    :aria-selected="selectedBrowserControlRef === control.ref"
                    :disabled="control.disabled"
                    @click="selectBrowserControl(control)"
                  >
                    <code>{{ control.ref }}</code>
                    <osx-icon :name="browserControlIcon(control)" :size="14" />
                    <span><strong>{{ control.label }}</strong><small>{{ control.kind }} · {{ control.action }}</small></span>
                    <osx-icon name="chevron-right" :size="14" />
                  </button>
                </div>
                <div v-else class="browser-control-empty" role="status">No visible controls on this page.</div>
              </section>

              <details v-if="state.browser?.snapshot" class="browser-evidence-details">
                <summary>Agent-visible page context</summary>
                <pre>{{ state.browser.snapshot }}</pre>
              </details>
              <details v-if="state.browser?.console.length" class="browser-evidence-details">
                <summary>Console · {{ state.browser.console.length }}</summary>
                <ul>
                  <li v-for="entry in state.browser.console" :key="entry.id" :class="entry.level">
                    <span>{{ entry.level }}</span>{{ entry.text }}
                  </li>
                </ul>
              </details>
              <details v-if="state.browser?.network.length" class="browser-evidence-details browser-network-history">
                <summary>Network · {{ state.browser.network.length }}</summary>
                <ol>
                  <li v-for="entry in state.browser.network" :key="entry.id" :class="entry.state">
                    <code>{{ entry.status ?? entry.state }}</code>
                    <span><strong>{{ entry.method }} · {{ entry.resourceType }}</strong><small>{{ entry.url }}</small></span>
                    <small>{{ entry.durationMs !== undefined ? `${entry.durationMs}ms` : '' }}</small>
                  </li>
                </ol>
              </details>
              <section v-if="selectedBrowserAction && (selectedBrowserAction.beforeFrameId || selectedBrowserAction.afterFrameId)" class="browser-action-replay" aria-label="Browser action replay">
                <header>
                  <span><strong>{{ selectedBrowserAction.action }} comparison</strong><small>{{ selectedBrowserAction.target }}</small></span>
                  <osx-badge size="small" :label="selectedBrowserAction.actor === 'agent' ? 'Agent action' : 'Your action'" tone="info" />
                </header>
                <div class="browser-action-frames">
                  <figure v-if="selectedBrowserAction.beforeFrameId">
                    <img :src="browserFrameUrl(selectedBrowserAction.beforeFrameId)" alt="Page immediately before the browser action">
                    <figcaption>Before</figcaption>
                  </figure>
                  <figure v-if="selectedBrowserAction.afterFrameId">
                    <img :src="browserFrameUrl(selectedBrowserAction.afterFrameId)" alt="Page immediately after the browser action">
                    <figcaption>After</figcaption>
                  </figure>
                </div>
              </section>
              <details
                v-if="state.browser?.actions.length"
                class="browser-evidence-details browser-action-history"
                :open="focusedEvidence?.kind === 'browser'"
              >
                <summary>Action receipts · {{ state.browser.actions.length }}</summary>
                <ol>
                  <li
                    v-for="action in state.browser.actions"
                    :id="evidenceDomId('browser', action.id)"
                    :key="action.id"
                    :class="[action.status, { selected: selectedBrowserAction?.id === action.id }]"
                  >
                    <button type="button" :disabled="!action.beforeFrameId && !action.afterFrameId" @click="selectedBrowserActionId = action.id">
                      <osx-icon :name="action.status === 'success' ? 'check' : 'warning'" :size="13" />
                      <span><strong>{{ action.action }}</strong><small>{{ action.actor === 'agent' ? 'Agent' : 'You' }} · {{ action.target }} · {{ new Date(action.timestamp).toLocaleTimeString() }}</small></span>
                      <small>{{ action.beforeFrameId || action.afterFrameId ? "Compare" : "No frame" }}</small>
                    </button>
                  </li>
                </ol>
              </details>
            </section>

            <footer v-if="state.browser?.url" class="browser-context-status">
              <span>
                <osx-icon name="sparkle" :size="14" />
                <span><strong>Shared with the agent</strong><small>The current page, visible text, and mapped controls are included with your next message.</small></span>
              </span>
              <osx-badge size="small" :label="browserIsLive ? 'Connected' : 'Retained'" :tone="browserIsLive ? 'success' : 'warning'" />
            </footer>

            <div v-if="!state.browser?.url && !desktopBrowserAvailable" class="evidence-empty" role="status">
              <span><osx-icon name="eye" :size="18" /></span>
              <div><strong>Preview your app</strong><small>Open a local URL to browse with the agent. Vraxis shares visible context, requests approval before actions, and retains what happened.</small></div>
            </div>
          </div>
        </section>
      </aside>

      <osx-status-bar
        slot="status"
        :status="settingsSaving || sessionIsRunning ? 'working' : serviceOnline ? 'ready' : 'offline'"
        :label="settingsSaving ? 'Saving settings' : sessionIsRunning ? 'Agent working' : serviceOnline ? 'Ready' : 'Offline'"
        :detail="activeView === 'settings'
          ? settingsError ? 'Previous settings restored' : 'Saved on this device'
          : session?.worktree?.status === 'applied'
            ? `Applied to ${project?.branch ?? 'project'} · checkpoint ${session.worktree.branch}`
            : session?.worktree
              ? `${session.worktree.branch} from ${session.worktree.baseBranch}`
              : sessionIsRunning ? 'Read-only project access' : project ? project.path : ''"
      />
    </osx-app-shell>

    <osx-dialog
      :open="Boolean(pendingAttachmentHandoff)"
      title="Send external files?"
      :description="`These file snapshots will be provided to ${pendingHandoffDestination}.`"
      size="small"
      confirm-label="Send files"
      cancel-label="Keep editing"
      dismissible
      @close="closeAttachmentHandoff"
      @confirm="confirmAttachmentHandoff"
    >
      <div class="attachment-handoff">
        <p>Only the files listed here are shared. Their original locations are not exposed.</p>
        <ul aria-label="External files to send">
          <li v-for="attachment in pendingImportedAttachments" :key="attachment.id">
            <osx-icon :name="attachment.mediaType?.startsWith('image/') ? 'image' : 'file'" :size="15" />
            <span><strong>{{ attachment.name }}</strong><small>{{ attachment.mediaType || "File" }} · {{ attachmentSizeLabel(attachment.size) }}</small></span>
          </li>
        </ul>
      </div>
    </osx-dialog>

    <osx-toast
      :open="Boolean(registrationError)"
      tone="error"
      title="Project not opened"
      :message="registrationError"
      placement="bottom-right"
      dismissible
      @dismiss="registrationError = ''"
    />
  </main>
</template>
