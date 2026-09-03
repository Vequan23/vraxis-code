import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SessionRegistry } from "../src/sessions/session-registry.js";

test("archives, restores, and deletes sessions while preserving other task history", async () => {
  const directory = await mkdtemp(join(tmpdir(), "vraxis-session-archive-"));
  const sessions = new SessionRegistry(directory);

  const first = await sessions.create({
    projectId: "project-1",
    mode: "ask",
    runtimeId: "codex",
    prompt: "First task",
  });
  const second = await sessions.create({
    projectId: "project-1",
    mode: "ask",
    runtimeId: "codex",
    prompt: "Second task",
  });
  assert.equal((await sessions.read()).selectedSessionId, second.id);

  const archived = await sessions.archive(first.id);
  assert.ok(archived.archivedAt);
  const afterArchive = await sessions.read();
  assert.equal(afterArchive.selectedSessionId, second.id);
  assert.equal(afterArchive.events.filter((event) => event.sessionId === first.id).length, 1);

  await assert.rejects(() => sessions.select(first.id), /archived/i);

  const restored = await sessions.restore(first.id);
  assert.equal(restored.archivedAt, undefined);
  await sessions.select(first.id);
  assert.equal((await sessions.read()).selectedSessionId, first.id);

  await sessions.archive(first.id);
  await sessions.remove(first.id);
  const afterDelete = await sessions.read();
  assert.equal(afterDelete.sessions.some((item) => item.id === first.id), false);
  assert.equal(afterDelete.events.some((event) => event.sessionId === first.id), false);
  assert.equal(afterDelete.selectedSessionId, second.id);
});

test("rejects archiving or deleting a running session", async () => {
  const directory = await mkdtemp(join(tmpdir(), "vraxis-session-archive-"));
  const sessions = new SessionRegistry(directory);
  const session = await sessions.create({
    projectId: "project-1",
    mode: "ask",
    runtimeId: "codex",
    prompt: "Running task",
  });
  await sessions.begin(session.id);
  await assert.rejects(() => sessions.archive(session.id), /Stop the task/i);
  await assert.rejects(() => sessions.remove(session.id), /Stop the task/i);
});
