# 0010: Encrypt recoverable browser authentication state

## Context

An agent-controllable browser needs continuity across service restarts, but a reusable Playwright profile stores cookies and site storage as ordinary browser files. Isolating that profile from the user's personal browser prevents accidental personal-session control, yet still leaves high-value authentication material exposed to any process that can read the product data directory. Treating screenshots and action evidence as the same storage problem would also blur exact audit evidence with live browser authority.

## Decision

Vraxis Code launches each browser session as an ephemeral Chromium browser context. After every governed browser action and during graceful close, it extracts Playwright storage state—including cookies, local storage, and IndexedDB—and seals the JSON with AES-256-GCM. The random 256-bit key is stored through agent-v's operating-system credential store, never returned to the renderer, and never written beside the encrypted state. The session identifier is authenticated as additional data so moving ciphertext to another session fails integrity verification. State directories and envelopes use owner-only POSIX modes where supported, and decryption, format, or key failures stop restoration with a reset instruction.

Screenshot pixels, visible text, console/network summaries, origin grants, and action receipts remain exact task evidence in their existing authenticated local stores. They do not grant a live web session and are intentionally not placed inside the authentication-state envelope. Portable proof and browser replay continue to cross their own explicit redaction and disclosure boundaries.

Existing Vraxis-owned persistent profiles migrate once. To make origin-scoped local storage visible without transmitting legacy cookies, migration routes every request to a local in-process response, loads the retained origin against that network-inert response, extracts storage state, seals it, and closes Chromium. The original profile is renamed and preserved owner-only for recovery rather than deleted implicitly. If any step fails, the source profile remains in place and restoration fails closed.

## Consequences

- Reading the Vraxis Code data directory alone no longer yields reusable plaintext browser cookies or site storage.
- Browser restoration depends on the operating-system credential entry; losing it makes old state intentionally unrecoverable without a reset.
- Authentication state is durable after governed actions and graceful close. A crash can lose a page's last asynchronous state mutation, but does not fall back to plaintext persistence.
- Legacy migration performs no external network request and never silently deletes the source profile, at the cost of temporary duplicate sensitive storage until the user receives deliberate cleanup and recovery controls.
- Exact screenshots and browser evidence remain sensitive user data even though they do not contain the encrypted live-session state by design.
