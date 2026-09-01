import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { BrowserActionRequest } from "@vraxis/code-contracts";
import { BrowserWorkspace } from "../src/browser/browser-workspace.js";
import { DesktopBrowserRelay } from "../src/browser/desktop-browser-relay.js";
import type { BrowserAutomationObservation, BrowserAutomationRelay } from "../src/browser/browser-automation.js";

function observation(sessionId: string, url = "https://example.com/"): BrowserAutomationObservation {
  return {
    sessionId,
    url,
    title: "Example",
    snapshot: "Example page",
    viewport: { width: 900, height: 640 },
    activeTabId: "tab_1",
    tabs: [{ id: "tab_1", title: "Example", url, active: true }],
    controls: [{ ref: "e1", kind: "button", label: "Continue", action: "click", disabled: false, sensitive: false, bounds: { x: 20, y: 30, width: 100, height: 32 } }],
    console: [],
    network: [],
  };
}

test("desktop browser relay authenticates the private host channel and validates its observation", async () => {
  let captured: { url: string; authorization: string; body: unknown } | undefined;
  const relay = new DesktopBrowserRelay(
    "http://127.0.0.1:41000/v1/perform",
    "a".repeat(43),
    async (input, init) => {
      captured = {
        url: String(input),
        authorization: new Headers(init?.headers).get("authorization") ?? "",
        body: JSON.parse(String(init?.body)),
      };
      return Response.json(observation("task_1"));
    },
  );
  const result = await relay.perform({ sessionId: "task_1", action: "capture" });
  assert.equal(result.title, "Example");
  assert.deepEqual(captured, {
    url: "http://127.0.0.1:41000/v1/perform",
    authorization: `Bearer ${"a".repeat(43)}`,
    body: { sessionId: "task_1", action: "capture" },
  });
  relay.close();
  await assert.rejects(relay.perform({ sessionId: "task_1", action: "capture" }), /unavailable/);
});

test("desktop browser relay rejects non-loopback endpoints and mismatched observations", async () => {
  assert.throws(() => new DesktopBrowserRelay("https://example.com/v1/perform", "a".repeat(43)), /endpoint/);
  const relay = new DesktopBrowserRelay(
    "http://127.0.0.1:41000/v1/perform",
    "b".repeat(43),
    async () => Response.json(observation("another_task")),
  );
  await assert.rejects(relay.perform({ sessionId: "task_1", action: "capture" }), /another task/);
});

test("browser workspace records governed actions from the same live desktop surface", async () => {
  const root = await mkdtemp(join(tmpdir(), "vraxis-live-browser-"));
  const requests: BrowserActionRequest[] = [];
  let closed = false;
  const relay: BrowserAutomationRelay = {
    async perform(request) {
      requests.push(structuredClone(request));
      return observation(request.sessionId, request.action === "navigate" ? request.target : undefined);
    },
    close() { closed = true; },
  };
  const browser = new BrowserWorkspace(root, undefined, relay);
  const state = await browser.perform(
    { sessionId: "task_1", action: "navigate", target: "https://example.com/docs" },
    { actor: "agent", approvalId: "approval_1" },
  );
  assert.equal(state.url, "https://example.com/docs");
  assert.deepEqual(state.allowedOrigins, ["https://example.com"]);
  assert.equal(state.actions[0]?.actor, "agent");
  assert.equal(state.actions[0]?.approvalId, "approval_1");
  assert.equal((await browser.controller("task_1").snapshot()).url, "https://example.com/");
  assert.deepEqual(requests.map(item => item.action), ["navigate", "capture"]);
  await browser.close();
  assert.equal(closed, true);
});

test("retained desktop evidence stays inert until an approved restore reopens its URL", async () => {
  const root = await mkdtemp(join(tmpdir(), "vraxis-retained-live-browser-"));
  const first: BrowserAutomationRelay = {
    async perform(request) { return observation(request.sessionId, request.target); },
    close() {},
  };
  const original = new BrowserWorkspace(root, undefined, first);
  await original.perform({ sessionId: "task_1", action: "navigate", target: "https://example.com/saved" });
  await original.close();

  const restoredRequests: BrowserActionRequest[] = [];
  const second: BrowserAutomationRelay = {
    async perform(request) {
      restoredRequests.push(structuredClone(request));
      return observation(request.sessionId, request.target);
    },
    close() {},
  };
  const restored = new BrowserWorkspace(root, undefined, second);
  const retained = await restored.state("task_1");
  assert.equal(retained?.status, "closed");
  assert.equal(retained?.url, "https://example.com/saved");
  assert.equal(restoredRequests.length, 0);

  const live = await restored.perform({ sessionId: "task_1", action: "capture" });
  assert.deepEqual(restoredRequests[0], { sessionId: "task_1", action: "navigate", target: "https://example.com/saved" });
  assert.equal(live.status, "ready");
  assert.equal(live.actions[0]?.action, "capture");
  await restored.close();
});
