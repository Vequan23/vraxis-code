import assert from "node:assert/strict";
import test from "node:test";
import { hostAgentInstructions, mergeHostInstructions } from "../src/sessions/host-run-instructions.js";

test("hostAgentInstructions centralizes recovery and mode policy once", () => {
  const ask = hostAgentInstructions("ask");
  assert.match(ask, /read-only/);
  assert.match(ask, /After every tool result/);

  const build = hostAgentInstructions("build", {
    id: "wt-1",
    path: "/tmp/worktree",
    branch: "vraxis/task",
    baseBranch: "main",
    baseCommit: "abc123456789",
    status: "active",
  });
  assert.match(build, /Work only inside the approved isolated worktree/);
  assert.match(build, /Host context \(isolated Build workspace\):/);
  assert.match(build, /Git policy for Build/);
  assert.doesNotMatch(build, /read-only/);
});

test("mergeHostInstructions prepends host policy before turn guidance", () => {
  const merged = mergeHostInstructions("Return concise Markdown.", "Host policy.");
  assert.equal(merged, "Host policy.\n\nReturn concise Markdown.");
});
