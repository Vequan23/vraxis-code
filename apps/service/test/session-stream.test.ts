import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SessionRegistry, type SessionStreamUpdate } from "../src/sessions/session-registry.js";

test("session subscriptions publish ordered deltas after persistence", async () => {
  const root = await mkdtemp(join(tmpdir(), "vraxis-session-stream-"));
  const sessions = new SessionRegistry(root);
  const session = await sessions.create({
    projectId: "project-1",
    mode: "ask",
    runtimeId: "codex",
    prompt: "Explain this project",
  });
  const updates: SessionStreamUpdate[] = [];
  const unsubscribe = sessions.subscribe(session.id, (update) => updates.push(update));

  await sessions.begin(session.id);
  await sessions.progress(session.id, "Reading files", "Inspecting the project.", "running");
  await sessions.progress(session.id, "Mapping modules", "Following imports.", "running");
  await sessions.attachWorktree(session.id, {
    id: "worktree-1",
    path: "/tmp/worktree-1",
    branch: "vraxis/session-stream",
    baseBranch: "main",
    baseCommit: "abc123",
    status: "active",
  });

  assert.deepEqual(updates.map((update) => update.cursor), [2, 3, 4, 4]);
  assert.equal(updates[0]?.session.status, "running");
  assert.deepEqual(updates[0]?.session.settlement, {
    state: "running",
    attempt: 1,
    startedAt: updates[0]?.session.updatedAt,
    resumable: false,
  });
  assert.deepEqual(updates[1]?.events.map((event) => [event.sequence, event.state]), [[3, "running"]]);
  assert.deepEqual(updates[2]?.events.map((event) => [event.sequence, event.state]), [
    [3, "complete"],
    [4, "running"],
  ]);
  assert.deepEqual(updates[3]?.events, []);
  assert.equal(updates[3]?.session.worktree?.branch, "vraxis/session-stream");

  const persisted = JSON.parse(await readFile(sessions.file, "utf8")) as {
    events: Array<{ sequence: number; state: string }>;
  };
  assert.equal(persisted.events.find((event) => event.sequence === 3)?.state, "complete");

  const snapshot = await sessions.streamSnapshot(session.id);
  assert.equal(snapshot.cursor, 4);
  assert.deepEqual(snapshot.events.map((event) => event.sequence), [1, 2, 3, 4]);

  unsubscribe();
  await sessions.complete(session.id, "Done", "The answer is ready.");
  assert.equal(updates.length, 4);
});

test("settles every open event and exposes a resumable recovery receipt after restart", async () => {
  const root = await mkdtemp(join(tmpdir(), "vraxis-session-recovery-"));
  const sessions = new SessionRegistry(root);
  const session = await sessions.create({ projectId: "project-1", mode: "build", runtimeId: "codex", prompt: "Finish the task" });
  await sessions.begin(session.id);
  await sessions.progress(session.id, "Working", "Changing files.", "running");
  await sessions.activity(session.id, "tool", "Terminal · run command", "Waiting for output.", "running");

  await sessions.recoverInactive(new Set());

  const recovered = await sessions.get(session.id);
  assert.equal(recovered.status, "interrupted");
  assert.equal(recovered.settlement?.state, "recovery-needed");
  assert.equal(recovered.settlement?.attempt, 1);
  assert.equal(recovered.settlement?.resumable, true);
  assert.equal((await sessions.events(session.id)).events.some((event) => event.state === "running" || event.state === "pending"), false);

  await sessions.begin(session.id);
  assert.equal((await sessions.get(session.id)).settlement?.attempt, 2);
});
