## Outcome

Describe the user-visible result and why it belongs in Vraxis Code.

## Trust boundary

List any effect on project files, commands, network access, browser control, credentials, approvals, worktrees, persistence, proof, or recovery. Write `None` only after checking each boundary.

## Verification

- [ ] Added or updated behavior-focused tests.
- [ ] Ran `npm run check`.
- [ ] Exercised changed interface flows in a browser and inspected the console.
- [ ] Verified restart or interruption behavior when persistence changed.
- [ ] Confirmed exports, logs, screenshots, fixtures, and test output contain no credentials or private workspace data.

## Compatibility

- [ ] Contract changes are versioned and migration behavior is tested.
- [ ] Runtime-provider behavior remains owned by `@vraxis/agent-v`.
- [ ] Reusable interface behavior remains owned by `@vraxis/osx-components`.
- [ ] Electron lifecycle and native integration remain owned by `@vraxis/desktop`.
