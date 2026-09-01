import { describe, expect, it } from "vitest";
import type { BootstrapState } from "@vraxis/code-contracts";
import { captureWorkspaceState, resetWorkspaceState, restoreWorkspaceState, workspaceStateKey } from "./workspace-cache.js";

function state(): BootstrapState {
  return {
    contractVersion: 26,
    projects: [
      { id: "alpha", name: "Alpha", path: "/alpha", branch: "main", status: "ready" },
      { id: "beta", name: "Beta", path: "/beta", branch: "main", status: "ready" },
    ],
    sessions: [],
    runtimes: [],
    modelProviders: [],
    skills: [],
    selectedProjectId: "alpha",
    selectedSessionId: "session-alpha",
    files: [{ path: "src/alpha.ts" }],
    changes: [{ path: "src/alpha.ts", status: "modified" }],
    events: [],
    approvals: [],
    approvalRules: [],
    terminalRuns: [],
    verificationRuns: [],
    verificationHandoffs: [],
    settings: { theme: "graphite-dark", defaultMode: "ask" },
  };
}

describe("workspace state cache", () => {
  it("restores project-scoped state without replacing global catalogs", () => {
    const capturedAfter = Date.now();
    const current = state();
    const snapshot = captureWorkspaceState(current)!;
    resetWorkspaceState(current, "beta");
    current.runtimes.push({ id: "codex", name: "Codex", availability: "installed", detail: "Ready", acceptsCustomModel: true, models: [], capabilities: [] });

    restoreWorkspaceState(current, snapshot);

    expect(current.selectedProjectId).toBe("alpha");
    expect(current.selectedSessionId).toBe("session-alpha");
    expect(current.files).toEqual([{ path: "src/alpha.ts" }]);
    expect(current.runtimes).toHaveLength(1);
    expect(snapshot.capturedAt).toBeGreaterThanOrEqual(capturedAfter);
  });

  it("uses separate cache identities for drafts and tasks", () => {
    expect(workspaceStateKey("alpha")).toBe("alpha:draft");
    expect(workspaceStateKey("alpha", "task-1")).toBe("alpha:task-1");
  });
});
