# 0011: Embed the live task browser in Vraxis Desktop

## Context

The original browser inspector synchronized screenshots captured by a headless Playwright session. That made agent actions inspectable, but ordinary browsing felt indirect: scrolling, selection, focus, authentication, and page interaction happened through a captured representation rather than the page itself.

Giving the Vue renderer Electron IPC or an unrestricted `webContents` handle would fix the interaction problem by breaking the product's most important trust boundary. A renderer compromise could bypass product approvals and actuate network side effects directly.

## Decision

Vraxis Desktop owns one real `WebContentsView` tab set per task. The product renderer receives only a bounded layout method and read-only navigation state. Vraxis Code's local service sends typed browser actions directly to Desktop over a loopback-only control server protected by a random per-launch bearer token. The token is injected into the child service environment and is never returned to the renderer.

Remote pages run without Node integration or preload access, with context isolation, renderer sandboxing, web security, permission denial, download blocking, safe navigation protocols, and isolated in-memory session partitions. Page popups become tabs inside the same isolated browser session. Vraxis Code still owns origin approvals, mapped-control actuation, serialization, screenshots, text, console/network evidence, before/after frames, and action receipts. The Playwright implementation remains the browser-build fallback.

## Consequences

- Users scroll, select, type, authenticate, and navigate in the real page while agents act on the same page state.
- Browser control cannot bypass the product approval lifecycle through renderer IPC.
- Live authentication survives tabs and tasks during one app launch but intentionally does not survive an app restart in the desktop path.
- Retained evidence remains reviewable after restart and does not itself grant browser authority.
- Vraxis Desktop owns Electron mechanics; Vraxis Code owns product policy and evidence.
