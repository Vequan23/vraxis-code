# 0007: Govern runtime maintenance as product tasks

## Context

Runtime discovery can identify official install, authentication, and update actions, but copying a command into an unrelated shell loses approval scope, output, exit status, recovery state, and attribution. Accepting a command string from the renderer would also turn a setup convenience into an unrestricted execution path.

## Decision

When an approved project is open, Vraxis Code re-discovers the selected local runtime in the service and resolves the requested action by its registered identifier. Documentation actions remain HTTPS links to an allowlisted official host. Command actions create a dedicated read-only Runtime Doctor task tied to the approved project.

The service constructs the command from the discovered executable and argument vector, executes it without a shell, and requires a fresh, non-rememberable high-risk terminal approval. The task retains the approval, bounded PTY stream, exit status, and completion or failure lifecycle event. The renderer cannot supply or alter the executable, arguments, working directory, or approval scope. Without an approved project, Vraxis can only copy the discovered command for a manual handoff.

## Consequences

- Harness maintenance has the same provenance and recovery story as other product actions.
- Global or network-affecting updates remain explicit even when a project has broader remembered terminal rules.
- A user must choose a project before Vraxis can run maintenance; first-run setup without one remains a manual handoff.
- Runtime inventory still needs an explicit refresh after maintenance so version-bound conformance can become stale or be reverified truthfully.
