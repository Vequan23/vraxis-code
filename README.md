# Vraxis Code

## Give an agent a real workspace

Vraxis Code is a local coding app for running agents, watching their work, and reviewing every change. Your project stays on your machine. Builds happen in isolated Git worktrees. Terminal commands, browser actions, credentials, and project writes stay behind explicit approval.

The workspace puts the conversation, code, terminal, browser, changes, approvals, and verification history in one place.

### What works today

- Run Ask, Plan, Build, and Review tasks through [`@vraxis/agent-v`](https://www.npmjs.com/package/@vraxis/agent-v).
- Discover local Codex, Claude Code, OpenCode, Cursor, and other compatible runtimes.
- Keep each Build in its own Git worktree by default.
- Inspect exact patches before applying them to your project.
- Run a live PTY terminal with approval, interruption, resize, search, and retained output.
- Control a sandboxed Chromium browser from the app or an agent.
- Capture screenshots, visible text, console logs, network evidence, and action receipts.
- Discover project checks without running project code.
- Save verification results and recovery state across restarts.
- Export signed task proof and an offline browser replay.

## Start locally

Vraxis Code requires Node.js 22.12 or newer.

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:4318`. The web app connects to the local service at `http://127.0.0.1:4317`.

Run the full project gate before submitting a change:

```bash
npm run check
```

## How a Build works

1. Choose a project and runtime.
2. Describe the change in the composer.
3. Vraxis creates an isolated worktree and starts the agent.
4. The agent requests approval before guarded actions.
5. Review the patch and verification evidence.
6. Apply, revert, archive, or restore the worktree.

The agent never receives unrestricted filesystem, Electron, or provider-key access from the renderer. The local service validates project paths and owns every privileged action.

## Browser and terminal

The desktop browser runs as a sandboxed Electron `WebContentsView` with a task-scoped in-memory partition. Agents act through mapped page controls instead of arbitrary selectors. Vraxis blocks downloads. It also removes URL query values and common credentials from exported evidence.

The web development build uses an isolated Playwright browser. Both browser paths retain action frames, page text, console output, network evidence, and approval provenance with the task.

The terminal uses a real PTY. Agent commands and user commands share the same visible session. Command execution, interruption, and retained output follow the product approval policy.

## Runtime support

Vraxis Code uses `@vraxis/agent-v` for runtime discovery and execution. Each runtime reports support for repository reads, isolated writes, terminal access, browser control, skills, model selection, and retained task evidence before a task starts.

Hosted runtimes receive guarded project tools. Compatible local coding CLIs receive the same tools through a private MCP bridge. Each bridge belongs to one task. It exposes redacted evidence state without leaking command output, page content, URLs, credentials, or approval details.

## Verification and proof

Project Doctor reads manifests and finds the checks a project already defines. Projects can add a bounded [`.vraxis/verify.json`](docs/product/verification-recipes.md) file for service startup, loopback health checks, route assertions, visible-page assertions, and image baselines.

Verification results stay attached to the task. A completed task can export signed JSON proof, printable offline HTML, or a secret-minimized [Understand artifact](docs/product/understand-artifacts.md). Nothing uploads automatically.

## Repository map

```text
apps/
  desktop/      Electron lifecycle and native integration
  service/      local Node service and project access boundary
  web/          Vue renderer and workspace interface
packages/
  contracts/    versioned renderer and service contracts
  test-runtime/ deterministic agent-v runtime for tests
docs/
  decisions/    architecture decision records
  product/      product and interaction contracts
  security/     threat model and permission policy
```

## Product contracts

- [Workspace and task behavior](docs/product/workspace.md)
- [Security model](docs/security/threat-model.md)
- [Terminal and browser capabilities](docs/decisions/0002-terminal-and-browser-capabilities.md)
- [Isolated Build worktrees](docs/decisions/0003-isolate-build-worktrees.md)
- [Embedded live browser view](docs/decisions/0011-embed-live-browser-view.md)
- [Verification recipes](docs/product/verification-recipes.md)
- [Team approval policy](docs/product/team-policy.md)
- [Recovery diagnostics](docs/product/recovery-diagnostics.md)
- [Accessibility contract](docs/product/accessibility.md)
- [Release procedure](docs/product/releasing.md)

## Current boundaries

- Browser sessions never reuse the user's personal browser profile.
- Live browser authentication expires when the desktop app exits.
- Browser evidence can still contain private page content. Review it before sharing.
- Build writes stay inside an isolated worktree unless the user approves an apply action.
- Sensitive actions always require a fresh decision.
- Runtime maintenance runs as an approval-gated task with visible terminal output.
- Public macOS releases fail closed when signing or notarization is unavailable.

See the [process boundary decision](docs/decisions/0001-process-boundary.md) for the core architecture.
