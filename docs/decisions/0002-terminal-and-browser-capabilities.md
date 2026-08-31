# 0002: Treat terminal and browser control as bounded capabilities

Status: accepted

## Context

Terminal commands and browser automation are central evidence surfaces, but both can mutate projects, contact external services, disclose credentials, or trigger irreversible actions.

## Decision

The right inspector owns Files, Changes, Terminal, and Browser views. Agent requests enter the local service as typed capability requests.

Terminal requests include the exact command, working directory, session, timeout, and expected side effect. Browser requests are limited to navigation, mapped-control click and type, capture, bounded waits, tab management, back, and reload. Each request includes a session and explicit target. Script execution and arbitrary selectors are not part of the contract.

Read-only capture, tab selection, new blank tabs, and tab closure do not interrupt the user. Navigation, typing, reload/back, credential use, and external side effects require policy evaluation and an inspectable approval. Downloads are blocked; uploads are not exposed. Agents may request their first HTTP loopback or HTTPS origin, but execution receives the approval receipt and the new origin is granted only after that decision.

## Consequences

Agent provenance and raw evidence stay connected to one session. Terminal output streams into a bounded durable receipt, and interruption terminates the spawned process group where the platform supports it. Browser receipts include the actor, approval ID, screenshot version, console evidence, and credential-redacted network metadata.

Browser evidence is written atomically with restrictive local permissions and survives a service or application restart independently of the live Playwright process. A recovered screenshot, text snapshot, control map, network log, and action history are clearly labeled as saved evidence. Saved controls cannot actuate the page; an approved restore reopens the last URL in the isolated task profile and creates a fresh control map before interaction continues. Previously approved per-task origins remain attached to that task.

The product still does not become a general-purpose terminal emulator or personal web browser.
