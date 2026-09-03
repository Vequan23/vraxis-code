import assert from "node:assert/strict";
import test from "node:test";
import { executeAgentTool } from "@vraxis/agent-v/tools";
import { localExecutionScope } from "@vraxis/agent-v";
import { createPromptWebFetchTool, promptWebHosts } from "../src/web/prompt-web-access.js";

test("extracts only explicit current-turn web targets and normalizes browser-like bare domains", () => {
  assert.deepEqual(promptWebHosts("Compare https://example.com/docs?q=one and fetch www.vraxis.dev/guide."), [
    "example.com",
    "www.vraxis.dev",
  ]);
  assert.deepEqual(promptWebHosts("curl localhost:4318/health"), ["localhost:4318"]);
  assert.deepEqual(promptWebHosts("Explain settings.json and packages/contracts/src/index.ts"), []);
});

test("rejects credentials, insecure remote HTTP, and incidental domain-shaped text", () => {
  assert.deepEqual(promptWebHosts("https://user:secret@example.com/private"), []);
  assert.deepEqual(promptWebHosts("http://example.com/plaintext"), []);
  assert.deepEqual(promptWebHosts("The dependency is example.com but do not fetch it."), []);
});

test("bounds the number of hosts granted to one turn", () => {
  const prompt = Array.from({ length: 12 }, (_, index) => `https://host-${index}.example.com/`).join(" ");
  assert.equal(promptWebHosts(prompt).length, 8);
});

test("returns a course-correcting observation when a named host blocks the fetch", async () => {
  const tool = createPromptWebFetchTool(
    "What do you think of https://prowe214.medium.com/agentic-coding-harnesses-a-comparison-4db34b87fd5c",
    undefined,
    {
      fetch: async () => new Response(
        "Sorry, you have been blocked. You are unable to access medium.com.",
        { status: 403, headers: { "content-type": "text/html" } },
      ),
    },
  );
  assert.ok(tool);
  assert.match(tool.description, /usable is false/);
  const result = await executeAgentTool({
    tool,
    input: { url: "https://prowe214.medium.com/agentic-coding-harnesses-a-comparison-4db34b87fd5c" },
    runId: "run-1",
    sessionId: "session-1",
    scope: { ...localExecutionScope("project-1"), permissions: ["network:fetch"] },
    approvalPolicy: { decide: async () => "approved" },
  }) as { usable?: boolean; outcome?: string; nextStep?: string };
  assert.equal(result.usable, false);
  assert.equal(result.outcome, "blocked");
  assert.match(result.nextStep ?? "", /Do not request product verification/);
});

test("keeps a successful article body usable so the agent can answer", async () => {
  const article = "<article>Pi’s thesis is that you, not the harness, should control the context window.</article>";
  const tool = createPromptWebFetchTool("Read https://example.com/article", undefined, {
    fetch: async () => new Response(article, { status: 200, headers: { "content-type": "text/html" } }),
  });
  assert.ok(tool);
  const result = await executeAgentTool({
    tool,
    input: { url: "https://example.com/article" },
    runId: "run-1",
    sessionId: "session-1",
    scope: { ...localExecutionScope("project-1"), permissions: ["network:fetch"] },
    approvalPolicy: { decide: async () => "approved" },
  }) as { usable?: boolean; body?: string };
  assert.equal(result.usable, true);
  assert.equal(result.body, article);
});
