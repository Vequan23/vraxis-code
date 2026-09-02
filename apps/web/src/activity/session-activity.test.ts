import { describe, expect, it } from "vitest";
import type { ActivityEvent } from "@vraxis/code-contracts";
import { collapseToolActivity } from "./session-activity.js";

function event(input: Partial<ActivityEvent> & Pick<ActivityEvent, "id" | "kind" | "title">): ActivityEvent {
  return {
    sessionId: "session-1",
    sequence: 1,
    timestamp: "2026-09-01T12:00:00.000Z",
    runtimeId: "codex",
    detail: "",
    state: "complete",
    ...input,
  };
}

describe("collapsed tool activity", () => {
  it("shows one dynamically updated tool row inside a conversational turn", () => {
    const displayed = collapseToolActivity([
      event({ id: "user-1", kind: "message", actor: "user", title: "Inspect this project" }),
      event({ id: "tool-1", kind: "tool", title: "Exploring · list directory", state: "running" }),
      event({ id: "tool-2", kind: "tool", title: "Exploring · read text" }),
      event({ id: "tool-3", kind: "tool", title: "Exploring · search text", detail: "Completed in 9 ms." }),
      event({ id: "agent-1", kind: "message", actor: "agent", title: "Project summary" }),
    ]);

    expect(displayed.map((item) => item.kind)).toEqual(["message", "tool", "message"]);
    expect(displayed[1]).toMatchObject({
      id: "tool-activity:user-1",
      title: "Exploring · search text",
      detail: "Completed in 9 ms.",
      collapsedToolCount: 3,
    });
  });

  it("retains one tool row for each user turn and preserves non-tool activity", () => {
    const displayed = collapseToolActivity([
      event({ id: "user-1", kind: "message", actor: "user", title: "First" }),
      event({ id: "tool-1", kind: "tool", title: "Read one" }),
      event({ id: "approval-1", kind: "approval", title: "Approval" }),
      event({ id: "tool-2", kind: "tool", title: "Read two" }),
      event({ id: "agent-1", kind: "message", actor: "agent", title: "Done" }),
      event({ id: "user-2", kind: "message", actor: "user", title: "Second" }),
      event({ id: "tool-3", kind: "tool", title: "Search" }),
    ]);

    expect(displayed.filter((item) => item.kind === "tool").map((item) => item.title)).toEqual(["Read two", "Search"]);
    expect(displayed.some((item) => item.id === "approval-1")).toBe(true);
  });
});
