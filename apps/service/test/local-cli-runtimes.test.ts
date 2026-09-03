import assert from "node:assert/strict";
import test from "node:test";
import { builtInRuntimes } from "@vraxis/agent-v/local-cli";
import { createLocalCliRuntimeEngine, vraxisLocalCliRuntimes } from "../src/runtimes/local-cli-runtimes.js";

test("adds --trust to non-interactive Cursor Agent invocations", () => {
  const cursor = vraxisLocalCliRuntimes.find((runtime) => runtime.id === "cursor");
  assert.ok(cursor);
  const args = cursor!.buildInvocation({
    prompt: "probe",
    workspace: "/tmp/workspace",
    outputFile: "/tmp/out.json",
    outputSchemaFile: "/tmp/schema.json",
    workspaceAccess: "read-only",
    runtimeVersion: "2026.08.25-3e8eec8",
  });
  assert.deepEqual(args.slice(0, 5), ["-p", "--trust", "--mode", "ask", "--output-format"]);
  const original = builtInRuntimes.find((runtime) => runtime.id === "cursor")!;
  const originalArgs = original.buildInvocation({
    prompt: "probe",
    workspace: "/tmp/workspace",
    outputFile: "/tmp/out.json",
    outputSchemaFile: "/tmp/schema.json",
    workspaceAccess: "read-only",
    runtimeVersion: "2026.08.25-3e8eec8",
  });
  assert.equal(originalArgs.includes("--trust"), false);
});

test("createLocalCliRuntimeEngine wraps the local CLI engine", () => {
  const engine = createLocalCliRuntimeEngine();
  assert.equal(engine.descriptor.id, "local-cli");
});
