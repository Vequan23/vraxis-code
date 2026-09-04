import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadSkillPackage } from "@vraxis/agent-v/node";
import {
  assertRepairableSkillManifest,
  isMetadataRepairableIssue,
  repairSkillMetadata,
} from "../src/skills/skills-repair.js";

test("isMetadataRepairableIssue matches metadata normalization failures", () => {
  assert.equal(isMetadataRepairableIssue("Invalid Agent Skill: metadata values must be strings."), true);
  assert.equal(isMetadataRepairableIssue("Invalid Agent Skill: name is required."), false);
});

test("repairSkillMetadata stringifies non-string metadata values", async () => {
  const root = await mkdtemp(join(tmpdir(), "vraxis-skill-repair-"));
  const skillDirectory = join(root, "cursor-style");
  await mkdir(skillDirectory, { recursive: true });
  await writeFile(join(skillDirectory, "SKILL.md"), [
    "---",
    "name: cursor-style",
    "description: Cursor accepts rich metadata.",
    "metadata:",
    "  surfaces:",
    "    - ide",
    "    - cloud",
    "  priority: 4",
    "  version: \"1.0.0\"",
    "---",
    "",
    "Use this skill.",
  ].join("\n"), "utf8");

  const result = await repairSkillMetadata(join(skillDirectory, "SKILL.md"));
  assert.equal(result.changed, true);
  assert.match(result.summary, /Normalized 3 metadata field/);

  const updated = await readFile(join(skillDirectory, "SKILL.md"), "utf8");
  assert.match(updated, /surfaces: '\["ide","cloud"\]'|surfaces: "\[\"ide\",\"cloud\"\]"/);
  assert.match(updated, /priority: "4"/);

  await loadSkillPackage(skillDirectory);
});

test("repairSkillMetadata rejects already-compatible manifests", async () => {
  const root = await mkdtemp(join(tmpdir(), "vraxis-skill-repair-ready-"));
  const skillDirectory = join(root, "ready-skill");
  await mkdir(skillDirectory, { recursive: true });
  await writeFile(join(skillDirectory, "SKILL.md"), [
    "---",
    "name: ready-skill",
    "description: Already compatible.",
    "metadata:",
    "  version: \"1.0.0\"",
    "---",
    "",
    "Use this skill.",
  ].join("\n"), "utf8");

  await assert.rejects(
    () => repairSkillMetadata(join(skillDirectory, "SKILL.md")),
    /already compatible/i,
  );
});

test("assertRepairableSkillManifest allows cursor bundled skill directories", async () => {
  const root = await mkdtemp(join(tmpdir(), "vraxis-skill-repair-paths-"));
  const home = join(root, "home");
  const project = join(root, "repo");
  await mkdir(join(project, ".git"), { recursive: true });
  const skillDirectory = join(home, ".cursor", "skills-cursor", "canvas");
  await mkdir(skillDirectory, { recursive: true });
  const manifestPath = join(skillDirectory, "SKILL.md");
  await writeFile(manifestPath, "---\nname: canvas\ndescription: Canvas skill.\n---\n\nUse canvas.\n", "utf8");

  const allowed = await assertRepairableSkillManifest(manifestPath, project, home);
  assert.equal(allowed, await realpath(manifestPath));
});

test("assertRepairableSkillManifest allows symlinked user skills by logical path", async () => {
  const root = await mkdtemp(join(tmpdir(), "vraxis-skill-repair-symlink-"));
  const home = join(root, "home");
  const project = join(root, "repo");
  const portable = join(root, "portable", "linked-skill");
  await mkdir(join(project, ".git"), { recursive: true });
  await mkdir(portable, { recursive: true });
  await mkdir(join(home, ".cursor", "skills"), { recursive: true });
  const link = join(home, ".cursor", "skills", "linked-skill");
  await symlink(portable, link, "dir");
  const manifestPath = join(link, "SKILL.md");
  await writeFile(manifestPath, "---\nname: linked-skill\ndescription: Linked skill.\n---\n\nUse linked skill.\n", "utf8");

  await assertRepairableSkillManifest(manifestPath, project, home);
});
