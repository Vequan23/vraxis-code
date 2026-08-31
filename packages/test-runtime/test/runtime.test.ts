import assert from "node:assert/strict";
import test from "node:test";
import { defineOutput, localExecutionScope } from "@vraxis/agent-v";
import { createDeterministicRun, DeterministicCodingRuntimeEngine, InterruptibleCodingRuntimeEngine } from "../src/index.js";

test("creates an agent-v execution scope for the selected project", () => {
  const run = createDeterministicRun("project-1");
  assert.equal(run.scope.projectId, "project-1");
  assert.equal(run.runtime.descriptor.kind, "tool-agent");
});

test("honors the host abort signal", async () => {
  const runtime = new InterruptibleCodingRuntimeEngine();
  const controller = new AbortController();
  const run = runtime.run({
    runtimeId: "codex",
    runtimeModel: "gpt-5.6-sol",
    workspaceAccess: "read-only",
    scope: localExecutionScope("project-1"),
    abortSignal: controller.signal,
    input: { prompt: "Keep reading" },
    output: defineOutput({ name: "answer", jsonSchema: { type: "object" }, parse: (value) => value }),
  });
  controller.abort();
  await assert.rejects(run, /stopped/);
});

test("returns schema-validated repository evidence through the coding runtime contract", async () => {
  const runtime = new DeterministicCodingRuntimeEngine();
  const result = await runtime.run({
    runtimeId: "codex",
    runtimeModel: "gpt-5.6-sol",
    workspacePath: "/tmp/project",
    workspaceAccess: "read-only",
    scope: localExecutionScope("project-1"),
    input: { prompt: "Where is the entry point?" },
    output: defineOutput({
      name: "answer",
      jsonSchema: { type: "object" },
      parse(value) { return value as { answer: string; evidence: string[] }; },
    }),
  });
  assert.equal(result.output.answer, "The entry point is `src/index.ts`.");
  assert.equal(result.provenance.model, "gpt-5.6-sol");
  assert.deepEqual(result.output.evidence, ["src/index.ts"]);
});
