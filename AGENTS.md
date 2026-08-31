# Working on Vraxis Code

Vraxis Code is the owning product for coding-agent sessions, project workspaces, worktrees, approvals, changes, and verification history.

## Boundaries

- Use `@vraxis/agent-v` for provider-neutral runtime discovery and execution.
- Use `@vraxis/osx-components` for reusable OS X-inspired interface behavior.
- Use `@vraxis/desktop` for Electron lifecycle, native folder selection, and packaging.
- Keep provider adapters, reusable interface primitives, and Electron security mechanics out of this repository.
- Never read another Vraxis product's private storage.

## Safety

- Keep all file access inside a user-approved project root.
- Keep project mutations inside an isolated worktree by default.
- Require explicit capability decisions for commands, network access, browser control, external writes, destructive actions, and credentials.
- Do not expose Node.js, Electron, generic IPC, provider keys, or unrestricted filesystem access to the renderer.
- Preserve sessions, drafts, approvals, and recovery state across application restarts.

## Structure

Organize by product domain. Do not create generic `utils`, `helpers`, or `managers` directories. Shared renderer and service data must cross the versioned contracts package.

## Verification

Run `npm run check`. Exercise changed user flows in a browser and inspect the console before calling interface work complete.
