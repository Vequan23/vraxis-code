# Coding harness conformance

This record maps Vraxis Code and `@vraxis/agent-v` to *Requirements for a Proficient Coding Harness, version 1.0*. It distinguishes implemented guarantees from desirable competitive work so product claims remain testable.

## Minimally proficient gate

| Requirement | Status | Enforced by |
| --- | --- | --- |
| Exact edits, read-before-edit, staleness rejection | Implemented | agent-v content stamps are scoped to the run/session. Exact edits fail on unread, stale, zero-match, or ambiguous targets; multi-file patches validate before replacement. Creation is a separate, non-overwriting tool. |
| Line-numbered paginated reads | Implemented | `read-text` accepts one-based `offset` and bounded `limit`, returns total and returned lines, distinguishes empty files, and gives an explicit continuation. |
| Content and path search | Implemented | `search-text` performs bounded filesystem search with literal/regex matching, glob filters, context lines, and line/path/count modes. `find-files` remains a separate bounded path operation. |
| Governed command execution | Implemented | Commands use argv rather than a shell, validate cwd against the approved root, have caller deadlines under a hard ceiling, return status and exit evidence, retain bounded head and tail, and support background run/poll/stop handles. Vraxis Code persists the visible PTY receipt. |
| Context accounting and graceful compaction | Implemented | agent-v accounts for instructions, tool schemas, transcript, artifacts, and tool results. Budget pressure creates a disclosed continuity record preserving task, decisions, files, errors, plan, and recent turns instead of failing the trajectory. |
| Explicit roots and execution location | Implemented | Every run carries explicit scope and the UI identifies the local project or isolated Build worktree. Canonical-path checks reject root and symlink escape. Commands run with the local user's OS authority; no container sandbox is claimed. |
| Argument-level scoped permissions | Implemented | Product approvals record exact capability and scope, support once/task/project authority, deny precedence, expiration, revocation, fresh-only sensitive actions, and avoid repeat prompts for covering grants. Ask, Plan, and Review remain read-only. |
| Automatic post-edit feedback | Implemented | Build workspace mutations automatically run the host-declared `git diff --check --no-ext-diff` check and return its receipt to the trajectory. Blocking hooks are supported by agent-v. Project-specific scripts remain approval-gated through Project Doctor because executing repository code silently would violate the permission model. |
| Interrupt, steer, persist, resume | Implemented | Task transcripts, drafts, events, approvals, worktrees, terminal/browser evidence, and verification survive restarts. Runs and tools accept cancellation; follow-up messages retain the task context. |
| Token and cost attribution | Implemented with honest availability | The task timeline persists estimated context category usage and adapter-reported token/cost data. Subscription CLIs and providers that do not report monetary cost are labeled unavailable; Vraxis never invents a dollar value from a stale price table. |
| Harness evals on changes | Implemented | agent-v's `test:harness` gate takes a real invalid file through strict read/edit and automatic syntax verification, exercises search and background processes, and runs inside the package's full `npm run check`. Vraxis Code adds integration, browser, recovery, approval, terminal, browser-control, worktree, and release tests. |

The minimally proficient gate is complete. A clean release still requires both repositories' full checks and the product browser suite.

## Additional requirements already covered

- Skills load from standard `SKILL.md` packages and never gain authority through metadata. The composer can discover and attach them; the runtime validates their tool and permission surface.
- The private per-run MCP bridge gives Codex, Claude Code, OpenCode, and verified Cursor releases the same governed host tools without durable CLI configuration or native write authority.
- Build work occurs in an isolated worktree with checkpoint, restore, apply, archive, and rollback lifecycles. Commits and pushes run on the worktree branch through approved terminal commands; Vraxis never publishes without an explicit approval decision.
- The task browser provides live desktop Chromium, mapped controls, screenshots, console/network evidence, approval receipts, and replay. External content is evidence, never runtime instruction.
- Progress and output stream as ordered durable events. Approvals, terminal runs, browser actions, diffs, verification, context compaction, and usage remain inspectable after recovery.
- Tool-request events are redacted before persistence, and Vraxis workspace mutations reject high-confidence credential material while permitting environment-variable and credential-store references.
- Project instructions are passed through compatible local harnesses. agent-v keeps skill and tool schemas opt-in so unused capabilities do not tax every run.

## Competitive work, not competency blockers

These items remain intentionally open and should not be disguised as finished:

1. Product-level subagent orchestration with separate read-only scopes, summarized returns, isolated worktrees for writers, progress, and per-agent usage.
2. Headless and scheduled tasks with a fail-closed non-interactive approval policy and an explicit blocked-question outcome.
3. Published longitudinal harness metrics: edit application, tool error, turns, tokens, compaction, verification, and silent-corruption rates. Metrics must be opt-in and privacy-bounded.
4. Structural/AST-aware search adapters where a language ecosystem offers a reliable parser.
5. Native image, PDF-page, and notebook-cell readers. Those belong in explicit host adapters rather than pretending bytes are useful context.
6. Prompt-cache reporting and stable-prefix optimization for adapters that expose authoritative cache usage.
7. Trigger evaluation for every bundled skill and tool, including adjacent negative examples and collision reporting.
8. A product-owned project-instruction loader with documented nested-file precedence for hosted runtimes; compatible local harnesses continue to apply their native instruction-file rules.

## Safety interpretation

The source document recommends automatic formatter, linter, and typechecker hooks after edits. Vraxis supports those hooks but does not automatically execute arbitrary repository scripts under a file-write approval. The default automatic check is the non-executing Git whitespace validator; Project Doctor presents repository-owned checks for explicit command approval. This preserves deterministic feedback without silently expanding write authority into code execution.

Likewise, cost reporting means preserving authoritative provider data and clearly reporting its absence. It does not mean estimating subscription value or guessing future model pricing.
