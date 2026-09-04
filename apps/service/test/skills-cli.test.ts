import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSkillsInstallInvocation,
  formatSkillsInstallScope,
  skillsCliAgentsForRuntimes,
} from "../src/skills/skills-cli.js";

test("skills cli maps installed runtimes to skills CLI agents", () => {
  assert.deepEqual(
    skillsCliAgentsForRuntimes(["cursor", "codex", "opencode", "unknown"]),
    ["cursor", "codex", "opencode"],
  );
  assert.deepEqual(
    skillsCliAgentsForRuntimes([]),
    ["codex", "claude-code", "cursor", "opencode"],
  );
});

test("skills cli builds a non-interactive npx skills add invocation", () => {
  assert.deepEqual(buildSkillsInstallInvocation({
    source: "vercel-labs/agent-skills",
    agents: ["cursor", "codex"],
    skillNames: ["web-design-guidelines"],
  }), {
    command: "npx",
    args: [
      "--yes",
      "skills",
      "add",
      "vercel-labs/agent-skills",
      "-y",
      "--copy",
      "-a",
      "cursor",
      "-a",
      "codex",
      "-s",
      "web-design-guidelines",
    ],
  });
});

test("skills cli formats install scope for approvals", () => {
  assert.equal(formatSkillsInstallScope({
    source: "vercel-labs/agent-skills",
    agents: ["cursor", "codex"],
    skillNames: ["web-design-guidelines"],
  }), "vercel-labs/agent-skills · project · web-design-guidelines · cursor, codex");
});
