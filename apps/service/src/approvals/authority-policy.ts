import type { ApprovalDuration, ApprovalSummary, AuthorityMode } from "@vraxis/code-contracts";

export interface AuthorityOptions {
  mode: AuthorityMode;
  durations: ApprovalDuration[];
  reason: string;
}

/** Defines how far an explicit approval may be remembered. It never approves an action by itself. */
export function authorityOptions(mode: AuthorityMode, approval: Pick<ApprovalSummary, "capability" | "rememberable">): AuthorityOptions {
  if (approval.rememberable === false || approval.capability === "credentials" || approval.capability === "destructive") {
    return { mode, durations: ["once"], reason: "This sensitive action always requires a fresh decision." };
  }
  if (mode === "supervised") {
    return { mode, durations: ["once"], reason: "Supervised mode authorizes only the exact request in front of you." };
  }
  if (mode === "trusted-worktree") {
    return { mode, durations: ["once", "session"], reason: "Trusted Worktree can remember an exact scope for this task." };
  }
  return {
    mode,
    durations: ["once", "session", "project"],
    reason: "Full Access can remember an exact scope for this project after you approve it once.",
  };
}
