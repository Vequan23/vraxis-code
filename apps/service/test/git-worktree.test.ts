import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { GitWorktrees, WorktreeApplyConflictError } from "../src/worktrees/git-worktree.js";

const execFileAsync = promisify(execFile);

async function git(cwd: string, ...args: string[]): Promise<string> {
  const result = await execFileAsync("git", args, { cwd, encoding: "utf8" });
  return result.stdout.trim();
}

test("refuses to apply a Build over overlapping project edits", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "vraxis-worktree-test-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const project = join(root, "project");
  await mkdir(join(project, "src"), { recursive: true });
  await writeFile(join(project, "src", "index.ts"), "export const value = 'base';\n");
  await git(project, "init", "-b", "main");
  await git(project, "config", "user.name", "Vraxis Test");
  await git(project, "config", "user.email", "test@vraxis.local");
  await git(project, "config", "core.autocrlf", "false");
  await git(project, "add", ".");
  await git(project, "commit", "-m", "Initial fixture");

  const worktrees = new GitWorktrees(join(root, "data"));
  const worktree = await worktrees.create(project, "project-1", "Change the value");
  await writeFile(join(worktree.path, "src", "index.ts"), "export const value = 'agent';\n");
  await writeFile(join(project, "src", "index.ts"), "export const value = 'user';\n");

  const checkpoint = await worktrees.checkpoint(worktree, "Change the value");
  Object.assign(worktree, { status: "applying" as const, checkpointCommit: checkpoint });
  assert.equal(await worktrees.applicationState(worktree, project), "conflicted");
  await assert.rejects(worktrees.applyCheckpoint(worktree, project, checkpoint), /overlapping changes/);
  assert.equal(await readFile(join(project, "src", "index.ts"), "utf8"), "export const value = 'user';\n");
  assert.match(await git(worktree.path, "rev-parse", "HEAD"), /^[a-f0-9]{40,64}$/);
});

test("applies added, deleted, and binary Build changes without committing the project", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "vraxis-worktree-apply-test-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const project = join(root, "project");
  await mkdir(join(project, "assets"), { recursive: true });
  await writeFile(join(project, "remove.txt"), "remove me\n");
  await writeFile(join(project, "assets", "sample.bin"), Buffer.from([0, 1, 2, 3]));
  await git(project, "init", "-b", "main");
  await git(project, "config", "user.name", "Vraxis Test");
  await git(project, "config", "user.email", "test@vraxis.local");
  await git(project, "config", "core.autocrlf", "false");
  await git(project, "add", ".");
  await git(project, "commit", "-m", "Initial fixture");
  const projectHead = await git(project, "rev-parse", "HEAD");

  const worktrees = new GitWorktrees(join(root, "data"));
  const worktree = await worktrees.create(project, "project-2", "Apply several file types");
  await writeFile(join(worktree.path, "added.txt"), "new file\n");
  await rm(join(worktree.path, "remove.txt"));
  await writeFile(join(worktree.path, "assets", "sample.bin"), Buffer.from([0, 9, 8, 7, 6]));

  const checkpoint = await worktrees.checkpoint(worktree, "Apply several file types");
  Object.assign(worktree, { status: "applying" as const, checkpointCommit: checkpoint });
  assert.equal(await worktrees.applicationState(worktree, project), "not-applied");
  await worktrees.applyCheckpoint(worktree, project, checkpoint);
  assert.equal(await worktrees.applicationState(worktree, project), "applied");
  assert.match(checkpoint, /^[a-f0-9]{40,64}$/);
  assert.equal(await readFile(join(project, "added.txt"), "utf8"), "new file\n");
  await assert.rejects(readFile(join(project, "remove.txt")), (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT");
  assert.deepEqual(await readFile(join(project, "assets", "sample.bin")), Buffer.from([0, 9, 8, 7, 6]));
  assert.equal(await git(project, "rev-parse", "HEAD"), projectHead);
  assert.deepEqual((await worktrees.evidence(worktree)).changes.map((change) => [change.path, change.status]), [
    ["added.txt", "added"],
    ["assets/sample.bin", "modified"],
    ["remove.txt", "deleted"],
  ]);
});

test("reverts an exact applied checkpoint and preserves project HEAD", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "vraxis-worktree-revert-test-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const project = join(root, "project");
  await mkdir(project, { recursive: true });
  await writeFile(join(project, "value.txt"), "base\n");
  await git(project, "init", "-b", "main");
  await git(project, "config", "user.name", "Vraxis Test");
  await git(project, "config", "user.email", "test@vraxis.local");
  await git(project, "config", "core.autocrlf", "false");
  await git(project, "add", ".");
  await git(project, "commit", "-m", "Initial fixture");
  const projectHead = await git(project, "rev-parse", "HEAD");
  const worktrees = new GitWorktrees(join(root, "data"));
  const worktree = await worktrees.create(project, "project-3", "Revert the value");
  await writeFile(join(worktree.path, "value.txt"), "agent\n");
  const checkpoint = await worktrees.checkpoint(worktree, "Revert the value");
  Object.assign(worktree, { status: "applying" as const, checkpointCommit: checkpoint });
  await worktrees.applyCheckpoint(worktree, project, checkpoint);
  Object.assign(worktree, { status: "applied" as const });
  await worktrees.revertCheckpoint(worktree, project);
  assert.equal(await readFile(join(project, "value.txt"), "utf8"), "base\n");
  assert.equal(await git(project, "rev-parse", "HEAD"), projectHead);
});

test("applies selected checkpoint paths without touching remaining files", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "vraxis-worktree-selective-test-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const project = join(root, "project");
  await mkdir(project, { recursive: true });
  await writeFile(join(project, "one.txt"), "one base\n");
  await writeFile(join(project, "two.txt"), "two base\n");
  await git(project, "init", "-b", "main");
  await git(project, "config", "user.name", "Vraxis Test");
  await git(project, "config", "user.email", "test@vraxis.local");
  await git(project, "config", "core.autocrlf", "false");
  await git(project, "add", ".");
  await git(project, "commit", "-m", "Initial fixture");
  const worktrees = new GitWorktrees(join(root, "data"));
  const worktree = await worktrees.create(project, "project-selective", "Selective apply");
  await writeFile(join(worktree.path, "one.txt"), "one agent\n");
  await writeFile(join(worktree.path, "two.txt"), "two agent\n");
  const checkpoint = await worktrees.checkpoint(worktree, "Selective apply");
  Object.assign(worktree, { status: "applying" as const, checkpointCommit: checkpoint });
  await worktrees.applyCheckpoint(worktree, project, checkpoint, ["one.txt"]);
  assert.equal(await readFile(join(project, "one.txt"), "utf8"), "one agent\n");
  assert.equal(await readFile(join(project, "two.txt"), "utf8"), "two base\n");
  assert.equal(await worktrees.applicationState(worktree, project, ["one.txt"]), "applied");
  assert.equal(await worktrees.applicationState(worktree, project, ["two.txt"]), "not-applied");
});

test("applies an immutable checkpoint hunk without touching another hunk in the same file", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "vraxis-worktree-hunk-test-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const project = join(root, "project");
  await mkdir(project, { recursive: true });
  const baseLines = Array.from({ length: 24 }, (_, index) => `line ${index + 1}`);
  await writeFile(join(project, "value.txt"), `${baseLines.join("\n")}\n`);
  await git(project, "init", "-b", "main");
  await git(project, "config", "user.name", "Vraxis Test");
  await git(project, "config", "user.email", "test@vraxis.local");
  await git(project, "config", "core.autocrlf", "false");
  await git(project, "add", ".");
  await git(project, "commit", "-m", "Initial fixture");

  const worktrees = new GitWorktrees(join(root, "data"));
  const worktree = await worktrees.create(project, "project-hunks", "Selective hunks");
  const agentLines = [...baseLines];
  agentLines[1] = "line 2 from agent";
  agentLines[20] = "line 21 from agent";
  await writeFile(join(worktree.path, "value.txt"), `${agentLines.join("\n")}\n`);
  const diff = await worktrees.diff(worktree, "value.txt");
  assert.equal(diff.partialSelection, true);
  assert.equal(diff.hunks.length, 2);
  const checkpoint = await worktrees.checkpoint(worktree, "Selective hunks");
  Object.assign(worktree, { status: "applying" as const, checkpointCommit: checkpoint });

  await worktrees.applyCheckpoint(worktree, project, checkpoint, [], [{ path: "value.txt", hunkIds: [diff.hunks[0]!.id] }]);
  const projectLines = (await readFile(join(project, "value.txt"), "utf8")).trimEnd().split("\n");
  assert.equal(projectLines[1], "line 2 from agent");
  assert.equal(projectLines[20], "line 21");
});

test("reports exact conflicting hunks and can apply a safe hunk separately", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "vraxis-worktree-hunk-conflict-test-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const project = join(root, "project");
  await mkdir(project, { recursive: true });
  const baseLines = Array.from({ length: 24 }, (_, index) => `line ${index + 1}`);
  await writeFile(join(project, "value.txt"), `${baseLines.join("\n")}\n`);
  await git(project, "init", "-b", "main");
  await git(project, "config", "user.name", "Vraxis Test");
  await git(project, "config", "user.email", "test@vraxis.local");
  await git(project, "config", "core.autocrlf", "false");
  await git(project, "add", ".");
  await git(project, "commit", "-m", "Initial fixture");

  const worktrees = new GitWorktrees(join(root, "data"));
  const worktree = await worktrees.create(project, "project-hunk-conflict", "Recover safe hunk");
  const agentLines = [...baseLines];
  agentLines[1] = "line 2 from agent";
  agentLines[20] = "line 21 from agent";
  await writeFile(join(worktree.path, "value.txt"), `${agentLines.join("\n")}\n`);
  const diff = await worktrees.diff(worktree, "value.txt");
  const userLines = [...baseLines];
  userLines[1] = "line 2 from user";
  await writeFile(join(project, "value.txt"), `${userLines.join("\n")}\n`);
  const checkpoint = await worktrees.checkpoint(worktree, "Recover safe hunk");
  Object.assign(worktree, { status: "applying" as const, checkpointCommit: checkpoint });

  await assert.rejects(
    worktrees.applyCheckpoint(worktree, project, checkpoint, [], [{ path: "value.txt", hunkIds: diff.hunks.map((hunk) => hunk.id) }]),
    (error: unknown) => {
      assert.ok(error instanceof WorktreeApplyConflictError);
      assert.deepEqual(error.conflicts, [{
        path: "value.txt",
        hunkIds: [diff.hunks[0]!.id],
        detail: "1 selected hunk overlaps with project edits.",
      }]);
      return true;
    },
  );
  let projectLines = (await readFile(join(project, "value.txt"), "utf8")).trimEnd().split("\n");
  assert.equal(projectLines[1], "line 2 from user");
  assert.equal(projectLines[20], "line 21");

  await worktrees.applyCheckpoint(worktree, project, checkpoint, [], [{ path: "value.txt", hunkIds: [diff.hunks[1]!.id] }]);
  projectLines = (await readFile(join(project, "value.txt"), "utf8")).trimEnd().split("\n");
  assert.equal(projectLines[1], "line 2 from user");
  assert.equal(projectLines[20], "line 21 from agent");
});

test("cleans and restores an archived worktree from its checkpoint branch", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "vraxis-worktree-restore-test-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const project = join(root, "project");
  await mkdir(project, { recursive: true });
  await writeFile(join(project, "value.txt"), "base\n");
  await git(project, "init", "-b", "main");
  await git(project, "config", "user.name", "Vraxis Test");
  await git(project, "config", "user.email", "test@vraxis.local");
  await git(project, "config", "core.autocrlf", "false");
  await git(project, "add", ".");
  await git(project, "commit", "-m", "Initial fixture");
  const worktrees = new GitWorktrees(join(root, "data"));
  const worktree = await worktrees.create(project, "project-4", "Archive the value");
  await writeFile(join(worktree.path, "value.txt"), "preserved\n");
  const checkpoint = await worktrees.checkpoint(worktree, "Archive the value");
  Object.assign(worktree, { status: "archived" as const, checkpointCommit: checkpoint, archivedFrom: "active" as const });
  await worktrees.cleanup(worktree, project);
  Object.assign(worktree, { status: "cleaned" as const });
  const restoredPath = await worktrees.restore(worktree, project);
  assert.equal(await readFile(join(restoredPath, "value.txt"), "utf8"), "preserved\n");
  assert.equal(await git(restoredPath, "branch", "--show-current"), worktree.branch);
});
