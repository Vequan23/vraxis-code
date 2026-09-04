import type { WorktreeSummary } from "@vraxis/code-contracts";

export type WorktreeRuntimeMetadata = {
  id: string;
  path: string;
  branch: string;
  baseBranch: string;
  baseCommit: string;
  status: WorktreeSummary["status"];
};

export function worktreeRuntimeMetadata(worktree: WorktreeSummary): WorktreeRuntimeMetadata {
  return {
    id: worktree.id,
    path: worktree.path,
    branch: worktree.branch,
    baseBranch: worktree.baseBranch,
    baseCommit: worktree.baseCommit,
    status: worktree.status,
  };
}

export function worktreeFromRuntimeMetadata(value: unknown): WorktreeSummary | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (
    typeof record.id !== "string"
    || typeof record.path !== "string"
    || typeof record.branch !== "string"
    || typeof record.baseBranch !== "string"
    || typeof record.baseCommit !== "string"
    || typeof record.status !== "string"
  ) return undefined;
  return {
    id: record.id,
    path: record.path,
    branch: record.branch,
    baseBranch: record.baseBranch,
    baseCommit: record.baseCommit,
    status: record.status as WorktreeSummary["status"],
  };
}

export const BUILD_GIT_POLICY_INSTRUCTION = [
  "Git policy for Build:",
  "- The host already created your branch and worktree. Do not run git checkout, git switch, or git branch to create or switch branches.",
  "- Use git-repository-state or git-status to confirm the current branch instead of guessing.",
  "- Commit and push on the host-managed worktree branch through terminal-run when the user requests publish actions. Each command requires explicit product approval.",
].join("\n");

export const BUILD_PUBLISH_POLICY_INSTRUCTION = [
  "Publish policy (commit, push, pull request):",
  "- When the user asks to commit, push, publish, or open a pull request, run the git or gh commands on the current worktree branch through terminal-run.",
  "- Typical flow: git add, git commit, git push origin HEAD, then gh pr create when a remote is configured.",
  "- Every publish command requires explicit product approval before it runs. Show the exact command in the approval request.",
  "- Do not force-push or rewrite the host-managed branch. Do not push to the source base branch unless the user explicitly names that target.",
  "- Applying to the source checkout in Vraxis Changes is optional. It updates the source working tree without committing when the user wants that handoff instead of a branch PR.",
].join("\n");

export function summarizeWorktreeForEvidence(worktree: WorktreeSummary) {
  return {
    branch: worktree.branch,
    baseBranch: worktree.baseBranch,
    status: worktree.status,
    hostManaged: true,
    ...(worktree.checkpointCommit ? { checkpointCommit: worktree.checkpointCommit.slice(0, 12) } : {}),
  };
}

export function buildWorktreeInstructionBlock(worktree: WorktreeSummary): string {
  const shortBase = worktree.baseCommit.slice(0, 12);
  return [
    "Host context (isolated Build workspace):",
    `- Worktree path: ${worktree.path}`,
    `- Branch: ${worktree.branch} (already created — do not create another branch)`,
    `- Base branch: ${worktree.baseBranch} @ ${shortBase}`,
    "- The source project checkout is unchanged until the user applies your changes.",
  ].join("\n");
}

function gitExecutable(token: string): boolean {
  return token.replace(/\\/g, "/").split("/").pop()?.toLowerCase() === "git";
}

function gitSubcommand(tokens: readonly string[]): { subcommand: string; index: number } | undefined {
  if (!tokens.length || !gitExecutable(tokens[0]!)) return undefined;
  let index = 1;
  while (index < tokens.length) {
    const token = tokens[index]!;
    if (token === "-C" || token === "--git-dir" || token === "--work-tree") {
      index += 2;
      continue;
    }
    if (token.startsWith("-")) {
      index += 1;
      continue;
    }
    return { subcommand: token.toLowerCase(), index };
  }
  return undefined;
}

function blockedBuildGitMessage(hostBranch: string, subcommand: string): string {
  return `Build tasks use a host-managed branch (${hostBranch}). Do not run git ${subcommand} through the terminal. Use git-repository-state to inspect branch state and edit files on the current branch.`;
}

/**
 * Returns a user-facing error when a Build terminal command attempts host-forbidden git
 * mutations. Read-only git inspection via terminal is still allowed.
 */
export function blockedBuildGitTerminalCommand(command: string, hostBranch: string): string | undefined {
  const tokens = command.trim().split(/\s+/);
  const parsed = gitSubcommand(tokens);
  if (!parsed) return undefined;

  const { subcommand, index } = parsed;
  const args = tokens.slice(index + 1);

  if (subcommand === "push" && args.some((token) => token === "-f" || token === "--force" || token.startsWith("--force="))) {
    return `Build tasks cannot force-push the host-managed branch (${hostBranch}).`;
  }

  if (subcommand === "commit" || subcommand === "push") {
    return undefined;
  }

  if (subcommand === "branch") {
    return blockedBuildGitMessage(hostBranch, subcommand);
  }

  if (subcommand === "checkout" || subcommand === "co") {
    if (args.includes("--")) return undefined;
    if (args.some((token) => token === "-b" || token === "-B" || token === "--orphan")) {
      return blockedBuildGitMessage(hostBranch, "checkout");
    }
    if (args.some((token) => !token.startsWith("-"))) {
      return blockedBuildGitMessage(hostBranch, "checkout");
    }
    return undefined;
  }

  if (subcommand === "switch") {
    if (args.some((token) => token === "-c" || token === "-C" || token === "--create" || token === "--orphan" || token === "--detach")) {
      return blockedBuildGitMessage(hostBranch, "switch");
    }
    if (args.some((token) => !token.startsWith("-"))) {
      return blockedBuildGitMessage(hostBranch, "switch");
    }
  }

  return undefined;
}
