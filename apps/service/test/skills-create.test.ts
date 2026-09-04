import assert from "node:assert/strict";
import { access, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadSkillPackage } from "@vraxis/agent-v/node";
import {
  buildSkillManifest,
  createSkillScaffold,
  normalizeSkillName,
  skillManifestPath,
} from "../src/skills/skills-create.js";

test("normalizeSkillName slugifies and validates skill names", () => {
  assert.equal(normalizeSkillName("API Review"), "api-review");
  assert.throws(() => normalizeSkillName("9-start"), /must start with a letter/i);
});

test("buildSkillManifest writes compatible frontmatter and starter body", () => {
  const manifest = buildSkillManifest({
    name: "commit-helper",
    description: "Generate commit messages from diffs.",
    scope: "project",
  });
  assert.match(manifest, /name: commit-helper/);
  assert.match(manifest, /description: Generate commit messages from diffs\./);
  assert.match(manifest, /version: "1.0.0"/);
  assert.match(manifest, /## Instructions/);
});

test("createSkillScaffold writes a loadable project skill", async () => {
  const root = await mkdtemp(join(tmpdir(), "vraxis-skill-create-"));
  const result = await createSkillScaffold(root, {
    name: "release-notes",
    description: "Draft release notes from merged changes.",
    scope: "project",
    instructions: "## Instructions\n\nSummarize user-facing changes only.",
  });
  assert.equal(result.manifestPath, skillManifestPath(root, "project", "release-notes"));
  await access(result.manifestPath);
  const manifest = await readFile(result.manifestPath, "utf8");
  assert.match(manifest, /Summarize user-facing changes only\./);
  await loadSkillPackage(result.skillDirectory);
});

test("createSkillScaffold rejects duplicate skill names", async () => {
  const root = await mkdtemp(join(tmpdir(), "vraxis-skill-create-dup-"));
  const input = {
    name: "dup-skill",
    description: "First copy.",
    scope: "project" as const,
  };
  await createSkillScaffold(root, input);
  await assert.rejects(() => createSkillScaffold(root, input), /already exists/i);
});
