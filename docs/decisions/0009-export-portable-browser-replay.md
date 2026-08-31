# 0009: Export browser evidence as a self-contained offline replay

## Context

Retained screenshots and action receipts make browser work auditable inside Vraxis Code, but a reviewer outside the installation needs a coherent artifact rather than a folder of frames. Uploading evidence to a hosted video or replay service would add a new trust boundary, lose typed approval provenance, and make a local-first product dependent on third-party availability. A conventional recording is also difficult to inspect action by action.

## Decision

Vraxis Code exports one self-contained HTML document from the task's retained browser action frames. The document embeds PNG bytes, orders before and after phases chronologically, and provides previous, next, play, pause, seek, and speed controls. Each frame retains actor, status, target, page title, capture time, and approval identity where present.

Portable metadata crosses the same secret-minimization boundary as signed proof: credentials, URL query values and fragments, authorization values, common provider tokens, secret assignments, and command secret flags are removed before serialization. The document uses a per-export CSP nonce and grants no external network, form, object, base, or framing authority. It does not depend on Vraxis Code after download.

Screenshot pixels remain exact evidence and are not automatically blurred. The interface and artifact warn that screenshots can contain private page content and must be reviewed before sharing. Missing retained frames are skipped; an export with no readable frames is rejected instead of producing misleading proof.

## Consequences

- A teammate can replay what the agent saw without an account, server, or network connection.
- Typed actor and approval provenance remain inspectable instead of being flattened into video.
- The product creates no hosted evidence-storage or upload boundary.
- The artifact is deterministic and testable in a real browser, but it is not a compressed video and can be large for screenshot-heavy tasks.
- Frame annotation, selective redaction, and lossy video rendering remain separate future capabilities.
