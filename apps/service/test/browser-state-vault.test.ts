import assert from "node:assert/strict";
import { copyFile, mkdtemp, mkdir, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { MemoryCredentialStore } from "@vraxis/agent-v";
import { BrowserStateVault } from "../src/browser/browser-state-vault.js";

test("seals browser authentication state with an OS-owned credential key", async () => {
  const root = await mkdtemp(join(tmpdir(), "vraxis-browser-vault-"));
  const credentials = new MemoryCredentialStore();
  const vault = new BrowserStateVault(root, credentials);
  const state = {
    cookies: [{ name: "session", value: "private-cookie", domain: "example.com", path: "/", expires: -1, httpOnly: true, secure: true, sameSite: "Lax" }],
    origins: [{ origin: "https://example.com", localStorage: [{ name: "token", value: "private-local-storage" }] }],
  };

  await vault.save("task-1", state);
  const encrypted = await readFile(vault.path("task-1"), "utf8");
  assert.doesNotMatch(encrypted, /private-cookie|private-local-storage|example\.com/);
  assert.deepEqual(await vault.load("task-1"), state);
  assert.equal(await vault.has("task-1"), true);
  if (process.platform !== "win32") {
    assert.equal((await stat(vault.directory)).mode & 0o777, 0o700);
    assert.equal((await stat(vault.path("task-1"))).mode & 0o777, 0o600);
  }
});

test("binds encrypted state to both its credential key and session identity", async () => {
  const root = await mkdtemp(join(tmpdir(), "vraxis-browser-vault-integrity-"));
  const credentials = new MemoryCredentialStore();
  const vault = new BrowserStateVault(root, credentials);
  await vault.save("task-1", { cookies: [], origins: [] });

  const unrelatedCredentials = new MemoryCredentialStore();
  await assert.rejects(new BrowserStateVault(root, unrelatedCredentials).load("task-1"), /encryption key is unavailable/);
  await mkdir(vault.directory, { recursive: true });
  await copyFile(vault.path("task-1"), vault.path("task-2"));
  await assert.rejects(vault.load("task-2"), /integrity verification/);
  await assert.rejects(vault.load("../task-1"), /identifier is invalid/);
});

test("uses one encryption key when separate browser sessions persist concurrently", async () => {
  const root = await mkdtemp(join(tmpdir(), "vraxis-browser-vault-race-"));
  const vault = new BrowserStateVault(root, new MemoryCredentialStore());
  await Promise.all([
    vault.save("task-1", { cookies: [], origins: [] }),
    vault.save("task-2", { cookies: [], origins: [] }),
  ]);
  assert.deepEqual(await vault.load("task-1"), { cookies: [], origins: [] });
  assert.deepEqual(await vault.load("task-2"), { cookies: [], origins: [] });
});

test("keeps same-session atomic writes decryptable under concurrency", async () => {
  const root = await mkdtemp(join(tmpdir(), "vraxis-browser-vault-atomic-"));
  const vault = new BrowserStateVault(root, new MemoryCredentialStore());
  await Promise.all([
    vault.save("task-1", { cookies: [], origins: [] }),
    vault.save("task-1", { cookies: [], origins: [{ origin: "https://example.com", localStorage: [] }] }),
  ]);
  const state = await vault.load("task-1");
  assert.ok(state?.origins.length === 0 || state?.origins[0]?.origin === "https://example.com");
});
