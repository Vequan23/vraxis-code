import assert from "node:assert/strict";
import test from "node:test";
import type { BrowserSessionSummary } from "@vraxis/code-contracts";
import { renderBrowserReplay } from "../src/browser/browser-replay.js";

test("renders a network-inert portable browser replay with redacted metadata", async () => {
  const state: BrowserSessionSummary = {
    sessionId: "session-1",
    status: "closed",
    url: "https://example.test/result?token=state-secret#fragment",
    title: "Evidence result",
    snapshot: "",
    screenshotVersion: 2,
    viewport: { width: 1280, height: 820 },
    activeTabId: "tab-1",
    tabs: [],
    controls: [],
    allowedOrigins: ["https://example.test"],
    console: [],
    network: [],
    actions: [{ id: "action-1", action: "navigate", target: "https://example.test/result?token=action-secret#fragment", status: "success", timestamp: "2026-08-31T12:00:01.000Z", detail: "Opened https://example.test/result?code=detail-secret", actor: "agent", approvalId: "approval-1", beforeFrameId: "frame-1", afterFrameId: "frame-2" }],
    frames: [
      { id: "frame-2", actionId: "action-1", phase: "after", url: "https://example.test/result?code=after-secret", title: "Result", timestamp: "2026-08-31T12:00:02.000Z", screenshotVersion: 2 },
      { id: "frame-1", actionId: "action-1", phase: "before", url: "https://example.test/start?code=before-secret", title: "Start", timestamp: "2026-08-31T12:00:00.000Z", screenshotVersion: 1 },
    ],
    updatedAt: "2026-08-31T12:00:02.000Z",
  };
  const replay = await renderBrowserReplay(state, async (id) => Buffer.from(`png:${id}`));
  assert.equal(replay.frameCount, 2);
  assert.equal(replay.actionCount, 1);
  assert.match(replay.contentSecurityPolicy, /default-src 'none'/);
  assert.match(replay.contentSecurityPolicy, /script-src 'nonce-/);
  assert.match(replay.html, /Portable browser evidence/);
  assert.match(replay.html, /data:image\/png;base64/);
  assert.match(replay.html, /Screenshots can contain private page data/);
  assert.match(replay.html, /code=%5BREDACTED%5D/);
  assert.doesNotMatch(replay.html, /action-secret|detail-secret|after-secret|before-secret|#fragment/);
  assert.doesNotMatch(replay.html, /src="https?:/);
});

test("refuses a replay without retained action frames", async () => {
  const state = {
    sessionId: "session-empty", status: "closed", url: "", title: "", snapshot: "", screenshotVersion: 0,
    viewport: { width: 1280, height: 820 }, activeTabId: "", tabs: [], controls: [], allowedOrigins: [], console: [], network: [], actions: [], frames: [], updatedAt: "2026-08-31T12:00:00.000Z",
  } satisfies BrowserSessionSummary;
  await assert.rejects(renderBrowserReplay(state, async () => Buffer.alloc(0)), /does not have retained action frames/);
});
