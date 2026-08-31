# Contributing

Vraxis Code is early in development. Open an issue before starting a large change so its product boundary and recovery behavior can be reviewed first.

## Setup

```bash
npm install
npm run check
```

Add tests with the feature. Use temporary repositories for file, Git, worktree, or command integration tests. Do not depend on a developer's global credentials or runtime authentication in the default test suite.

Keep changes inside the owning domain. Public contract changes need a versioned migration and a test that covers malformed or stale input.
