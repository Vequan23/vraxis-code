import assert from "node:assert/strict";
import test from "node:test";
import type { VerificationBrowserAssertionDefinition } from "@vraxis/code-contracts";
import { evaluateBrowserAssertions } from "../src/verification/browser-assertions.js";

const assertions: VerificationBrowserAssertionDefinition[] = [
  { id: "route", title: "Expected route", kind: "url", match: "equals", value: "http://127.0.0.1:4318/review", caseSensitive: false, source: ".vraxis/verify.json" },
  { id: "title", title: "Expected title", kind: "title", match: "contains", value: "Vraxis", caseSensitive: false, source: ".vraxis/verify.json" },
  { id: "copy", title: "Visible result", kind: "text", match: "contains", value: "Changes ready", caseSensitive: true, source: ".vraxis/verify.json" },
];

test("evaluates URL, title, and visible-text assertions against one captured page", () => {
  const results = evaluateBrowserAssertions(assertions, {
    url: "http://127.0.0.1:4318/review",
    title: "Vraxis Code · Review",
    snapshot: "Navigation\nChanges ready\nApply",
  });
  assert.equal(results.every((item) => item.passed), true);
});

test("retains the actual browser evidence and a precise failure", () => {
  const [result] = evaluateBrowserAssertions([assertions[2]!], {
    url: "http://127.0.0.1:4318/review",
    title: "Vraxis Code",
    snapshot: "Changes Ready",
  });
  assert.equal(result?.passed, false);
  assert.equal(result?.actual, "Changes Ready");
  assert.match(result?.failure ?? "", /Visible result expected text to contain/);
});
