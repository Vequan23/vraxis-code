import type { ActivityEvent } from "@vraxis/code-contracts";

export interface DisplayActivityEvent extends ActivityEvent {
  collapsedToolCount?: number;
}

/**
 * Keep one stable tool-activity row per conversational turn. Its content is
 * replaced as newer tool events arrive, while messages and consequential
 * lifecycle events retain their original order and identity.
 */
export function collapseToolActivity(events: ActivityEvent[]): DisplayActivityEvent[] {
  const displayed: DisplayActivityEvent[] = [];
  let turnId = "startup";
  let toolIndex = -1;
  let toolCount = 0;

  for (const event of events) {
    if (event.kind === "message" && event.actor === "user") {
      turnId = event.id;
      toolIndex = -1;
      toolCount = 0;
      displayed.push(event);
      continue;
    }

    if (event.kind === "tool") {
      toolCount += 1;
      const activity: DisplayActivityEvent = {
        ...event,
        id: `tool-activity:${turnId}`,
        collapsedToolCount: toolCount,
      };
      if (toolIndex < 0) {
        toolIndex = displayed.length;
        displayed.push(activity);
      } else displayed[toolIndex] = activity;
      continue;
    }

    displayed.push(event);
    if (event.kind === "message" && event.actor === "agent") {
      toolIndex = -1;
      toolCount = 0;
    }
  }

  return displayed;
}
