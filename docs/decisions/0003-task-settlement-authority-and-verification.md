# 0003: Make task settlement, authority, and verification first-class product state

Status: accepted

## Context

A coding harness cannot infer completion from a quiet process, treat every approval as an isolated modal, or leave browser verification disconnected from the page being inspected. Those shortcuts make recovery ambiguous, encourage approval fatigue, and hide whether a result was actually checked.

## Decision

Every task attempt has a durable settlement record. It distinguishes running, complete, failed, interrupted, and recovery-needed states; records attempt and timing metadata; and settles any open timeline events when execution stops. A restart converts unfinished work into an explicit resumable recovery state instead of presenting it as complete.

Authority is a visible user preference with supervised, trusted-worktree, and full-access modes. A mode changes only how long an exact, explicit approval can be remembered. It never creates authority by itself. Credential and destructive capabilities always require a fresh one-time decision, and team policy can narrow or deny every mode.

Browser verification is presented in the live browser surface. A retained run links its recipe, assertions, actions, and captured browser evidence so the user can run checks, rerun the exact recipe, capture fresh proof, open the target, or stop active work without moving to a separate verification mode.

## Consequences

Task recovery is deterministic and inspectable. Approval prompts disclose actor, boundary, mode, and whether authority was explicit, remembered, or denied by policy. The interface offers only the approval durations permitted by the selected mode and capability.

Verification evidence includes the captured URL, title, timestamp, screenshot version, console and network error counts, and action count. The hidden legacy verification inspector remains an implementation detail until it can be removed without breaking retained flows.
