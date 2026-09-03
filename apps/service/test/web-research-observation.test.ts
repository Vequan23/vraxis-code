import assert from "node:assert/strict";
import test from "node:test";
import { observeWebResearchResult, annotateWebResearchResult } from "../src/web/web-research-observation.js";

test("classifies Cloudflare and challenge pages as unusable research results", () => {
  const blocked = observeWebResearchResult({
    url: "https://prowe214.medium.com/agentic-coding-harnesses-a-comparison-4db34b87fd5c",
    status: 403,
    ok: false,
    title: "Attention Required! | Cloudflare",
    body: "Sorry, you have been blocked. You are unable to access medium.com.",
  });
  assert.equal(blocked.usable, false);
  assert.equal(blocked.outcome, "blocked");
  assert.match(blocked.nextStep, /Do not retry this URL or open the product browser/);
  assert.match(blocked.nextStep, /Do not request product verification/);

  const challenge = observeWebResearchResult({
    title: "Just a moment...",
    visibleText: "Checking your browser before accessing medium.com. Enable JavaScript and cookies to continue.",
  });
  assert.equal(challenge.outcome, "challenge");
  assert.match(challenge.nextStep, /Do not click through the challenge/);
});

test("tells the agent to follow same-host redirects once and keep usable bodies", () => {
  const redirect = observeWebResearchResult({
    url: "https://prowe214.medium.com/p/4db34b87fd5c",
    status: 301,
    ok: false,
    redirectLocation: "https://prowe214.medium.com/agentic-coding-harnesses-a-comparison-4db34b87fd5c",
  });
  assert.equal(redirect.outcome, "redirect");
  assert.match(redirect.nextStep, /Fetch that redirect URL once/);

  const usable = observeWebResearchResult({
    status: 200,
    ok: true,
    body: "<article>Harnesses have been appearing all over, so why would you use one over another?</article>",
  });
  assert.equal(usable.usable, true);
  assert.equal(usable.outcome, "usable");

  const annotated = annotateWebResearchResult({
    status: 403,
    ok: false,
    body: `${"x".repeat(900)} Sorry, you have been blocked.`,
  }, {
    status: 403,
    ok: false,
    body: `${"x".repeat(900)} Sorry, you have been blocked.`,
  });
  assert.equal(annotated.usable, false);
  assert.ok(typeof annotated.body === "string" && annotated.body.length < 900);
});
