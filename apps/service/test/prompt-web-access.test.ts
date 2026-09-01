import assert from "node:assert/strict";
import test from "node:test";
import { promptWebHosts } from "../src/web/prompt-web-access.js";

test("extracts only explicit current-turn web targets and normalizes browser-like bare domains", () => {
  assert.deepEqual(promptWebHosts("Compare https://example.com/docs?q=one and fetch www.vraxis.dev/guide."), [
    "example.com",
    "www.vraxis.dev",
  ]);
  assert.deepEqual(promptWebHosts("curl localhost:4318/health"), ["localhost:4318"]);
  assert.deepEqual(promptWebHosts("Explain settings.json and packages/contracts/src/index.ts"), []);
});

test("rejects credentials, insecure remote HTTP, and incidental domain-shaped text", () => {
  assert.deepEqual(promptWebHosts("https://user:secret@example.com/private"), []);
  assert.deepEqual(promptWebHosts("http://example.com/plaintext"), []);
  assert.deepEqual(promptWebHosts("The dependency is example.com but do not fetch it."), []);
});

test("bounds the number of hosts granted to one turn", () => {
  const prompt = Array.from({ length: 12 }, (_, index) => `https://host-${index}.example.com/`).join(" ");
  assert.equal(promptWebHosts(prompt).length, 8);
});
