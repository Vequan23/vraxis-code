export const contractVersion = 27 as const;

export const sessionModes = ["ask", "plan", "build", "review"] as const;
export type SessionMode = (typeof sessionModes)[number];

export interface ModeAgentProfile {
  mode: SessionMode;
  title: string;
  description: string;
  access: "read-only" | "isolated-worktree";
  skillNames: readonly string[];
  toolIds: readonly string[];
  guardedToolIds: readonly string[];
}

const repositoryReadTools = [
  "list-directory",
  "find-files",
  "read-text",
  "search-text",
  "git-status",
  "git-diff",
  "git-log",
  "git-show",
] as const;

const browserEvidenceTools = [
  "browser-snapshot",
  "browser-console",
  "browser-network",
  "browser-screenshot",
  "browser-wait",
] as const;

const browserControlTools = [
  "browser-navigate",
  "browser-click",
  "browser-type",
] as const;

export const modeAgentProfiles: Readonly<Record<SessionMode, ModeAgentProfile>> = {
  ask: {
    mode: "ask",
    title: "Repository answers",
    description: "Understand the project and answer with file-backed evidence.",
    access: "read-only",
    skillNames: ["Repository comprehension", "General utilities"],
    toolIds: ["calculate", "date-time", "evidence-status", "request-verification", ...repositoryReadTools, ...browserEvidenceTools],
    guardedToolIds: ["http-fetch", ...browserControlTools],
  },
  plan: {
    mode: "plan",
    title: "Implementation planning",
    description: "Map the architecture and produce an actionable plan without changing files.",
    access: "read-only",
    skillNames: ["Repository comprehension", "Project architecture", "General utilities"],
    toolIds: ["calculate", "date-time", "evidence-status", "request-verification", ...repositoryReadTools, ...browserEvidenceTools],
    guardedToolIds: ["http-fetch", ...browserControlTools],
  },
  build: {
    mode: "build",
    title: "Isolated implementation",
    description: "Implement, debug, and verify changes inside a dedicated worktree.",
    access: "isolated-worktree",
    skillNames: ["Repository comprehension", "Workspace editing", "Software verification", "Software debugging", "Dependency management", "Frontend verification"],
    toolIds: [
      "calculate",
      "date-time",
      "evidence-status",
      "request-verification",
      ...repositoryReadTools,
      ...browserEvidenceTools,
    ],
    guardedToolIds: [
      "create-text",
      "apply-text-edits",
      "apply-workspace-patch",
      "create-directory",
      "move-path",
      "remove-path",
      "terminal-run",
      "terminal-poll",
      "terminal-stop",
      "http-fetch",
      ...browserControlTools,
    ],
  },
  review: {
    mode: "review",
    title: "Code and security review",
    description: "Inspect changes, history, regressions, and trust boundaries without editing.",
    access: "read-only",
    skillNames: ["Repository comprehension", "Code review", "Security review", "General utilities"],
    toolIds: ["calculate", "date-time", "evidence-status", "request-verification", ...repositoryReadTools, ...browserEvidenceTools],
    guardedToolIds: ["http-fetch", ...browserControlTools],
  },
};

export function modeAgentProfile(mode: SessionMode): ModeAgentProfile {
  return modeAgentProfiles[mode];
}

export const appThemes = ["graphite-dark", "panther", "aqua", "graphite"] as const;
export type AppTheme = (typeof appThemes)[number];

export const inspectorViews = ["files", "changes", "verify", "terminal", "browser"] as const;
export type InspectorView = (typeof inspectorViews)[number];

export const modelProviderIds = ["openai", "anthropic", "google", "deepseek", "zai", "openrouter", "groq", "openai-compatible"] as const;
export type ModelProviderId = (typeof modelProviderIds)[number];
export type ModelCapability = "text" | "vision" | "audio" | "video" | "tools" | "structured-output" | "reasoning";

export interface UserSettings {
  theme: AppTheme;
  defaultMode: SessionMode;
  authorityMode?: AuthorityMode;
  defaultRuntimeId?: string;
  runtimeModels?: Record<string, string>;
  disabledRuntimeIds?: string[];
}

export const defaultUserSettings: UserSettings = {
  theme: "graphite-dark",
  defaultMode: "ask",
  authorityMode: "supervised",
};

export const authorityModes = ["supervised", "trusted-worktree", "full-access"] as const;
export type AuthorityMode = (typeof authorityModes)[number];

export interface TaskSettlementSummary {
  state: "running" | "complete" | "failed" | "interrupted" | "recovery-needed";
  attempt: number;
  startedAt: string;
  settledAt?: string;
  reason?: string;
  resumable: boolean;
}

export const steeringDeliveries = ["queue", "redirect"] as const;
export type SteeringDelivery = (typeof steeringDeliveries)[number];

export interface SessionSteeringSummary {
  state: "queued" | "redirecting";
  pendingCount: number;
  updatedAt: string;
}

export interface ProjectSummary {
  id: string;
  name: string;
  path: string;
  branch: string;
  status: "ready" | "missing" | "permission-revoked";
}

export interface SessionSummary {
  id: string;
  projectId: string;
  title: string;
  mode: SessionMode;
  runtimeId: string;
  modelId?: string;
  updatedAt: string;
  status: "idle" | "running" | "interrupted" | "failed";
  settlement?: TaskSettlementSummary;
  steering?: SessionSteeringSummary;
  worktree?: WorktreeSummary;
  worktreeHistory?: WorktreeSummary[];
}

export interface WorktreeSummary {
  id: string;
  path: string;
  branch: string;
  baseBranch: string;
  baseCommit: string;
  status: "active" | "applying" | "applied" | "conflicted" | "archived" | "reverted" | "cleaned" | "missing" | "stale";
  checkpointCommit?: string;
  appliedAt?: string;
  archivedAt?: string;
  archivedFrom?: "active" | "applied" | "conflicted" | "reverted";
  revertedAt?: string;
  cleanedAt?: string;
  conflict?: string;
  conflicts?: WorktreeConflictSummary[];
  appliedPaths?: string[];
  applyingPaths?: string[];
  appliedHunks?: Record<string, string[]>;
  applyingHunks?: WorktreeHunkSelection[];
}

export interface WorktreeHunkSelection {
  path: string;
  hunkIds: string[];
}

export interface WorktreeConflictSummary {
  path: string;
  hunkIds?: string[];
  detail: string;
}

export interface RuntimeSummary {
  id: string;
  name: string;
  availability: "missing" | "installed" | "setup-required";
  detail: string;
  acceptsCustomModel: boolean;
  models: RuntimeModelSummary[];
  kind?: "local-cli" | "hosted-provider";
  providerProfileId?: string;
  version?: string;
  executable?: string;
  applicationPath?: string;
  authentication?: "authenticated" | "required" | "unknown" | "not-required";
  authenticationDetail?: string;
  checkedAt?: string;
  modelDiscovery?: "automatic" | "aliases" | "manual" | "unavailable";
  update?: RuntimeUpdateSummary;
  maintenanceActions?: RuntimeMaintenanceActionSummary[];
  capabilities?: string[];
  productCapabilities?: RuntimeProductCapabilitySummary[];
  conformance?: RuntimeConformanceSummary;
}

export interface RuntimeConformanceSummary {
  state: "unverified" | "ready" | "limited" | "failed" | "stale";
  runtimeVersion?: string;
  checkedAt?: string;
  durationMs?: number;
  detail: string;
  checks: RuntimeConformanceCheckSummary[];
}

export interface RuntimeConformanceCheckSummary {
  id: "adapter-contract" | "host-tool-isolation" | "live-output";
  label: string;
  state: "passed" | "failed" | "not-checked";
  detail: string;
}

export interface RuntimeMaintenanceActionSummary {
  id: "install" | "authenticate" | "update";
  label: string;
  detail: string;
  kind: "command" | "documentation";
  executable?: string;
  arguments?: string[];
  url?: string;
  requiresNetwork: boolean;
}

export type RuntimeProductCapabilityId =
  | "repository-read"
  | "isolated-build"
  | "governed-terminal"
  | "controlled-browser"
  | "steerable-task"
  | "task-evidence"
  | "skills"
  | "model-catalog"
  | "retained-verification";

export interface RuntimeProductCapabilitySummary {
  id: RuntimeProductCapabilityId;
  label: string;
  state: "available" | "limited" | "unavailable";
  detail: string;
}

export interface RuntimeUpdateSummary {
  status: "available" | "current" | "unknown";
  latestVersion?: string;
  checkedAt?: string;
  detail: string;
}

export interface RuntimeModelSummary {
  id: string;
  name: string;
  availability: "available" | "unverified" | "missing";
  capabilities?: ModelCapability[];
  contextWindow?: number;
  maxOutputTokens?: number;
  description?: string;
  isDefault?: boolean;
  reasoningEfforts?: string[];
}

export interface ModelProviderSummary {
  id: string;
  name: string;
  provider: ModelProviderId;
  model: string;
  baseURL?: string;
  credentialConfigured: boolean;
  models: RuntimeModelSummary[];
  fetchedAt?: string;
}

export const mcpTransportIds = ["stdio", "streamable-http"] as const;
export type McpTransportId = (typeof mcpTransportIds)[number];
export const mcpCredentialKinds = ["none", "bearer", "header", "environment"] as const;
export type McpCredentialKind = (typeof mcpCredentialKinds)[number];

export interface McpCapabilitySummary {
  name: string;
  title?: string;
  description?: string;
}

export interface McpServerSummary {
  id: string;
  name: string;
  transport: McpTransportId;
  target: string;
  projectIds: string[];
  credentialConfigured: boolean;
  credentialKind: McpCredentialKind;
  status: "connected" | "needs-attention";
  serverName?: string;
  serverVersion?: string;
  protocolVersion?: string;
  protocolEra?: "legacy" | "modern";
  tools: McpCapabilitySummary[];
  resources: McpCapabilitySummary[];
  prompts: McpCapabilitySummary[];
  warnings: string[];
  connectedAt?: string;
  error?: string;
}

export interface WorkspaceFile {
  path: string;
  status?: WorkspaceChangeStatus;
}

export type WorkspaceChangeStatus = "added" | "modified" | "deleted" | "renamed" | "untracked";

export interface WorkspaceChange {
  path: string;
  status: WorkspaceChangeStatus;
  previousPath?: string;
}

export interface WorkspaceDiff {
  path: string;
  patch: string;
  language: string;
  additions: number;
  deletions: number;
  binary: boolean;
  partialSelection: boolean;
  hunks: WorkspaceDiffHunk[];
}

export interface WorkspaceDiffHunk {
  id: string;
  header: string;
  additions: number;
  deletions: number;
}

export interface WorkspaceFileContent {
  path: string;
  content: string;
  language: string;
  truncated: boolean;
}

export const promptAttachmentLimits = {
  maximumCount: 5,
  maximumBytes: 5 * 1024 * 1024,
} as const;

export interface PromptAttachment {
  id: string;
  name: string;
  path: string;
  source?: "project" | "imported";
  mediaType?: string;
  size?: number;
}

export const promptSkillLimits = {
  maximumCount: 8,
} as const;

export type SkillScope = "user" | "project" | "plugin" | "configured";

export interface SkillSummary {
  id: string;
  name: string;
  description: string;
  version: string;
  scopes: SkillScope[];
  runtimes: string[];
}

export interface SkillReference {
  id: string;
  name: string;
  version: string;
}

export interface AttachmentHandoffConsent {
  attachmentIds: string[];
  runtimeId: string;
  modelId?: string;
  confirmed: true;
}

export interface ActivityEvent {
  id: string;
  sessionId: string;
  sequence: number;
  timestamp: string;
  runtimeId: string;
  kind: "message" | "progress" | "tool" | "approval" | "verification" | "telemetry" | "lifecycle";
  title: string;
  detail: string;
  state: "pending" | "running" | "complete" | "failed" | "denied" | "interrupted";
  actor?: "user" | "agent" | "system";
  attachments?: PromptAttachment[];
  skills?: SkillReference[];
  steering?: {
    delivery: SteeringDelivery;
    state: "queued" | "running" | "handled" | "superseded";
  };
}

export type ApprovalCapability = "write" | "command" | "network" | "browser" | "credentials" | "destructive" | "other";
export const approvalCapabilities: ApprovalCapability[] = ["write", "command", "network", "browser", "credentials", "destructive", "other"];
export type ApprovalRisk = "low" | "medium" | "high";
export type ApprovalState = "pending" | "approved" | "denied" | "executing" | "completed" | "failed" | "interrupted";
export type ApprovalRuleEffect = "deny" | "ask" | "allow";
export type ApprovalDuration = "once" | "session" | "project";

export interface ApprovalSummary {
  id: string;
  sessionId: string;
  projectId?: string;
  requestedAt: string;
  resolvedAt?: string;
  capability: ApprovalCapability;
  title: string;
  description: string;
  scope: string;
  risk: ApprovalRisk;
  state: ApprovalState;
  source: "agent" | "terminal" | "browser" | "worktree" | "mcp";
  actor?: "user" | "agent" | "system";
  boundary?: "read-only-project" | "isolated-worktree" | "controlled-browser" | "approved-project" | "external-server";
  authority?: {
    mode: AuthorityMode;
    decision: "pending" | "explicit" | "remembered" | "automatic" | "policy-denied";
    reason: string;
  };
  failure?: string;
  matchedRuleId?: string;
  rememberable?: boolean;
  teamPolicy?: {
    artifactId: string;
    policyId: string;
    organization: string;
    ruleId: string;
    effect: "ask" | "deny";
  };
}

export interface ApprovalRuleSummary {
  id: string;
  projectId: string;
  sessionId?: string;
  effect: Exclude<ApprovalRuleEffect, "ask">;
  duration: Exclude<ApprovalDuration, "once">;
  capability: ApprovalCapability;
  source: ApprovalSummary["source"];
  scope: string;
  createdAt: string;
  revokedAt?: string;
}

export interface ApprovalPolicyAuditV1 {
  kind: "vraxis.approval-policy-audit";
  version: 1;
  generatedAt: string;
  summary: {
    active: number;
    revoked: number;
    allowed: number;
    denied: number;
  };
  rules: ApprovalRuleSummary[];
  teamPolicy?: TeamPolicySummary;
}

export interface ApprovalDecisionRequest {
  decision: "approve" | "deny";
  duration?: ApprovalDuration;
}

export interface WorktreeActionRequest {
  action: "archive" | "restore" | "revert" | "cleanup";
}

export interface TerminalRunSummary {
  id: string;
  sessionId: string;
  approvalId: string;
  purpose?: "task" | "user-shell";
  label?: string;
  command: string;
  cwd: string;
  status: "pending" | "running" | "success" | "error" | "interrupted";
  output: string;
  exitCode?: number;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  outputTruncated?: boolean;
  lastOutputAt?: string;
  terminalKind?: "process" | "pty";
  columns?: number;
  rows?: number;
  outputVersion?: number;
}

export type VerificationCheckCategory = "lint" | "typecheck" | "test" | "build" | "check";
export type VerificationCheckState = "pending" | "awaiting-approval" | "running" | "passed" | "failed" | "skipped";
export type VerificationServiceState = "pending" | "awaiting-approval" | "starting" | "healthy" | "failed" | "stopped";
export type VerificationRunState = "ready" | "running" | "needs-browser" | "passed" | "failed" | "interrupted";

export interface ProjectDoctorSummary {
  schemaVersion: 1;
  projectId: string;
  projectName: string;
  projectKind: "single-package" | "workspace" | "polyglot" | "unknown";
  packageManager?: { id: "npm" | "pnpm" | "yarn" | "bun"; name: string; lockfile?: string; version?: string };
  ecosystems: { id: "javascript" | "python" | "rust" | "go"; label: string; manifest: string }[];
  frameworks: { id: string; name: string; ecosystem: "javascript" | "python" | "rust" | "go" }[];
  verificationChecks: VerificationCheckDefinition[];
  verificationServices?: VerificationServiceDefinition[];
  verificationBrowserAssertions?: VerificationBrowserAssertionDefinition[];
  verificationVisual?: VerificationVisualDefinition;
  verificationSource?: {
    kind: "discovered" | "project";
    path?: string;
    browserRequired: boolean;
    browserTarget?: string;
  };
  devServers: { id: string; title: string; command: string; args: string[]; cwd: string; suggestedUrl?: string; source: string }[];
  issues: { severity: "info" | "warning" | "error"; code: string; message: string; remediation?: string }[];
  ok: boolean;
}

export interface VerificationCheckDefinition {
  id: string;
  title: string;
  category: VerificationCheckCategory;
  command: string;
  args: string[];
  cwd: string;
  required: boolean;
  timeoutMs: number;
  source: string;
}

export interface VerificationCheckSummary extends VerificationCheckDefinition {
  state: VerificationCheckState;
  approvalId?: string;
  terminalRunId?: string;
  startedAt?: string;
  completedAt?: string;
  failure?: string;
}

export interface VerificationServiceDefinition {
  id: string;
  title: string;
  command: string;
  args: string[];
  cwd: string;
  health: {
    url: string;
    expectedStatus: number;
    timeoutMs: number;
    intervalMs: number;
  };
  source: string;
}

export interface VerificationServiceSummary extends VerificationServiceDefinition {
  state: VerificationServiceState;
  approvalId?: string;
  terminalRunId?: string;
  startedAt?: string;
  healthyAt?: string;
  stoppedAt?: string;
  healthAttempts: number;
  lastHealthStatus?: number;
  failure?: string;
}

export interface VerificationBrowserAssertionDefinition {
  id: string;
  title: string;
  kind: "url" | "title" | "text";
  match: "equals" | "contains";
  value: string;
  caseSensitive: boolean;
  source: string;
}

export interface VerificationBrowserAssertionSummary extends VerificationBrowserAssertionDefinition {
  state: "pending" | "passed" | "failed";
  actual?: string;
  failure?: string;
}

export interface VerificationVisualDefinition {
  baselinePath: string;
  maxDiffRatio: number;
  source: string;
}

export interface VerificationVisualSummary extends VerificationVisualDefinition {
  state: "pending" | "passed" | "failed";
  width?: number;
  height?: number;
  diffPixels?: number;
  totalPixels?: number;
  diffRatio?: number;
  diffAvailable?: boolean;
  failure?: string;
}

export interface VerificationRunSummary {
  id: string;
  sessionId: string;
  projectId: string;
  projectName: string;
  state: VerificationRunState;
  changedPaths: string[];
  services: VerificationServiceSummary[];
  checks: VerificationCheckSummary[];
  browserAssertions: VerificationBrowserAssertionSummary[];
  visual?: VerificationVisualSummary;
  browserRecommended: boolean;
  browserState: "not-required" | "pending" | "passed" | "failed";
  browserTarget?: string;
  recipeFingerprint: string;
  rerunOfId?: string;
  browserActionId?: string;
  browserFailure?: string;
  browserEvidence?: {
    url: string;
    title: string;
    capturedAt: string;
    screenshotVersion: number;
    consoleErrors: number;
    networkErrors: number;
    actionCount: number;
  };
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

export interface VerificationHandoffSummary {
  id: string;
  sessionId: string;
  state: "requested" | "accepted" | "dismissed";
  requestedAt: string;
  requestedBy: {
    actor: "agent";
    runtimeId: string;
    modelId?: string;
  };
  note?: string;
  resolvedAt?: string;
  verificationRunId?: string;
}

export interface BrowserConsoleEntry {
  id: string;
  timestamp: string;
  level: "debug" | "info" | "warning" | "error";
  text: string;
}

export interface BrowserNetworkEntry {
  id: string;
  timestamp: string;
  method: string;
  url: string;
  resourceType: string;
  state: "pending" | "success" | "error" | "blocked";
  status?: number;
  durationMs?: number;
  failure?: string;
}

export interface BrowserTabSummary {
  id: string;
  title: string;
  url: string;
  active: boolean;
}

export interface BrowserControlSummary {
  ref: string;
  kind: "button" | "link" | "textbox" | "checkbox" | "radio" | "combobox" | "control";
  label: string;
  action: "click" | "type";
  disabled: boolean;
  sensitive: boolean;
  bounds: { x: number; y: number; width: number; height: number };
}

export interface BrowserActionSummary {
  id: string;
  action: BrowserActionRequest["action"];
  target: string;
  status: "success" | "error";
  timestamp: string;
  detail: string;
  actor?: "user" | "agent";
  approvalId?: string;
  screenshotVersion?: number;
  beforeFrameId?: string;
  afterFrameId?: string;
}

export interface BrowserActionFrameSummary {
  id: string;
  actionId: string;
  phase: "before" | "after";
  url: string;
  title: string;
  timestamp: string;
  screenshotVersion: number;
}

export interface BrowserSessionSummary {
  sessionId: string;
  status: "closed" | "opening" | "ready" | "error";
  url: string;
  title: string;
  snapshot: string;
  screenshotVersion: number;
  viewport: { width: number; height: number };
  activeTabId: string;
  loading?: boolean;
  canGoBack?: boolean;
  canGoForward?: boolean;
  tabs: BrowserTabSummary[];
  controls: BrowserControlSummary[];
  allowedOrigins: string[];
  console: BrowserConsoleEntry[];
  network: BrowserNetworkEntry[];
  actions: BrowserActionSummary[];
  frames?: BrowserActionFrameSummary[];
  updatedAt: string;
  error?: string;
}

export interface StartupRecoverySummary {
  previousUnexpectedExit: boolean;
  previousStartedAt?: string;
  checkedAt: string;
}

export interface BootstrapState {
  contractVersion: typeof contractVersion;
  realtime?: {
    sessionEvents: boolean;
    terminalOutput: boolean;
    reconnectSnapshots: boolean;
  };
  projects: ProjectSummary[];
  sessions: SessionSummary[];
  runtimes: RuntimeSummary[];
  modelProviders: ModelProviderSummary[];
  mcpServers: McpServerSummary[];
  skills: SkillSummary[];
  selectedProjectId?: string;
  selectedSessionId?: string;
  files: WorkspaceFile[];
  changes: WorkspaceChange[];
  events: ActivityEvent[];
  approvals: ApprovalSummary[];
  approvalRules?: ApprovalRuleSummary[];
  terminalRuns: TerminalRunSummary[];
  projectDoctor?: ProjectDoctorSummary;
  verificationRuns?: VerificationRunSummary[];
  verificationHandoffs?: VerificationHandoffSummary[];
  browser?: BrowserSessionSummary;
  startupRecovery?: StartupRecoverySummary;
  settings: UserSettings;
}

export interface SessionEventsResponse {
  session: SessionSummary;
  events: ActivityEvent[];
}

export interface SessionMutationResponse extends SessionSummary {
  events: ActivityEvent[];
}

export interface WorkspaceEvidenceResponse {
  files: WorkspaceFile[];
  changes: WorkspaceChange[];
  worktree?: WorktreeSummary;
}

export interface SessionLiveEvidenceResponse {
  approvals: ApprovalSummary[];
  approvalRules?: ApprovalRuleSummary[];
  terminalRuns: TerminalRunSummary[];
  verificationRuns?: VerificationRunSummary[];
  verificationHandoffs?: VerificationHandoffSummary[];
  browser?: BrowserSessionSummary;
}

export interface SessionStreamPayload {
  session: SessionSummary;
  events: ActivityEvent[];
  evidence: SessionLiveEvidenceResponse;
  cursor: number;
}

export interface TaskReceiptV1 {
  kind: "vraxis.task-receipt";
  version: 1;
  generatedAt: string;
  session: Pick<SessionSummary, "id" | "title" | "mode" | "status" | "runtimeId" | "modelId" | "updatedAt">;
  settlement?: TaskSettlementSummary;
  project: Pick<ProjectSummary, "id" | "name" | "branch">;
  worktree?: WorktreeSummary;
  worktreeHistory?: WorktreeSummary[];
  changes: WorkspaceChange[];
  approvals: ApprovalSummary[];
  terminalRuns: TerminalRunSummary[];
  verificationRuns?: VerificationRunSummary[];
  verificationHandoffs?: VerificationHandoffSummary[];
  browser?: Pick<BrowserSessionSummary, "url" | "title" | "viewport" | "actions" | "console" | "network">;
  activity: ActivityEvent[];
}

export interface TaskProofIntegrityV1 {
  algorithm: "Ed25519";
  canonicalization: "vraxis-json-c14n-v1";
  digestAlgorithm: "SHA-256";
  digest: string;
  signature: string;
  publicKey: string;
  publicKeyFormat: "spki-base64";
  keyId: string;
}

export type TeamPolicyEffect = "ask" | "deny";

export interface TeamPolicyRuleV1 {
  id: string;
  capability: ApprovalCapability;
  effect: TeamPolicyEffect;
  reason: string;
}

export interface TeamPolicyPayloadV1 {
  kind: "vraxis.team-policy";
  version: 1;
  policyId: string;
  organization: string;
  issuedAt: string;
  expiresAt?: string;
  rules: TeamPolicyRuleV1[];
}

export interface TeamPolicyBundleV1 extends TeamPolicyPayloadV1 {
  artifactId: string;
  integrity: TaskProofIntegrityV1;
}

export interface TeamPolicyCreateRequest {
  organization: string;
  expiresAt?: string;
  rules: Array<Pick<TeamPolicyRuleV1, "capability" | "effect">>;
}

export interface TeamPolicySummary extends TeamPolicyPayloadV1 {
  artifactId: string;
  signerKeyId: string;
  signerLabel: string;
  status: "active" | "expired" | "untrusted";
}

export interface TeamPolicyState {
  status: "none" | TeamPolicySummary["status"];
  policy?: TeamPolicySummary;
}

export type TaskEvidenceKindV1 = "change" | "terminal" | "approval" | "browser";

export interface TaskEvidenceLinkV1 {
  kind: TaskEvidenceKindV1;
  target: string;
  label: string;
  deepLink: string;
}

export interface TaskProofEnvelopeV1 {
  kind: "vraxis.task-proof";
  version: 1;
  generatedAt: string;
  deepLink: string;
  evidenceLinks?: TaskEvidenceLinkV1[];
  artifactId: string;
  receipt: TaskReceiptV1;
  integrity: TaskProofIntegrityV1;
}

export type UnderstandGroundingState = "verified" | "partially-verified" | "unverified" | "needs-review";
export type UnderstandEvidenceKindV1 = TaskEvidenceKindV1 | "verification" | "worktree";

export interface UnderstandEvidenceLinkV1 {
  id: string;
  kind: UnderstandEvidenceKindV1;
  target: string;
  label: string;
  deepLink: string;
}

export interface UnderstandArtifactPayloadV1 {
  kind: "vraxis.understand-artifact";
  version: 1;
  generatedAt: string;
  deepLink: string;
  sourceProof: Pick<TaskProofEnvelopeV1, "artifactId"> & { keyId: string };
  session: Pick<SessionSummary, "id" | "title" | "mode" | "runtimeId" | "modelId">;
  project: Pick<ProjectSummary, "id" | "name" | "branch">;
  verdict: {
    state: UnderstandGroundingState;
    summary: string;
  };
  changes: Array<WorkspaceChange & {
    coverage: "verified" | "unverified";
    verificationIds: string[];
  }>;
  claims: Array<{
    id: string;
    statement: string;
    evidenceIds: string[];
  }>;
  risks: Array<{
    id: string;
    severity: "info" | "warning" | "critical";
    title: string;
    detail: string;
    evidenceIds: string[];
  }>;
  rollback?: {
    summary: string;
    branch: string;
    baseBranch: string;
    baseCommit: string;
    checkpointCommit?: string;
    evidenceIds: string[];
  };
  teachBack: Array<{
    id: string;
    question: string;
    evidenceIds: string[];
  }>;
  evidenceLinks: UnderstandEvidenceLinkV1[];
}

export interface UnderstandArtifactEnvelopeV1 extends UnderstandArtifactPayloadV1 {
  artifactId: string;
  integrity: TaskProofIntegrityV1;
}

export interface ProofIdentitySummary {
  keyId: string;
  publicKey: string;
  publicKeyFormat: "spki-base64";
  algorithm: "Ed25519";
}

export interface ProofKeyRotationSignatureV1 extends ProofIdentitySummary {
  signature: string;
}

export interface ProofKeyRotationAttestationV1 {
  kind: "vraxis.proof-key-rotation";
  version: 1;
  rotatedAt: string;
  previousIdentity: ProofIdentitySummary;
  nextIdentity: ProofIdentitySummary;
  artifactId: string;
  integrity: {
    canonicalization: "vraxis-json-c14n-v1";
    digestAlgorithm: "SHA-256";
    digest: string;
    previousSignature: ProofKeyRotationSignatureV1;
    nextSignature: ProofKeyRotationSignatureV1;
  };
}

export interface ProofKeyRotationSummary {
  artifactId: string;
  rotatedAt: string;
  previousKeyId: string;
  nextKeyId: string;
}

export interface TrustedProofSignerSummary extends ProofIdentitySummary {
  label: string;
  enrolledAt: string;
  revokedAt?: string;
}

export interface ProofTrustState {
  identity: ProofIdentitySummary;
  signers: TrustedProofSignerSummary[];
  rotations?: ProofKeyRotationSummary[];
}

export interface ProofVerificationSummary {
  signature: "valid" | "invalid";
  trust: "local" | "trusted" | "untrusted";
  keyId?: string;
  signerLabel?: string;
  artifactId?: string;
  detail: string;
}

export interface SupportBundleV1 {
  kind: "vraxis.support-bundle";
  version: 1;
  generatedAt: string;
  application: {
    name: "Vraxis Code";
    version: string;
    contractVersion: number;
  };
  environment: {
    platform: string;
    architecture: string;
    node: string;
    desktop: boolean;
  };
  inventory: {
    projects: { total: number; ready: number; unavailable: number };
    sessions: Record<SessionSummary["status"], number>;
    runtimes: Array<{
      id: string;
      name: string;
      availability: RuntimeSummary["availability"];
      version?: string;
      authentication?: RuntimeSummary["authentication"];
      updateStatus?: RuntimeUpdateSummary["status"];
      conformance?: RuntimeConformanceSummary["state"];
    }>;
  };
  recovery: {
    previousUnexpectedExit: boolean;
    approvalsInterrupted: number;
    terminalRunsInterrupted: number;
    verificationsInterrupted: number;
    worktreesNeedingReview: number;
  };
  security: {
    loopbackOnly: true;
    desktopSessionProtected: boolean;
    rendererNodeAccess: false;
    includesProjectContent: false;
    includesCredentials: false;
  };
}

export interface RegisterProjectRequest {
  path: string;
}

export interface CreateSessionRequest {
  projectId: string;
  mode: SessionMode;
  runtimeId: string;
  modelId?: string;
  prompt: string;
  attachments?: PromptAttachment[];
  skillIds?: string[];
  attachmentConsent?: AttachmentHandoffConsent;
}

export interface AppendMessageRequest {
  prompt: string;
  delivery?: SteeringDelivery;
  mode?: SessionMode;
  runtimeId?: string;
  modelId?: string | null;
  attachments?: PromptAttachment[];
  skillIds?: string[];
  attachmentConsent?: AttachmentHandoffConsent;
}

export interface UpdateSettingsRequest {
  theme?: AppTheme;
  defaultMode?: SessionMode;
  authorityMode?: AuthorityMode;
  defaultRuntimeId?: string | null;
  runtimeModels?: Record<string, string | null>;
  disabledRuntimeIds?: string[];
}

export interface ConnectModelProviderRequest {
  provider: ModelProviderId;
  name?: string;
  apiKey?: string;
  baseURL?: string;
  model?: string;
}

export interface McpCredentialInput {
  kind: Exclude<McpCredentialKind, "none">;
  name?: string;
  value: string;
}

interface ConnectMcpServerBaseRequest {
  name: string;
  projectIds: string[];
  credential?: McpCredentialInput;
}

export interface ConnectMcpStdioServerRequest extends ConnectMcpServerBaseRequest {
  transport: "stdio";
  command: string;
  args?: string[];
}

export interface ConnectMcpHttpServerRequest extends ConnectMcpServerBaseRequest {
  transport: "streamable-http";
  url: string;
}

export type ConnectMcpServerRequest = ConnectMcpStdioServerRequest | ConnectMcpHttpServerRequest;

export interface UpdateMcpServerProjectsRequest {
  projectIds: string[];
}

export interface BrowserActionRequest {
  sessionId: string;
  action: "navigate" | "click" | "type" | "capture" | "reload" | "back" | "forward" | "new-tab" | "select-tab" | "close-tab";
  target?: string;
  value?: string;
  tabId?: string;
}

export interface CommandRequest {
  sessionId: string;
  command: string;
  cwd?: string;
}

type RecordValue = Record<string, unknown>;

function record(value: unknown, label: string): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value as RecordValue;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function optionalString(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return requiredString(value, label);
}

function boundedString(value: unknown, label: string, maximumLength: number, allowEmpty = false): string {
  if (typeof value !== "string" || (!allowEmpty && !value.trim())) {
    throw new TypeError(`${label} must be ${allowEmpty ? "a string" : "a non-empty string"}.`);
  }
  const result = allowEmpty ? value : value.trim();
  if (result.length > maximumLength) throw new TypeError(`${label} is too long.`);
  return result;
}

function approvalCapability(value: unknown, label: string): ApprovalCapability {
  const candidate = boundedString(value, label, 32);
  if (!approvalCapabilities.includes(candidate as ApprovalCapability)) throw new TypeError(`${label} is not supported.`);
  return candidate as ApprovalCapability;
}

function teamPolicyEffect(value: unknown, label: string): TeamPolicyEffect {
  if (value !== "ask" && value !== "deny") throw new TypeError(`${label} must be ask or deny.`);
  return value;
}

function teamPolicyDate(value: unknown, label: string): string {
  const candidate = boundedString(value, label, 40);
  if (!Number.isFinite(Date.parse(candidate))) throw new TypeError(`${label} must be an ISO date.`);
  return candidate;
}

function teamPolicyRules(value: unknown, includeSignedFields: boolean): TeamPolicyRuleV1[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > approvalCapabilities.length) {
    throw new TypeError(`Team policy rules must contain between 1 and ${approvalCapabilities.length} entries.`);
  }
  const seen = new Set<ApprovalCapability>();
  return value.map((item, index) => {
    const input = record(item, `Team policy rule ${index + 1}`);
    const capability = approvalCapability(input.capability, `Team policy rule ${index + 1} capability`);
    if (seen.has(capability)) throw new TypeError(`Team policy capability ${capability} is duplicated.`);
    seen.add(capability);
    const effect = teamPolicyEffect(input.effect, `Team policy rule ${index + 1} effect`);
    return {
      id: includeSignedFields
        ? boundedString(input.id, `Team policy rule ${index + 1} ID`, 64)
        : `${capability}:${effect}`,
      capability,
      effect,
      reason: includeSignedFields
        ? boundedString(input.reason, `Team policy rule ${index + 1} reason`, 240)
        : effect === "deny"
          ? `${capability} actions are blocked by team policy.`
          : `${capability} actions require a fresh decision under team policy.`,
    };
  });
}

function taskProofIntegrity(value: unknown): TaskProofIntegrityV1 {
  const input = record(value, "Team policy integrity");
  if (input.algorithm !== "Ed25519"
    || input.canonicalization !== "vraxis-json-c14n-v1"
    || input.digestAlgorithm !== "SHA-256"
    || input.publicKeyFormat !== "spki-base64") {
    throw new TypeError("Team policy integrity metadata is not supported.");
  }
  const digest = boundedString(input.digest, "Team policy digest", 64);
  const keyId = boundedString(input.keyId, "Team policy signer key ID", 64);
  if (!/^[0-9a-f]{64}$/.test(digest) || !/^[0-9a-f]{64}$/.test(keyId)) {
    throw new TypeError("Team policy digest and signer key ID must be SHA-256 hex values.");
  }
  return {
    algorithm: "Ed25519",
    canonicalization: "vraxis-json-c14n-v1",
    digestAlgorithm: "SHA-256",
    digest,
    signature: boundedString(input.signature, "Team policy signature", 512),
    publicKey: boundedString(input.publicKey, "Team policy public key", 4_096),
    publicKeyFormat: "spki-base64",
    keyId,
  };
}

function promptAttachments(value: unknown): PromptAttachment[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new TypeError("Attachments must be an array.");
  if (value.length > promptAttachmentLimits.maximumCount) {
    throw new TypeError(`Attach no more than ${promptAttachmentLimits.maximumCount} files.`);
  }
  const attachments = value.map((item, index) => {
    const input = record(item, `Attachment ${index + 1}`);
    const name = boundedString(input.name, `Attachment ${index + 1} name`, 255);
    if (name.includes("/") || name.includes("\\")) throw new TypeError("Attachment names must not contain a path.");
    const path = boundedString(input.path, `Attachment ${index + 1} path`, 2_048);
    const source = input.source === "imported" ? "imported" as const : "project" as const;
    if (source === "imported" && !/^[0-9a-f-]{36}$/i.test(path)) {
      throw new TypeError("Imported attachment references are invalid.");
    }
    if (source === "project" && (path.startsWith("/") || path.split(/[\\/]/).includes(".."))) {
      throw new TypeError("Attachments must use project-relative paths.");
    }
    const mediaType = optionalString(input.mediaType, `Attachment ${index + 1} media type`);
    const size = input.size;
    if (size !== undefined && (!Number.isSafeInteger(size) || (size as number) < 0 || (size as number) > promptAttachmentLimits.maximumBytes)) {
      throw new TypeError(`Attachment ${index + 1} size is invalid.`);
    }
    return {
      id: boundedString(input.id, `Attachment ${index + 1} ID`, 128),
      name,
      path,
      ...(source === "imported" ? { source } : {}),
      ...(mediaType ? { mediaType } : {}),
      ...(typeof size === "number" ? { size } : {}),
    };
  });
  return attachments;
}

function promptSkillIds(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new TypeError("Skills must be an array.");
  const skillIds = [...new Set(value.map((item) => boundedString(item, "Skill ID", 128)))];
  if (skillIds.length > promptSkillLimits.maximumCount) {
    throw new TypeError(`Attach no more than ${promptSkillLimits.maximumCount} skills.`);
  }
  return skillIds.length ? skillIds : undefined;
}

function attachmentHandoffConsent(value: unknown): AttachmentHandoffConsent | undefined {
  if (value === undefined) return undefined;
  const input = record(value, "Attachment handoff consent");
  if (input.confirmed !== true) throw new TypeError("External file handoff must be explicitly confirmed.");
  if (!Array.isArray(input.attachmentIds) || !input.attachmentIds.length) {
    throw new TypeError("External file handoff must name the approved files.");
  }
  const attachmentIds = [...new Set(input.attachmentIds.map((item) => requiredString(item, "Attachment ID")))];
  const modelId = optionalString(input.modelId, "Model ID");
  return {
    attachmentIds,
    runtimeId: requiredString(input.runtimeId, "Runtime ID"),
    ...(modelId ? { modelId } : {}),
    confirmed: true,
  };
}

function parseRuntimeModels(value: unknown): Record<string, string | null> {
  const input = record(value, "Runtime models");
  const result: Record<string, string | null> = {};
  for (const [runtimeId, modelId] of Object.entries(input)) {
    const key = requiredString(runtimeId, "Runtime ID");
    result[key] = modelId === null || modelId === "" ? null : requiredString(modelId, "Model ID");
  }
  return result;
}

function parseRuntimeIds(value: unknown): string[] {
  if (!Array.isArray(value)) throw new TypeError("Disabled runtimes must be an array.");
  return [...new Set(value.map((item) => requiredString(item, "Runtime ID")))];
}

export function parseRegisterProjectRequest(value: unknown): RegisterProjectRequest {
  const input = record(value, "Project registration");
  return { path: requiredString(input.path, "Project path") };
}

function sessionMode(value: unknown): SessionMode {
  const candidate = requiredString(value, "Session mode");
  if (!sessionModes.includes(candidate as SessionMode)) throw new TypeError("Session mode is not supported.");
  return candidate as SessionMode;
}

function appTheme(value: unknown): AppTheme {
  const candidate = requiredString(value, "Theme");
  if (!appThemes.includes(candidate as AppTheme)) throw new TypeError("Theme is not supported.");
  return candidate as AppTheme;
}

function modelProvider(value: unknown): ModelProviderId {
  const candidate = requiredString(value, "Model provider");
  if (!modelProviderIds.includes(candidate as ModelProviderId)) throw new TypeError("Model provider is not supported.");
  return candidate as ModelProviderId;
}

function mcpProjectIds(value: unknown, allowEmpty = false): string[] {
  if (!Array.isArray(value)) throw new TypeError("MCP projects must be an array.");
  const projectIds = [...new Set(value.map((item) => boundedString(item, "MCP project ID", 128)))];
  if ((!allowEmpty && projectIds.length === 0) || projectIds.length > 64) {
    throw new TypeError(allowEmpty ? "Choose no more than 64 MCP projects." : "Choose between 1 and 64 MCP projects.");
  }
  return projectIds;
}

function mcpCredential(value: unknown, transport: McpTransportId): McpCredentialInput | undefined {
  if (value === undefined) return undefined;
  const input = record(value, "MCP credential");
  const kind = boundedString(input.kind, "MCP credential kind", 32);
  if (!mcpCredentialKinds.includes(kind as McpCredentialKind) || kind === "none") {
    throw new TypeError("MCP credential kind is not supported.");
  }
  if (transport === "stdio" && kind !== "environment") {
    throw new TypeError("Local MCP credentials must use an environment variable.");
  }
  if (transport === "streamable-http" && kind === "environment") {
    throw new TypeError("Remote MCP credentials must use bearer or header authentication.");
  }
  const name = optionalString(input.name, "MCP credential name");
  if ((kind === "header" || kind === "environment") && !name) {
    throw new TypeError("Name the MCP credential header or environment variable.");
  }
  if (name && name.length > 128) throw new TypeError("MCP credential name is too long.");
  return {
    kind: kind as McpCredentialInput["kind"],
    ...(name ? { name } : {}),
    value: boundedString(input.value, "MCP credential value", 8_192),
  };
}

export function parseCreateSessionRequest(value: unknown): CreateSessionRequest {
  const input = record(value, "Session request");
  const result: CreateSessionRequest = {
    projectId: requiredString(input.projectId, "Project ID"),
    mode: sessionMode(input.mode),
    runtimeId: requiredString(input.runtimeId, "Runtime ID"),
    prompt: requiredString(input.prompt, "Task"),
  };
  const modelId = optionalString(input.modelId, "Model ID");
  if (modelId) result.modelId = modelId;
  const attachments = promptAttachments(input.attachments);
  if (attachments?.length) result.attachments = attachments;
  const skillIds = promptSkillIds(input.skillIds);
  if (skillIds) result.skillIds = skillIds;
  const attachmentConsent = attachmentHandoffConsent(input.attachmentConsent);
  if (attachmentConsent) result.attachmentConsent = attachmentConsent;
  return result;
}

export function parseAppendMessageRequest(value: unknown): AppendMessageRequest {
  const input = record(value, "Message request");
  const result: AppendMessageRequest = { prompt: requiredString(input.prompt, "Task") };
  if (input.delivery !== undefined) {
    const delivery = requiredString(input.delivery, "Message delivery");
    if (!steeringDeliveries.includes(delivery as SteeringDelivery)) throw new TypeError("Message delivery must be queue or redirect.");
    result.delivery = delivery as SteeringDelivery;
  }
  if (input.mode !== undefined) result.mode = sessionMode(input.mode);
  if (input.runtimeId !== undefined) result.runtimeId = requiredString(input.runtimeId, "Runtime ID");
  if (input.modelId === null) result.modelId = null;
  else {
    const modelId = optionalString(input.modelId, "Model ID");
    if (modelId) result.modelId = modelId;
  }
  const attachments = promptAttachments(input.attachments);
  if (attachments?.length) result.attachments = attachments;
  const skillIds = promptSkillIds(input.skillIds);
  if (skillIds) result.skillIds = skillIds;
  const attachmentConsent = attachmentHandoffConsent(input.attachmentConsent);
  if (attachmentConsent) result.attachmentConsent = attachmentConsent;
  return result;
}

export function parseUpdateSettingsRequest(value: unknown): UpdateSettingsRequest {
  const input = record(value, "Settings");
  const result: UpdateSettingsRequest = {};
  if (input.theme !== undefined) result.theme = appTheme(input.theme);
  if (input.defaultMode !== undefined) result.defaultMode = sessionMode(input.defaultMode);
  if (input.authorityMode !== undefined) {
    const authorityMode = requiredString(input.authorityMode, "Authority mode");
    if (!authorityModes.includes(authorityMode as AuthorityMode)) throw new TypeError("Authority mode is not supported.");
    result.authorityMode = authorityMode as AuthorityMode;
  }
  if (input.defaultRuntimeId === null) result.defaultRuntimeId = null;
  else if (input.defaultRuntimeId !== undefined) {
    result.defaultRuntimeId = requiredString(input.defaultRuntimeId, "Default runtime ID");
  }
  if (input.runtimeModels !== undefined) result.runtimeModels = parseRuntimeModels(input.runtimeModels);
  if (input.disabledRuntimeIds !== undefined) result.disabledRuntimeIds = parseRuntimeIds(input.disabledRuntimeIds);
  if (Object.keys(result).length === 0) throw new TypeError("Choose at least one setting to update.");
  return result;
}

export function parseConnectModelProviderRequest(value: unknown): ConnectModelProviderRequest {
  const input = record(value, "Model provider connection");
  const result: ConnectModelProviderRequest = { provider: modelProvider(input.provider) };
  const name = optionalString(input.name, "Connection name");
  const apiKey = optionalString(input.apiKey, "API key");
  const baseURL = optionalString(input.baseURL, "Endpoint URL");
  const model = optionalString(input.model, "Model ID");
  if (name) result.name = name;
  if (apiKey) result.apiKey = apiKey;
  if (baseURL) result.baseURL = baseURL;
  if (model) result.model = model;
  return result;
}

export function parseConnectMcpServerRequest(value: unknown): ConnectMcpServerRequest {
  const input = record(value, "MCP server connection");
  const transport = boundedString(input.transport, "MCP transport", 32);
  if (!mcpTransportIds.includes(transport as McpTransportId)) throw new TypeError("MCP transport is not supported.");
  const common = {
    name: boundedString(input.name, "MCP server name", 120),
    projectIds: mcpProjectIds(input.projectIds),
  };
  const credential = mcpCredential(input.credential, transport as McpTransportId);
  if (transport === "stdio") {
    if (credential && credential.kind !== "environment") throw new TypeError("Local MCP credentials must use an environment variable.");
    if (input.args !== undefined && !Array.isArray(input.args)) throw new TypeError("MCP arguments must be an array.");
    const args = input.args === undefined
      ? undefined
      : input.args.map((item, index) => boundedString(item, `MCP argument ${index + 1}`, 4_096));
    if (args && args.length > 64) throw new TypeError("Use no more than 64 MCP arguments.");
    return {
      ...common,
      transport: "stdio",
      command: boundedString(input.command, "MCP command", 1_024),
      ...(args?.length ? { args } : {}),
      ...(credential ? { credential } : {}),
    };
  }
  if (credential?.kind === "environment") throw new TypeError("Remote MCP credentials must use bearer or header authentication.");
  return {
    ...common,
    transport: "streamable-http",
    url: boundedString(input.url, "MCP URL", 4_096),
    ...(credential ? { credential } : {}),
  };
}

export function parseUpdateMcpServerProjectsRequest(value: unknown): UpdateMcpServerProjectsRequest {
  return { projectIds: mcpProjectIds(record(value, "MCP project access").projectIds, true) };
}

export function parseCreateTeamPolicyRequest(value: unknown): TeamPolicyCreateRequest {
  const input = record(value, "Team policy");
  const expiresAt = input.expiresAt === undefined || input.expiresAt === ""
    ? undefined
    : teamPolicyDate(input.expiresAt, "Team policy expiration");
  if (expiresAt && Date.parse(expiresAt) <= Date.now()) throw new TypeError("Team policy expiration must be in the future.");
  return {
    organization: boundedString(input.organization, "Team policy organization", 120),
    ...(expiresAt ? { expiresAt } : {}),
    rules: teamPolicyRules(input.rules, false).map(({ capability, effect }) => ({ capability, effect })),
  };
}

export function parseTeamPolicyBundle(value: unknown): TeamPolicyBundleV1 {
  const input = record(value, "Team policy bundle");
  if (input.kind !== "vraxis.team-policy" || input.version !== 1) {
    throw new TypeError("Team policy bundle kind or version is not supported.");
  }
  const issuedAt = teamPolicyDate(input.issuedAt, "Team policy issue date");
  const expiresAt = input.expiresAt === undefined ? undefined : teamPolicyDate(input.expiresAt, "Team policy expiration");
  if (expiresAt && Date.parse(expiresAt) <= Date.parse(issuedAt)) {
    throw new TypeError("Team policy expiration must be later than its issue date.");
  }
  const artifactId = boundedString(input.artifactId, "Team policy artifact ID", 71);
  if (!/^sha256:[0-9a-f]{64}$/.test(artifactId)) throw new TypeError("Team policy artifact ID is invalid.");
  return {
    kind: "vraxis.team-policy",
    version: 1,
    policyId: boundedString(input.policyId, "Team policy ID", 80),
    organization: boundedString(input.organization, "Team policy organization", 120),
    issuedAt,
    ...(expiresAt ? { expiresAt } : {}),
    rules: teamPolicyRules(input.rules, true),
    artifactId,
    integrity: taskProofIntegrity(input.integrity),
  };
}

export function parseCommandRequest(value: unknown): CommandRequest {
  const input = record(value, "Command request");
  const result: CommandRequest = {
    sessionId: requiredString(input.sessionId, "Session ID"),
    command: requiredString(input.command, "Command"),
  };
  const cwd = optionalString(input.cwd, "Working directory");
  if (cwd) {
    if (cwd.startsWith("/") || cwd.split(/[\\/]/).includes("..")) {
      throw new TypeError("Working directory must stay inside the session workspace.");
    }
    result.cwd = cwd;
  }
  return result;
}

export function parseBrowserActionRequest(value: unknown): BrowserActionRequest {
  const input = record(value, "Browser action");
  const action = requiredString(input.action, "Browser action type");
  if (!["navigate", "click", "type", "capture", "reload", "back", "forward", "new-tab", "select-tab", "close-tab"].includes(action)) {
    throw new TypeError("Browser action type is not supported.");
  }
  const result: BrowserActionRequest = {
    sessionId: requiredString(input.sessionId, "Session ID"),
    action: action as BrowserActionRequest["action"],
  };
  if (input.target !== undefined) result.target = requiredString(input.target, "Browser target");
  if (input.value !== undefined) result.value = requiredString(input.value, "Browser value");
  if (input.tabId !== undefined) result.tabId = requiredString(input.tabId, "Browser tab ID");
  return result;
}

export function parseApprovalDecisionRequest(value: unknown): ApprovalDecisionRequest {
  const input = record(value, "Approval decision");
  if (input.decision !== "approve" && input.decision !== "deny") {
    throw new TypeError("Approval decision must be approve or deny.");
  }
  if (input.duration !== undefined && !["once", "session", "project"].includes(String(input.duration))) {
    throw new TypeError("Approval duration must be once, session, or project.");
  }
  return {
    decision: input.decision,
    ...(input.duration ? { duration: input.duration as ApprovalDuration } : {}),
  };
}
