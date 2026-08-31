# Recovery and incident diagnostics

Vraxis Code detects an unexpected previous service exit on the next launch, reconciles interrupted approvals, terminal runs, verification, and worktree application, and shows that recovery before work resumes.

Settings provides three explicit incident handoff actions:

- **Copy safe summary** creates a short environment, runtime-readiness, unexpected-exit, interrupted-record, and worktree-review summary.
- **Export support bundle** downloads the versioned `vraxis.support-bundle@1` JSON artifact, whose public contract is defined by the [support-bundle JSON Schema](../schemas/support-bundle.schema.json).
- **Open bug report** opens the public GitHub form without sending the summary, bundle, or any local data.

Nothing is uploaded automatically. The user decides what to copy or attach and is told to review the artifact before sharing.

## Privacy boundary

The support artifact can include:

- Vraxis Code, contract, Node, operating system, and architecture versions;
- whether the desktop session boundary is active;
- project and task state counts without identities;
- runtime IDs, names, versions, authentication status, update status, and conformance state;
- unexpected-exit and interrupted approval, terminal, verification, and worktree counts;
- fixed security-boundary declarations.

It excludes:

- project names and paths;
- task titles, prompts, messages, and skill content;
- source, file names, diffs, and worktree paths;
- approval descriptions and scopes;
- commands, working directories, terminal input, and output;
- browser URLs, text, screenshots, controls, console, network, cookies, and storage;
- model credentials and proof private keys.

The safe clipboard summary is derived only from the same bounded support artifact. It never reads task or project content.

## Current boundary

This is user-mediated incident reporting, not background telemetry. It provides a useful privacy-preserving handoff without introducing a third-party crash vendor or a network reporting authority. Native crash dumps, stack traces, automatic symbolication, explicit opt-in upload, retention controls, and server-side deletion remain future work and require a separate security and consent design.
