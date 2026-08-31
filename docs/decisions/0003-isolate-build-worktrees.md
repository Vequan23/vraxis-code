# 0003: Isolate every Build task in a Git worktree

Status: accepted

## Context

Build mode lets an agent edit project files. Running it in the approved source checkout would mix agent changes with the user's current work and make interruption or failure hard to recover from.

## Decision

Each Build task owns one Git worktree under Vraxis Code's local data directory. The service snapshots the approved repository's current tracked and non-ignored untracked files on a new `vraxis/` branch. If the repository has a current `HEAD`, the snapshot keeps it as its parent. If the repository has no first commit, the service creates an orphan baseline commit. Git plumbing creates the baseline without running commit hooks or requiring the user's Git identity.

The service enables Build only when agent-v reports `workspace-write` for the selected local runtime. Before execution, the coordinator confirms that the canonical execution path matches the active worktree recorded on the session. A mode label alone can never grant write access.

Build currently requires the approved project folder to be the Git repository root. This keeps the approved file boundary equal to the repository copied into the worktree.

Ignored files are not copied automatically. Broken symlinks and symlinks that point outside the approved project are rejected before execution. The snapshot becomes the comparison baseline, so the Changes view reports only agent changes instead of treating the user's existing work as agent output.

The Changes view reads status and patches from Git inside that worktree. File previews for the task use the same worktree boundary. The source checkout is never used for Build writes.

Applying a completed Build is a separate, explicitly approved product action. Vraxis Code first creates a hook-free checkpoint commit on the isolated branch and derives every file and hunk identity from that immutable checkpoint. Users may apply the remaining checkpoint, one file, or exact text-modification hunks; binary, added, deleted, copied, and renamed files remain whole-file operations so Git semantics are preserved. Git validates the complete selected patch before writing any file. The project index and `HEAD` are not changed. If source edits overlap, the operation stops, reports the exact conflicting hunks when they can be isolated, and preserves both the project and checkpoint for a smaller safe retry.

## Consequences

- A stopped or failed Build keeps its branch and files for inspection.
- The source checkout and its uncommitted work remain unchanged.
- New repositories can use Build before their first user-created commit.
- Switching a task back to Ask, Plan, or Review keeps reading from its worktree.
- Applying changes preserves the isolated branch and worktree as a recovery checkpoint.
- A failed multi-file or multi-hunk preflight leaves the approved project untouched and identifies safe retry boundaries.
- Archive, cleanup, restore, and revert remain explicit lifecycle actions with their own approval receipts. Cleanup removes the local worktree while preserving the recovery branch.
- Command approvals and verification remain separate capabilities built on top of the worktree boundary.
