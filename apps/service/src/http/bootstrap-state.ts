import {
  contractVersion,
  parseBootstrapScope,
  type BootstrapScope,
  type BootstrapState,
  type ProjectSummary,
  type SessionSummary,
  type StartupRecoverySummary,
} from "@vraxis/code-contracts";
import type { ProjectRegistry } from "../projects/project-registry.js";
import type { SessionRegistry } from "../sessions/session-registry.js";
import type { SettingsRegistry } from "../settings/settings-registry.js";
import type { ModelProviderRegistry } from "../model-providers/model-provider-registry.js";
import type { McpServerRegistry } from "../mcp/mcp-server-registry.js";
import type { SkillRegistry } from "../skills/skill-registry.js";
import { discoverComposerCommands } from "../commands/command-registry.js";
import type { ApprovalRegistry } from "../approvals/approval-registry.js";
import type { TerminalRegistry } from "../terminal/terminal-registry.js";
import type { VerificationRegistry } from "../verification/verification-registry.js";
import type { BrowserWorkspace } from "../browser/browser-workspace.js";
import type { GitWorktrees } from "../worktrees/git-worktree.js";
import { indexProjectFiles } from "../workspace/file-index.js";
import { withProductCapabilityMatrix } from "../runtimes/runtime-capabilities.js";
import type { RuntimeSummary } from "@vraxis/code-contracts";

export { parseBootstrapScope };
export type { BootstrapScope };

export interface BootstrapContext {
  data: Awaited<ReturnType<ProjectRegistry["read"]>>;
  sessionData: Awaited<ReturnType<SessionRegistry["read"]>>;
  selected?: ProjectSummary;
  selectedSession?: SessionSummary;
}

export interface BootstrapDependencies {
  settings: SettingsRegistry;
  worktrees: GitWorktrees;
  discoverLocalRuntimes: () => Promise<RuntimeSummary[]>;
  discoverProviderRuntimes: () => Promise<RuntimeSummary[]>;
  modelProviders: ModelProviderRegistry;
  mcpServers: McpServerRegistry;
  skills: SkillRegistry;
  browser: BrowserWorkspace;
  approvals: ApprovalRegistry;
  terminal: TerminalRegistry;
  verifications: VerificationRegistry;
  safeProjectDoctor: (projectId: string, projectPath: string) => Promise<BootstrapState["projectDoctor"]>;
  startupRecovery?: StartupRecoverySummary;
}

function emptyBootstrapCollections(): Pick<
  BootstrapState,
  | "files"
  | "changes"
  | "events"
  | "approvals"
  | "approvalRules"
  | "terminalRuns"
  | "verificationRuns"
  | "verificationHandoffs"
  | "runtimes"
  | "modelProviders"
  | "mcpServers"
  | "skills"
  | "skillLibrary"
  | "composerCommands"
> {
  return {
    files: [],
    changes: [],
    events: [],
    approvals: [],
    approvalRules: [],
    terminalRuns: [],
    verificationRuns: [],
    verificationHandoffs: [],
    runtimes: [],
    modelProviders: [],
    mcpServers: [],
    skills: [],
    skillLibrary: [],
    composerCommands: [],
  };
}

function bootstrapRealtime(): NonNullable<BootstrapState["realtime"]> {
  return {
    sessionEvents: true,
    terminalOutput: true,
    reconnectSnapshots: true,
  };
}

export async function resolveBootstrapContext(
  registry: ProjectRegistry,
  sessions: SessionRegistry,
): Promise<BootstrapContext> {
  const [data, sessionData] = await Promise.all([registry.read(), sessions.read()]);
  const selected = data.projects.find((project) => project.id === data.selectedProjectId);
  const selectedSession = sessionData.draftProjectId === selected?.id
    ? undefined
    : sessionData.sessions.find((session) => session.id === sessionData.selectedSessionId && session.projectId === selected?.id && !session.archivedAt)
      ?? sessionData.sessions.find((session) => session.projectId === selected?.id && !session.archivedAt);
  return {
    data,
    sessionData,
    ...(selected ? { selected } : {}),
    ...(selectedSession ? { selectedSession } : {}),
  };
}

async function loadWorkspaceFiles(
  ctx: BootstrapContext,
  worktrees: GitWorktrees,
): Promise<{ files: BootstrapState["files"]; changes: BootstrapState["changes"] }> {
  if (ctx.selectedSession?.worktree) {
    try {
      const evidence = await worktrees.evidence(ctx.selectedSession.worktree);
      return { files: evidence.files, changes: evidence.changes };
    } catch {
      ctx.selectedSession.worktree.status = "missing";
      return { files: [], changes: [] };
    }
  }
  if (ctx.selected) return { files: await indexProjectFiles(ctx.selected.path), changes: [] };
  return { files: [], changes: [] };
}

export async function buildBootstrapState(
  scope: BootstrapScope,
  ctx: BootstrapContext,
  deps: BootstrapDependencies,
): Promise<BootstrapState> {
  const settings = await deps.settings.read();
  const base: BootstrapState = {
    contractVersion,
    realtime: bootstrapRealtime(),
    projects: ctx.data.projects,
    sessions: ctx.sessionData.sessions,
    ...(ctx.selected ? { selectedProjectId: ctx.selected.id } : {}),
    ...(ctx.selectedSession ? { selectedSessionId: ctx.selectedSession.id } : {}),
    settings,
    ...emptyBootstrapCollections(),
    ...(deps.startupRecovery ? { startupRecovery: deps.startupRecovery } : {}),
  };

  if (scope === "shell") return base;

  const tasks: Array<Promise<void>> = [];

  if (scope === "workspace" || scope === "full") {
    tasks.push((async () => {
      const { files, changes } = await loadWorkspaceFiles(ctx, deps.worktrees);
      base.files = files;
      base.changes = changes;
      base.events = ctx.selectedSession
        ? ctx.sessionData.events.filter((event) => event.sessionId === ctx.selectedSession!.id)
        : [];
      const [
        browserState,
        sessionApprovals,
        projectApprovalRules,
        sessionTerminalRuns,
        sessionVerificationRuns,
        sessionVerificationHandoffs,
      ] = await Promise.all([
        ctx.selectedSession ? deps.browser.state(ctx.selectedSession.id) : Promise.resolve(undefined),
        ctx.selectedSession ? deps.approvals.list(ctx.selectedSession.id) : Promise.resolve([]),
        ctx.selected ? deps.approvals.listRules(ctx.selected.id, ctx.selectedSession?.id) : Promise.resolve([]),
        ctx.selectedSession ? deps.terminal.list(ctx.selectedSession.id) : Promise.resolve([]),
        ctx.selectedSession ? deps.verifications.list(ctx.selectedSession.id) : Promise.resolve([]),
        ctx.selectedSession ? deps.verifications.listHandoffs(ctx.selectedSession.id) : Promise.resolve([]),
      ]);
      base.approvals = sessionApprovals;
      base.approvalRules = projectApprovalRules;
      base.terminalRuns = sessionTerminalRuns;
      base.verificationRuns = sessionVerificationRuns;
      base.verificationHandoffs = sessionVerificationHandoffs;
      if (browserState) base.browser = browserState;
    })());
  }

  if (scope === "catalog" || scope === "full") {
    tasks.push((async () => {
      const [
        localRuntimes,
        providerRuntimes,
        providerSummaries,
        mcpServerSummaries,
        projectSkills,
        skillLibrary,
        composerCommands,
        projectDoctor,
      ] = await Promise.all([
        deps.discoverLocalRuntimes(),
        deps.discoverProviderRuntimes(),
        deps.modelProviders.summaries(),
        deps.mcpServers.summaries(),
        ctx.selected ? deps.skills.summaries(ctx.selected.path) : Promise.resolve([]),
        ctx.selected ? deps.skills.library(ctx.selected.path) : Promise.resolve([]),
        ctx.selected ? discoverComposerCommands(ctx.selected.path) : Promise.resolve([]),
        ctx.selected ? deps.safeProjectDoctor(ctx.selected.id, ctx.selected.path) : Promise.resolve(undefined),
      ]);
      base.runtimes = withProductCapabilityMatrix([...localRuntimes, ...providerRuntimes]);
      base.modelProviders = providerSummaries;
      base.mcpServers = mcpServerSummaries;
      base.skills = projectSkills;
      base.skillLibrary = skillLibrary;
      base.composerCommands = composerCommands;
      if (projectDoctor) base.projectDoctor = projectDoctor;
    })());
  }

  await Promise.all(tasks);
  return base;
}
