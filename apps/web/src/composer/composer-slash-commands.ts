import type { ComposerCommandSummary } from "@vraxis/code-contracts";
import type { OsxAgentComposerSuggestion, OsxIconName } from "@vraxis/osx-components";
import type { InspectorView, SessionMode } from "@vraxis/code-contracts";

export type ComposerSlashCommandId =
  | "ask"
  | "plan"
  | "build"
  | "review"
  | "fix"
  | "test"
  | "docs"
  | "refactor"
  | "debug"
  | "commit"
  | "verify"
  | "changes"
  | "worktree"
  | "proof"
  | "harness"
  | "probe"
  | "approve"
  | "baseline"
  | "handoff"
  | "clear"
  | "new"
  | "create-skill";

export type ComposerSlashCommandAction =
  | { type: "prompt"; mode: SessionMode; prompt: string; skillNames?: string[] }
  | { type: "clear" }
  | { type: "new-task" }
  | { type: "open-inspector"; view: InspectorView; prompt?: { mode: SessionMode; text: string } }
  | { type: "harness-setup" }
  | { type: "probe-runtime" };

export interface ComposerSlashCommandContext {
  previewMode: boolean;
  sessionIsRunning: boolean;
  hasSession: boolean;
  hasProject: boolean;
  runtimeCanBuild: boolean;
  verificationHasRecipe: boolean;
  hasChanges: boolean;
  pendingApprovalCount: number;
  hasRuntime: boolean;
  startingNewTask: boolean;
}

export interface ComposerSlashCommandDefinition {
  id: ComposerSlashCommandId;
  label: string;
  description: string;
  icon: OsxIconName;
  group: "Modes" | "Implementation" | "Evidence" | "Harness" | "Session";
  keywords: string[];
  action: ComposerSlashCommandAction;
  disabled?: (context: ComposerSlashCommandContext) => boolean;
  disabledReason?: (context: ComposerSlashCommandContext) => string | undefined;
}

const buildRequired: Pick<ComposerSlashCommandDefinition, "disabled" | "disabledReason"> = {
  disabled: (context) => !context.runtimeCanBuild,
  disabledReason: () => "Choose a runtime that supports guarded isolated-worktree writes.",
};

const composerSlashCommandDefinitions: ComposerSlashCommandDefinition[] = [
  {
    id: "ask",
    label: "ask",
    description: "Read the project and answer without editing.",
    icon: "search",
    group: "Modes",
    keywords: ["explain", "question", "read", "understand"],
    action: {
      type: "prompt",
      mode: "ask",
      prompt: "Explain how this project is structured. Cite the files and modules that support your answer.",
    },
  },
  {
    id: "plan",
    label: "plan",
    description: "Investigate and prepare an implementation plan.",
    icon: "list-checks",
    group: "Modes",
    keywords: ["design", "roadmap", "strategy", "spec"],
    action: {
      type: "prompt",
      mode: "plan",
      prompt: "Investigate this codebase and produce a concrete implementation plan with risks, files to touch, and verification steps.",
    },
  },
  {
    id: "build",
    label: "build",
    description: "Implement inside an isolated worktree.",
    icon: "code",
    group: "Modes",
    keywords: ["implement", "ship", "feature", "worktree"],
    action: {
      type: "prompt",
      mode: "build",
      prompt: "Implement the requested change inside the isolated worktree. Keep edits focused and leave verification evidence.",
    },
    ...buildRequired,
  },
  {
    id: "review",
    label: "review",
    description: "Inspect changes and trust boundaries without editing.",
    icon: "eye",
    group: "Modes",
    keywords: ["audit", "critique", "security", "diff"],
    action: {
      type: "prompt",
      mode: "review",
      prompt: "Review the current changes for correctness, regressions, and trust-boundary risks. Cite files and diffs.",
    },
  },
  {
    id: "fix",
    label: "fix",
    description: "Diagnose and repair a bug with evidence.",
    icon: "warning",
    group: "Implementation",
    keywords: ["bug", "repair", "regression", "patch"],
    action: {
      type: "prompt",
      mode: "build",
      prompt: "Find the root cause of the reported bug, implement the smallest safe fix in the worktree, and explain the evidence.",
    },
    ...buildRequired,
  },
  {
    id: "test",
    label: "test",
    description: "Add or repair tests around the affected behavior.",
    icon: "flask",
    group: "Implementation",
    keywords: ["coverage", "spec", "unit", "integration"],
    action: {
      type: "prompt",
      mode: "build",
      prompt: "Add or repair tests for the affected behavior. Prefer the project's existing test conventions and run the relevant checks.",
    },
    ...buildRequired,
  },
  {
    id: "docs",
    label: "docs",
    description: "Document behavior, APIs, or setup steps.",
    icon: "file-text",
    group: "Implementation",
    keywords: ["documentation", "readme", "comments", "guide"],
    action: {
      type: "prompt",
      mode: "build",
      prompt: "Document the requested behavior, API, or setup flow. Match the repository's documentation style and keep claims file-backed.",
    },
    ...buildRequired,
  },
  {
    id: "refactor",
    label: "refactor",
    description: "Restructure code without changing behavior.",
    icon: "boxes",
    group: "Implementation",
    keywords: ["cleanup", "rename", "extract", "simplify"],
    action: {
      type: "prompt",
      mode: "build",
      prompt: "Refactor the targeted code without changing behavior. Keep the diff focused and call out any behavior you intentionally preserve.",
    },
    ...buildRequired,
  },
  {
    id: "debug",
    label: "debug",
    description: "Trace a failure with logs, tests, and file evidence.",
    icon: "activity",
    group: "Implementation",
    keywords: ["investigate", "failure", "error", "trace"],
    action: {
      type: "prompt",
      mode: "ask",
      prompt: "Investigate the reported failure. Trace the execution path, identify the most likely root cause, and cite the evidence.",
    },
  },
  {
    id: "commit",
    label: "commit",
    description: "Draft a commit message from the current changes.",
    icon: "git-branch",
    group: "Implementation",
    keywords: ["message", "changelog", "summary", "git"],
    action: {
      type: "prompt",
      mode: "ask",
      prompt: "Review the current changes and draft a concise commit message with a subject line and bullet summary.",
    },
    disabled: (context) => !context.hasChanges,
    disabledReason: () => "No tracked changes are available to summarize yet.",
  },
  {
    id: "verify",
    label: "verify",
    description: "Run project checks with retained proof.",
    icon: "flask",
    group: "Evidence",
    keywords: ["checks", "ci", "validation", "test"],
    action: {
      type: "open-inspector",
      view: "verify",
      prompt: {
        mode: "review",
        text: "Review the project checks configured for this repo. Report what will run, what still needs setup, and request checks when the work is ready.",
      },
    },
    disabled: (context) => !context.hasSession,
    disabledReason: () => "Start a task before running checks.",
  },
  {
    id: "changes",
    label: "changes",
    description: "Review uncommitted work in the Changes pane.",
    icon: "file-code",
    group: "Evidence",
    keywords: ["diff", "uncommitted", "patch", "hunks"],
    action: {
      type: "open-inspector",
      view: "changes",
      prompt: {
        mode: "review",
        text: "Review the current uncommitted changes. Summarize intent, risk, and any missing tests or verification.",
      },
    },
    disabled: (context) => !context.hasSession,
    disabledReason: () => "Start a task before reviewing workspace changes.",
  },
  {
    id: "worktree",
    label: "worktree",
    description: "Explain the isolated Build worktree and branch state.",
    icon: "git-branch",
    group: "Evidence",
    keywords: ["branch", "isolated", "merge", "apply"],
    action: {
      type: "prompt",
      mode: "build",
      prompt: "Explain the current Build worktree state, branch name, applied hunks, and what would happen if we applied or discarded the work.",
    },
    disabled: (context) => !context.hasSession || !context.runtimeCanBuild,
    disabledReason: (context) => !context.runtimeCanBuild
      ? "Choose a runtime that supports guarded isolated-worktree writes."
      : "Start a Build task to inspect worktree state.",
  },
  {
    id: "proof",
    label: "proof",
    description: "Prepare portable task evidence and signed proof.",
    icon: "download",
    group: "Evidence",
    keywords: ["receipt", "evidence", "signed", "export"],
    action: {
      type: "prompt",
      mode: "review",
      prompt: "Summarize the task evidence available so far and what should be captured in portable proof before handoff.",
    },
    disabled: (context) => !context.hasSession,
    disabledReason: () => "Start a task before preparing portable proof.",
  },
  {
    id: "baseline",
    label: "baseline",
    description: "Check visual or browser assertions against baselines.",
    icon: "image",
    group: "Evidence",
    keywords: ["visual", "screenshot", "regression", "browser"],
    action: {
      type: "open-inspector",
      view: "verify",
      prompt: {
        mode: "review",
        text: "Review the verification recipe for visual baselines and browser assertions. Explain what would fail today and what evidence is missing.",
      },
    },
    disabled: (context) => !context.hasProject,
    disabledReason: () => "Open a project before reviewing baselines.",
  },
  {
    id: "handoff",
    label: "handoff",
    description: "Explain external attachment and runtime handoff rules.",
    icon: "upload",
    group: "Evidence",
    keywords: ["attachments", "external", "consent", "files"],
    action: {
      type: "prompt",
      mode: "ask",
      prompt: "Explain how external attachments are handed off to the selected runtime, what consent is required, and what stays inside the approved project root.",
    },
  },
  {
    id: "approve",
    label: "approve",
    description: "Summarize pending capability approvals.",
    icon: "lock",
    group: "Harness",
    keywords: ["capabilities", "permissions", "network", "terminal"],
    action: {
      type: "prompt",
      mode: "review",
      prompt: "Summarize the pending capability approvals, the requested scope, and a recommendation for each decision.",
    },
    disabled: (context) => context.pendingApprovalCount === 0,
    disabledReason: () => "There are no pending approvals in this task.",
  },
  {
    id: "harness",
    label: "harness",
    description: "Open Agent Harness settings.",
    icon: "settings",
    group: "Harness",
    keywords: ["runtime", "cli", "codex", "cursor", "provider"],
    action: { type: "harness-setup" },
    disabled: (context) => context.previewMode,
    disabledReason: () => "Harness settings are unavailable in preview mode.",
  },
  {
    id: "create-skill",
    label: "create-skill",
    description: "Scaffold a new Agent Skill with SKILL.md.",
    icon: "sparkle",
    group: "Harness",
    keywords: ["skill", "scaffold", "author", "template", "agents"],
    action: {
      type: "prompt",
      mode: "build",
      skillNames: ["create-skill"],
      prompt: "Create a new agent skill from my request. Gather any missing purpose, scope, and trigger details, then scaffold `.agents/skills/<skill-name>/SKILL.md` in the approved project root with strong frontmatter and concise instructions.",
    },
    disabled: (context) => !context.hasProject || !context.runtimeCanBuild,
    disabledReason: (context) => !context.runtimeCanBuild
      ? "Choose a runtime that supports guarded isolated-worktree writes."
      : "Open a project before creating a skill.",
  },
  {
    id: "probe",
    label: "probe",
    description: "Verify the selected runtime harness is ready.",
    icon: "terminal",
    group: "Harness",
    keywords: ["conformance", "ready", "install", "check"],
    action: { type: "probe-runtime" },
    disabled: (context) => !context.hasRuntime || context.previewMode,
    disabledReason: () => "Choose an installed runtime before probing.",
  },
  {
    id: "clear",
    label: "clear",
    description: "Clear the composer draft and attached context.",
    icon: "trash",
    group: "Session",
    keywords: ["reset", "empty", "draft"],
    action: { type: "clear" },
  },
  {
    id: "new",
    label: "new",
    description: "Start a fresh task in this project.",
    icon: "plus",
    group: "Session",
    keywords: ["task", "session", "restart"],
    action: { type: "new-task" },
    disabled: (context) => context.previewMode || context.startingNewTask,
    disabledReason: () => "A new task is unavailable right now.",
  },
];

export function composerSlashCommandById(id: string): ComposerSlashCommandDefinition | undefined {
  return composerSlashCommandDefinitions.find((item) => item.id === id);
}

const composerIconNames = new Set<OsxIconName>([
  "search", "list-checks", "code", "eye", "warning", "flask", "file-text", "boxes", "activity",
  "git-branch", "download", "image", "upload", "lock", "settings", "terminal", "trash", "plus", "sparkle",
]);

function userCommandIcon(icon?: string): OsxIconName {
  return icon && composerIconNames.has(icon as OsxIconName) ? icon as OsxIconName : "sparkle";
}

export function resolveUserComposerSlashCommand(
  commandId: string,
  commands: readonly ComposerCommandSummary[],
): ComposerCommandSummary | undefined {
  if (!commandId.startsWith("user:")) return undefined;
  const id = commandId.slice("user:".length);
  return commands.find((command) => command.id === id);
}

export function buildUserComposerSlashCommandSuggestions(
  commands: readonly ComposerCommandSummary[],
  context: ComposerSlashCommandContext,
): OsxAgentComposerSuggestion[] {
  return commands.map((command) => ({
    id: `command:user:${command.id}`,
    kind: "command" as const,
    trigger: "/" as const,
    label: command.name,
    description: command.description,
    icon: userCommandIcon(command.icon),
    group: command.scope === "project" ? "Project commands" : "User commands",
    keywords: [command.name, ...(command.keywords ?? []), command.scope],
    selectionBehavior: "emit" as const,
    disabled: command.mode === "build" && !context.runtimeCanBuild,
    ...(command.mode === "build" && !context.runtimeCanBuild ? {
      disabledReason: "Choose a runtime that supports guarded isolated-worktree writes.",
    } : {}),
  }));
}

export function buildComposerSlashCommandSuggestions(
  context: ComposerSlashCommandContext,
  userCommands: readonly ComposerCommandSummary[] = [],
): OsxAgentComposerSuggestion[] {
  return [
    ...composerSlashCommandDefinitions.map((command) => ({
    id: `command:${command.id}`,
    kind: "command" as const,
    trigger: "/" as const,
    label: command.label,
    description: command.description,
    icon: command.icon,
    group: command.group,
    keywords: [command.label, ...command.keywords],
    selectionBehavior: "emit" as const,
    disabled: command.disabled?.(context) ?? false,
    ...(command.disabledReason?.(context) ? { disabledReason: command.disabledReason(context) } : {}),
  })),
    ...buildUserComposerSlashCommandSuggestions(userCommands, context),
  ];
}

export const composerSlashCommandDefinitionsForTest = composerSlashCommandDefinitions;
