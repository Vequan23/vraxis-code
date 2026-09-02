import type { TerminalRunSummary } from "@vraxis/code-contracts";

function isActive(run: TerminalRunSummary): boolean {
  return run.status === "pending" || run.status === "running";
}

const restartInterruptionNotice = "[Interrupted when Vraxis Code restarted]";

export function restartInterruptedShellId(runs: TerminalRunSummary[]): string | undefined {
  if (runs.some((run) => run.purpose === "user-shell" && isActive(run))) return undefined;
  const latestShell = runs.find((run) => run.purpose === "user-shell");
  return latestShell?.status === "interrupted" && latestShell.output.includes(restartInterruptionNotice)
    ? latestShell.id
    : undefined;
}

/**
 * Live interactive shells are durable tabs. Agent command receipts appear
 * while active or when explicitly opened, but exited shells and completed
 * historical receipts do not repopulate the tab bar after a refresh.
 */
export function terminalTabs(
  runs: TerminalRunSummary[],
  selectedRunId: string,
  initialRunId: string | undefined,
  hiddenRunIds: string[],
): TerminalRunSummary[] {
  const hidden = new Set(hiddenRunIds);
  const seen = new Set<string>();
  return runs.filter((run) => {
    if (seen.has(run.id) || hidden.has(run.id)) return false;
    seen.add(run.id);
    return isActive(run)
      || (run.purpose !== "user-shell" && (run.id === selectedRunId || run.id === initialRunId));
  });
}
