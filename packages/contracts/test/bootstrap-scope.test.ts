import assert from "node:assert/strict";
import test from "node:test";
import { parseBootstrapScope } from "@vraxis/code-contracts";

test("parses staged bootstrap scopes", () => {
  assert.equal(parseBootstrapScope("shell"), "shell");
  assert.equal(parseBootstrapScope("workspace"), "workspace");
  assert.equal(parseBootstrapScope("catalog"), "catalog");
  assert.equal(parseBootstrapScope(null), "full");
  assert.equal(parseBootstrapScope("full"), "full");
  assert.equal(parseBootstrapScope("invalid"), "full");
});
