import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { discoverComposerCommands } from "../src/commands/command-registry.js";

test("command registry discovers project and user commands with frontmatter metadata", async () => {
  const root = await mkdtemp(join(tmpdir(), "vraxis-commands-"));
  const userRoot = await mkdtemp(join(tmpdir(), "vraxis-user-commands-"));
  await mkdir(join(root, ".vraxis", "commands"), { recursive: true });
  await writeFile(join(root, ".vraxis", "commands", "review.md"), [
    "---",
    "name: review-pr",
    "description: Review the current branch like a staff engineer.",
    "mode: review",
    "skills: [security-audit, ux-fundamentals]",
    "icon: eye",
    "keywords: [pull-request, critique]",
    "---",
    "",
    "Review the current changes for correctness, regressions, and trust-boundary risks.",
  ].join("\n"), "utf8");
  await writeFile(join(userRoot, "daily-standup.md"), [
    "---",
    "name: standup",
    "description: Summarize yesterday, today, and blockers.",
    "mode: ask",
    "---",
    "",
    "Summarize project progress from file-backed evidence only.",
  ].join("\n"), "utf8");

  const commands = await discoverComposerCommands(root, { userCommandsDirectory: userRoot });
  assert.ok(commands.some((command) => command.name === "review-pr" && command.scope === "project"));
  assert.ok(commands.some((command) => command.name === "standup" && command.scope === "user"));
  assert.deepEqual(commands.find((command) => command.name === "review-pr")?.skillNames, [
    "security-audit",
    "ux-fundamentals",
  ]);
});

test("command registry prefers the first discovered command when names collide", async () => {
  const root = await mkdtemp(join(tmpdir(), "vraxis-commands-dup-"));
  const userRoot = await mkdtemp(join(tmpdir(), "vraxis-user-commands-dup-"));
  await mkdir(join(root, ".vraxis", "commands"), { recursive: true });
  await writeFile(join(root, ".vraxis", "commands", "a.md"), "---\nname: shared\n---\n\nProject recipe.\n", "utf8");
  await writeFile(join(userRoot, "shared.md"), "---\nname: shared\n---\n\nUser recipe.\n", "utf8");

  const commands = await discoverComposerCommands(root, { userCommandsDirectory: userRoot });
  assert.equal(commands.filter((command) => command.name === "shared").length, 1);
  assert.equal(commands.find((command) => command.name === "shared")?.scope, "project");
});
