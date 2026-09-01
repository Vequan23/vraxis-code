import assert from "node:assert/strict";
import test from "node:test";
import { authorityOptions } from "../src/approvals/authority-policy.js";

test("authority modes expand only how long an explicit scoped decision may be remembered", () => {
  const ordinary = { capability: "command" as const };
  assert.deepEqual(authorityOptions("supervised", ordinary).durations, ["once"]);
  assert.deepEqual(authorityOptions("trusted-worktree", ordinary).durations, ["once", "session"]);
  assert.deepEqual(authorityOptions("full-access", ordinary).durations, ["once", "session", "project"]);
});

test("credentials and destructive actions stay one-time in every mode", () => {
  assert.deepEqual(authorityOptions("full-access", { capability: "credentials" }).durations, ["once"]);
  assert.deepEqual(authorityOptions("full-access", { capability: "destructive" }).durations, ["once"]);
  assert.deepEqual(authorityOptions("full-access", { capability: "command", rememberable: false }).durations, ["once"]);
});
