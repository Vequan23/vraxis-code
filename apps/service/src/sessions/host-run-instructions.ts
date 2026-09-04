import type { SessionMode, WorktreeSummary } from "@vraxis/code-contracts";
import { BUILD_GIT_POLICY_INSTRUCTION, BUILD_PUBLISH_POLICY_INSTRUCTION, buildWorktreeInstructionBlock } from "./build-workspace-context.js";
import { TASK_RECOVERY_INSTRUCTION } from "./task-recovery-instruction.js";

export function hostAgentInstructions(mode: SessionMode, worktree?: WorktreeSummary): string {
  if (mode === "build") {
    const parts = [
      "Work only inside the approved isolated worktree. Request approval for guarded writes, commands, network, or browser actions and verify the result.",
      TASK_RECOVERY_INSTRUCTION,
      "Modify only files needed for this task inside the isolated workspace. Publish actions run on the worktree branch through approved terminal commands.",
      BUILD_GIT_POLICY_INSTRUCTION,
      BUILD_PUBLISH_POLICY_INSTRUCTION,
    ];
    if (worktree) parts.splice(2, 0, buildWorktreeInstructionBlock(worktree));
    return parts.join("\n\n");
  }
  return [
    "Inspect only the approved repository and browser evidence. Use read tools for evidence and never claim files you did not inspect.",
    TASK_RECOVERY_INSTRUCTION,
    "This mode is read-only: do not edit files or run commands. You may use host-provided browser controls when relevant, but every control action requires product approval. Never enter, infer, or expose credentials; ask the user to complete sensitive authentication fields themselves.",
  ].join("\n\n");
}

export function mergeHostInstructions(existing: string | undefined, host: string): string {
  const turn = existing?.trim();
  return turn ? `${host}\n\n${turn}` : host;
}
