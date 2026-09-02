import type { ActivityEvent } from "@vraxis/code-contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createActivityPresenter } from "./activity-presenter.js";
import type { DisplayActivityEvent } from "./session-activity.js";

function event(
  sequence: number,
  kind: ActivityEvent["kind"],
  title: string,
  actor: ActivityEvent["actor"] = kind === "message" ? "user" : "system",
): ActivityEvent {
  return {
    id: `event-${sequence}`,
    sessionId: "session-1",
    runtimeId: "codex",
    sequence,
    timestamp: `2026-09-01T12:00:0${sequence}.000Z`,
    kind,
    actor,
    state: "complete",
    title,
    detail: `${title} detail`,
  };
}

function lastTitle(commits: DisplayActivityEvent[][]): string | undefined {
  const lastCommit = commits[commits.length - 1];
  return lastCommit?.[lastCommit.length - 1]?.title;
}

afterEach(() => vi.useRealTimers());

describe("createActivityPresenter", () => {
  it("shows the first tool immediately and coalesces rapid replacements", () => {
    vi.useFakeTimers();
    const commits: DisplayActivityEvent[][] = [];
    const presenter = createActivityPresenter((events) => commits.push(events), 650);
    const prompt = event(1, "message", "Inspect the project");

    presenter.update([prompt, event(2, "tool", "Find files")]);
    expect(lastTitle(commits)).toBe("Find files");

    presenter.update([prompt, event(2, "tool", "Find files"), event(3, "tool", "Read package")]);
    presenter.update([prompt, event(2, "tool", "Find files"), event(3, "tool", "Read package"), event(4, "tool", "Inspect tests")]);
    expect(commits).toHaveLength(1);

    vi.advanceTimersByTime(650);
    expect(commits).toHaveLength(2);
    expect(lastTitle(commits)).toBe("Inspect tests");
  });

  it("does not delay a response while a tool replacement is pending", () => {
    vi.useFakeTimers();
    const commits: DisplayActivityEvent[][] = [];
    const presenter = createActivityPresenter((events) => commits.push(events), 650);
    const prompt = event(1, "message", "Inspect the project");
    const firstTool = event(2, "tool", "Find files");
    const secondTool = event(3, "tool", "Read package");

    presenter.update([prompt, firstTool]);
    presenter.update([prompt, firstTool, secondTool]);
    presenter.update([prompt, firstTool, secondTool, event(4, "message", "Here is the answer", "agent")]);

    expect(commits).toHaveLength(2);
    expect(lastTitle(commits)).toBe("Here is the answer");
  });
});
