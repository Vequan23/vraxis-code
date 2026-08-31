# Workspace product contract

## User and job

The primary user is a software engineer or technical founder who already works with coding agents. The job is to select a project, give an agent a task, follow its work, approve consequential actions, inspect the diff, and verify the result.

The session pane is the most important surface. Project navigation supports it. Files, changes, terminal output, and browser evidence explain it.

## Stable homes

- Project and branch live in the workspace toolbar. Mode stays in the task header. Runtime and model selection live in the composer.
- Plans, progress, approvals, and concise tool activity live in the conversation.
- Raw command output lives in Terminal.
- Full patches live in Changes.
- Page state and interaction evidence live in Browser.
- Service and worktree state live in the status bar.

## Modes

Ask and Plan are read-only. Build writes inside an isolated worktree by default. Review inspects selected changes and does not edit until the user starts a Build task.

Permission policy is separate from mode. A mode states the user's job. Capability policy decides whether one exact action can run.

## Finishing a Build

Changes remain isolated until the user chooses **Apply changes**, **Apply file**, or selects exact text hunks from the Changes view and approves that exact project write. Applying checkpoints the agent branch first, validates the entire selection, and updates the project working tree without committing it or changing its index. Binary and structural file changes stay whole-file operations. A concurrent overlapping edit stops the operation with both versions intact, identifies conflicting hunks when possible, and lets the user apply safe changes separately.

After application, the task becomes a durable record. Additional Build edits start in a new task; Ask and Review may continue against the saved evidence. Archive, restore, and permanent cleanup are separate lifecycle decisions so finishing work never silently destroys the recovery branch.

## Responsive order

Preserve the session pane first. Collapse the inspector before the project sidebar. At narrow widths, evidence views open as full-height surfaces. Text stays at 12 pixels or larger and every action remains keyboard reachable.
