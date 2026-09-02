import type { ActivityEvent } from "@vraxis/code-contracts";
import { collapseToolActivity, type DisplayActivityEvent } from "./session-activity.js";

function sameEvents(left: DisplayActivityEvent[], right: DisplayActivityEvent[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isOnlyToolReplacement(
  current: DisplayActivityEvent[],
  next: DisplayActivityEvent[],
): boolean {
  if (current.length !== next.length) return false;

  let replacements = 0;
  for (let index = 0; index < current.length; index += 1) {
    if (JSON.stringify(current[index]) === JSON.stringify(next[index])) continue;
    const previous = current[index];
    const replacement = next[index];
    if (!previous || !replacement
      || previous.id !== replacement.id
      || previous.kind !== "tool"
      || replacement.kind !== "tool") return false;
    replacements += 1;
  }
  return replacements === 1;
}

/**
 * Keeps fast tool churn legible without delaying messages or consequential
 * lifecycle events. Rapid tool replacements coalesce to the latest update.
 */
export function createActivityPresenter(
  commit: (events: DisplayActivityEvent[]) => void,
  minimumToolDwellMs = 650,
): { update(events: ActivityEvent[]): void; dispose(): void } {
  let current: DisplayActivityEvent[] = [];
  let pending: DisplayActivityEvent[] | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastToolSwapAt = Number.NEGATIVE_INFINITY;

  const clearPending = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    pending = undefined;
  };

  const commitNow = (next: DisplayActivityEvent[]) => {
    clearPending();
    if (sameEvents(current, next)) return;
    const toolChanged = current.length === 0
      ? next.some((event) => event.kind === "tool")
      : isOnlyToolReplacement(current, next);
    current = next;
    if (toolChanged) lastToolSwapAt = Date.now();
    commit(next);
  };

  return {
    update(events) {
      const next = collapseToolActivity(events);
      if (sameEvents(current, next)) return;
      if (!isOnlyToolReplacement(current, next)) {
        commitNow(next);
        return;
      }

      const wait = minimumToolDwellMs - (Date.now() - lastToolSwapAt);
      if (wait <= 0) {
        commitNow(next);
        return;
      }

      pending = next;
      if (timer) return;
      timer = setTimeout(() => {
        const latest = pending;
        timer = undefined;
        pending = undefined;
        if (latest) commitNow(latest);
      }, wait);
    },
    dispose() {
      clearPending();
    },
  };
}
