# 0001: Keep the renderer unprivileged

Status: accepted

## Context

Vraxis Code needs local file access, agent runtimes, Git, commands, terminal evidence, and browser control. Giving those capabilities to the renderer would make any interface defect a project or credential boundary defect.

## Decision

The Vue renderer owns presentation and ephemeral interface state. A loopback Node service owns approved project access, persistence, agent-v, Git, commands, and browser sessions. Vraxis Desktop owns lifecycle, the native directory picker, and a fresh launch token.

The service exchanges the launch token once for a random, process-bound HttpOnly, SameSite=Strict session cookie with a 24-hour lifetime plus a separate random double-submit token for mutating requests. The launch token cannot be replayed, the old static cookie is invalid, and a service restart invalidates the session. It validates loopback hosts and origins on every request and requires the renderer's CSRF header for every desktop API mutation. The renderer receives no generic filesystem, Node.js, Electron, or IPC surface.

## Consequences

Renderer and service changes must cross a small versioned contract. Local development has two processes. The extra boundary is justified because privileged actions have one inspectable enforcement point.
