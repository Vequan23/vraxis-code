import { describe, expect, it } from "vitest";
import type { TerminalRunSummary } from "@vraxis/code-contracts";
import { restartInterruptedShellId, terminalTabs } from "./terminal-tabs.js";

function run(id: string, input: Partial<TerminalRunSummary> = {}): TerminalRunSummary {
  return {
    id,
    sessionId: "session-1",
    approvalId: `approval-${id}`,
    command: "npm test",
    cwd: ".",
    status: "success",
    output: "",
    ...input,
  };
}

describe("terminal tabs", () => {
  it("does not restore completed shells or agent commands as terminal instances", () => {
    const tabs = terminalTabs([
      run("shell", { purpose: "user-shell", command: "/bin/zsh -l", status: "running" }),
      run("old-shell", { purpose: "user-shell", command: "/bin/zsh -l" }),
      run("npm-1"),
      run("npm-2"),
    ], "", undefined, []);

    expect(tabs.map((item) => item.id)).toEqual(["shell"]);
  });

  it("does not retain an interrupted shell merely because it was selected", () => {
    const interrupted = run("shell", {
      purpose: "user-shell",
      status: "interrupted",
      output: "[Interrupted when Vraxis Code restarted]\n",
    });

    expect(terminalTabs([interrupted], "shell", "shell", [])).toEqual([]);
  });

  it("requests one replacement only when the latest shell was interrupted by restart", () => {
    const interrupted = run("shell", {
      purpose: "user-shell",
      status: "interrupted",
      output: "[Interrupted when Vraxis Code restarted]\n",
    });
    expect(restartInterruptedShellId([interrupted])).toBe("shell");
    expect(restartInterruptedShellId([
      run("active", { purpose: "user-shell", status: "running" }),
      interrupted,
    ])).toBeUndefined();
    expect(restartInterruptedShellId([
      run("stopped", { purpose: "user-shell", status: "interrupted", output: "[Stopped]\n" }),
      interrupted,
    ])).toBeUndefined();
  });

  it("keeps active and explicitly opened command receipts available", () => {
    const tabs = terminalTabs([
      run("active", { status: "running" }),
      run("focused"),
      run("historical"),
    ], "focused", undefined, []);

    expect(tabs.map((item) => item.id)).toEqual(["active", "focused"]);
  });

  it("deduplicates run ids and respects locally closed tabs", () => {
    const shell = run("shell", { purpose: "user-shell", status: "running" });
    expect(terminalTabs([shell, shell], "", undefined, ["shell"])).toEqual([]);
  });
});
