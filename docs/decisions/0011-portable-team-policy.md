# 0011: Layer signed team policy over local approval authority

Status: accepted

## Context

Remembered task and project decisions reduce approval fatigue on one installation. Teams also need consistent minimum guardrails without giving a remote administrator or imported file the power to silently approve local actions.

## Decision

Vraxis Code defines a signed, portable `vraxis.team-policy@1` bundle. It reuses the task-proof Ed25519 identity and local signer trust registry. Import requires a valid canonical digest and signature plus a locally trusted active signer.

Rules can force `ask` or `deny` for one approval capability. A team policy cannot allow an action. Team `deny` takes precedence over all local decisions. Team `ask` takes precedence over remembered allow and deny rules, requires a fresh one-time decision, and cannot be remembered. Unmatched capabilities keep the existing local policy behavior.

Invalid, expired, and untrusted installed policies fail safe by forcing fresh decisions. Settings displays policy status and provenance. Removal is local and requires a second explicit confirmation because it can widen authority. The redacted approval policy audit includes the installed policy summary.

## Consequences

- Teams can distribute one inspectable guardrail bundle without a hosted control plane.
- An imported artifact can reduce or preserve authority but can never increase it.
- Approval records can explain the exact organization policy responsible for a fresh prompt or denial.
- The product does not claim administrator lock or centrally enforced removal. Device-management enforcement is a separate future boundary.
