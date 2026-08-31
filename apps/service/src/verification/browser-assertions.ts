import type {
  BrowserSessionSummary,
  VerificationBrowserAssertionDefinition,
} from "@vraxis/code-contracts";

export interface BrowserAssertionResult {
  id: string;
  passed: boolean;
  actual: string;
  failure?: string;
}

export function evaluateBrowserAssertions(
  assertions: readonly VerificationBrowserAssertionDefinition[],
  browserState: Pick<BrowserSessionSummary, "url" | "title" | "snapshot">,
): BrowserAssertionResult[] {
  return assertions.map((assertion) => {
    const actual = assertion.kind === "url" ? browserState.url
      : assertion.kind === "title" ? browserState.title
        : browserState.snapshot;
    const comparableActual = assertion.caseSensitive ? actual : actual.toLocaleLowerCase();
    const comparableExpected = assertion.caseSensitive ? assertion.value : assertion.value.toLocaleLowerCase();
    const passed = assertion.match === "equals"
      ? comparableActual === comparableExpected
      : comparableActual.includes(comparableExpected);
    return {
      id: assertion.id,
      passed,
      actual,
      ...(!passed ? { failure: `${assertion.title} expected ${assertion.kind} to ${assertion.match === "equals" ? "equal" : "contain"} "${assertion.value}".` } : {}),
    };
  });
}
