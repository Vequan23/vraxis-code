import assert from "node:assert/strict";
import test from "node:test";
import type { WorktreeSummary } from "@vraxis/code-contracts";
import {
  blockedBuildGitTerminalCommand,
  buildWorktreeInstructionBlock,
  summarizeWorktreeForEvidence,
} from "../src/sessions/build-workspace-context.js";

const sampleWorktree: WorktreeSummary = {
  id: "wt-1",
  path: "/tmp/vraxis/worktree-1",
  branch: "vraxis/fix-login-a1b2c3d4",
  baseBranch: "main",
  baseCommit: "abc123def4567890",
  status: "active",
};

test("buildWorktreeInstructionBlock names the host-managed branch and base", () => {
  const block = buildWorktreeInstructionBlock(sampleWorktree);
  assert.match(block, /vraxis\/fix-login-a1b2c3d4/);
  assert.match(block, /already created/);
  assert.match(block, /main @ abc123def456/);
  assert.match(block, /\/tmp\/vraxis\/worktree-1/);
});

test("summarizeWorktreeForEvidence omits filesystem paths", () => {
  const summary = summarizeWorktreeForEvidence(sampleWorktree);
  assert.deepEqual(summary, {
    branch: "vraxis/fix-login-a1b2c3d4",
    baseBranch: "main",
    status: "active",
    hostManaged: true,
  });
});

test("blockedBuildGitTerminalCommand rejects branch management but allows commit and push", () => {
  const branch = sampleWorktree.branch;
  for (const command of [
    "git checkout -b feature/foo",
    "git switch -c feature/foo",
    "git branch feature/foo",
    "git checkout main",
    "git switch main",
    "git push --force origin HEAD",
  ]) {
    const blocked = blockedBuildGitTerminalCommand(command, branch);
    assert.ok(blocked, `expected block for ${command}`);
    assert.match(blocked!, new RegExp(branch.replace("/", "\\/")));
  }

  for (const command of [
    "git commit -m test",
    "git push origin HEAD",
    "gh pr create --fill",
  ]) {
    assert.equal(blockedBuildGitTerminalCommand(command, branch), undefined, `expected allow for ${command}`);
  }
});

test("blockedBuildGitTerminalCommand allows read-only git and file restore checkout", () => {
  const branch = sampleWorktree.branch;
  assert.equal(blockedBuildGitTerminalCommand("git status --short", branch), undefined);
  assert.equal(blockedBuildGitTerminalCommand("git diff --stat", branch), undefined);
  assert.equal(blockedBuildGitTerminalCommand("git checkout -- README.md", branch), undefined);
  assert.equal(blockedBuildGitTerminalCommand("npm test", branch), undefined);
});
