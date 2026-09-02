# Changelog

All notable changes to Vraxis Code will be documented here. The project follows semantic versioning once a public release is tagged.

## Unreleased

### Added

- Git status, diff, history, and structured repository-state tools in every agent mode, with explicit approval for refreshing remote-tracking refs. Runtime tool inventories are tested against the capabilities advertised by each mode.
- Four-mode coding-agent workspace with provider-neutral agent-v runtime discovery and execution.
- Isolated Build worktrees with exact diffs, selective apply, conflict evidence, rollback, archive, and recovery.
- Product-owned approvals for filesystem changes, commands, network access, browser actuation, credentials, and destructive actions.
- Streaming PTY terminal receipts and an isolated, agent-controllable browser with mapped controls, screenshots, console, network, and action evidence.
- Project-owned verification recipes with governed services, commands, browser assertions, and visual comparison.
- Signed task proof, cross-install trust enrollment, key rotation attestations, and secret-minimized signed Understand artifacts.
- Desktop packaging, unexpected-exit recovery, support diagnostics, cross-platform CI, browser coverage, and packaged application smoke tests.
- Immutable GitHub Action pins, dependency review, lockfile vulnerability auditing, CodeQL analysis, issue forms, and private vulnerability-reporting guidance for the public repository.
- Published `@vraxis/agent-v@0.10.0` integration for governed local-harness MCP tools, scoped approvals, browser evidence, and project inspection.
- Published `@vraxis/osx-components@0.12.2` integration that preserves native `title` behavior without Vue custom-element collision warnings.
- Self-contained offline browser evidence replay with before/after playback, actor and approval provenance, embedded retained frames, and no external network authority.
- Signed portable team-policy packs with trusted-signer import, ask-or-deny precedence, approval provenance, audit inclusion, and explicit local removal.
- Tag-gated macOS release automation that requires signing and notarization, reruns quality and browser gates, verifies artifact identity, size, SHA-256, and download URL, and refuses unsigned publication.
- Automated axe WCAG 2.0/2.1 A and AA regression coverage across onboarding, the active workspace, all evidence views, and Settings, including open osx Components shadow roots.
- User-mediated incident reporting with a safe clipboard summary, versioned privacy-bounded support bundle, and empty public bug-report handoff that never uploads local data automatically.

### Security

- Redact portable proof receipts before signing so JSON and HTML exports remove common tokens, authorization values, secret assignments, command secret flags, URL credentials, queries, and fragments without mutating exact local evidence.
- Apply restrictive CSP, framing, referrer, permissions, MIME-sniffing, and cross-origin headers to the local service; constrain product data and attachment storage to owner-only permissions on supported platforms.
- Replace reusable plaintext Playwright profiles with ephemeral browser contexts and AES-256-GCM authentication-state envelopes whose keys live in the operating-system credential store and whose integrity is bound to the session identity.
- Migrate legacy isolated browser profiles without external network access, retain the source profile owner-only for recovery, and fail closed when state decryption or integrity verification fails.
- Flush encrypted browser authentication state and close live browser resources before a graceful service shutdown is marked complete.
- Prevent imported team policy from granting authority: bundles can only force a fresh decision or deny a capability, and invalid, expired, or untrusted installed policy fails safe.

### Fixed

- Build the private contracts workspace before Playwright starts so the browser suite is reliable on a clean clone instead of depending on stale local build output.
- Preserve quoted Windows executable paths, resolve `PATHEXT` commands, and unwrap verified Node package-manager shims without granting a shell so governed terminal and verification commands work consistently across platforms.
- Close live terminal processes, browser contexts, and test HTTP resources deterministically so shutdown receipts remain accurate and cross-platform quality jobs cannot be stranded by open handles.
- Terminate approved Windows PTY process trees through the operating-system task controller instead of passing unsupported POSIX signals into ConPTY.
- Resolve Windows commands through `PATHEXT` before extensionless POSIX shims, enforce project-root boundaries with native separators, and keep cross-platform tests focused on product behavior rather than PTY or filesystem encoding details.
