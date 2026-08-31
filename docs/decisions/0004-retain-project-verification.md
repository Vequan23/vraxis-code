# 0004: Retain project verification as task evidence

Status: accepted

## Context

A successful agent response or clean diff does not prove a project works. Coding harnesses often leave verification as transcript text, lose the command output after restart, or run inferred commands without making their authority and scope clear. Vraxis Code needs a proof boundary that works across runtimes without granting a provider direct control over product state.

## Decision

Vraxis Code asks `@vraxis/agent-v` to inspect an approved project root without executing project code. Project Doctor reads bounded, known manifests and returns provider-neutral ecosystem, framework, package-manager, development-server, and verification-check definitions. Every command is represented as an executable plus argument vector, relative working directory, source manifest, timeout, and required flag.

A repository may override conventional discovery with a bounded `.vraxis/verify.json` contract. The product validates its size, schema, service and command shape, project-relative working directories and visual baselines, strict booleans, browser and health protocols, and real paths before creating a run. The recipe remains declarative: it grants no authority, and every service and command still crosses the product approval lifecycle. A configured browser target becomes part of the recipe identity and proof must be captured from that exact URL. Route, title, visible-text, console, network, and visual evidence are evaluated from that capture; declared services are health-checked and torn down after every terminal outcome.

The product service owns execution. Starting verification creates a durable run before requesting authority. Each discovered command passes through the existing command approval policy, executes in the task's visible PTY, and retains its terminal receipt. Checks run sequentially so approval, failure, interruption, and output remain attributable. A failed or denied required check fails the verification run.

When the project declares a local development server, browser proof is recommended after required commands pass. Browser proof captures the current task browser and evaluates console and failed-network evidence recorded since that verification run began. A run cannot become `passed` while required command or browser proof is missing.

Verification summaries cross the renderer boundary through versioned product contracts and are included in bootstrap, live evidence, activity events, and task receipts. Recovery marks runs left active across restart as interrupted rather than silently retrying commands.

The normalized check definitions and browser requirement produce a stable SHA-256 recipe fingerprint. A terminal run can be rerun from that retained recipe without re-inspecting mutable manifests; the new run receives fresh approval and evidence identifiers, records its source run, and binds the recipe to the task's current changed-file scope. The fingerprint and rerun lineage appear in the UI, canonical receipt, and offline proof.

## Consequences

- Runtime output cannot self-assert that verification passed.
- Inspection is safe to refresh because it never executes project scripts.
- A user can inspect the exact command, approval, terminal receipt, and browser evidence behind a result after restart.
- Common manifest conventions are automatic and custom single-process recipes are explicit; multi-service startup and health orchestration remain future recipe capabilities.
- Browser proof uses the run start as its evidence baseline; richer route assertions and visual comparison remain future recipe capabilities.
