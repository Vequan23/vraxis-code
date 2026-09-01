# 0004: Treat steering as durable task input, not ephemeral process control

Status: accepted

## Context

Coding tasks often need correction before a turn finishes. Requiring the user to stop, wait, and create another task loses momentum and makes the composer unreliable precisely when it is most useful. Local harnesses also differ in whether they expose a stable native conversation identifier, so product continuity cannot depend on a provider-specific resume flag.

## Decision

An active task accepts two explicit delivery choices:

- **Send after this turn** persists the message immediately and runs it after the active turn completes successfully.
- **Interrupt and send** persists the message, supersedes older queued instructions, settles the active attempt as redirected, cancels its runtime process, and starts the new direction with retained task history.

Steering messages carry their own queued, running, handled, or superseded delivery state. The session exposes a compact pending count and whether a redirect is in progress. Attachments and skills remain bounded by their existing validation and consent rules.

Vraxis Code reconstructs continuity from its durable, host-approved transcript and artifacts for every runtime. Native provider session resumption may be added later through `@vraxis/agent-v`, but the product does not claim or require it today.

## Consequences

The composer remains available while an agent is working. Mode, runtime, and model stay locked for the active turn, while the user may add context, queue work, redirect, or stop. A queued instruction survives restart as retained task input and becomes the next input when the interrupted task resumes.

Redirecting is not silent cancellation: the timeline records the boundary, settlement remains inspectable, and the next attempt receives only handled transcript messages plus the new instruction. Instructions still waiting in the queue are excluded from another run's context until their turn begins.
