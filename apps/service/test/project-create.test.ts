import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { normalizeProjectName } from "../src/projects/project-name.js";
import { ProjectRegistry } from "../src/projects/project-registry.js";

test("normalizeProjectName rejects invalid folder names", () => {
  assert.throws(() => normalizeProjectName(""), /1-64 characters/);
  assert.throws(() => normalizeProjectName(".."), /not valid/);
  assert.throws(() => normalizeProjectName("foo/bar"), /path separators/);
  assert.equal(normalizeProjectName("  devto-observer  "), "devto-observer");
});

test("ProjectRegistry.create makes a git repository and registers it", async () => {
  const root = await mkdtemp(join(tmpdir(), "vraxis-create-project-"));
  const registry = new ProjectRegistry(join(root, "data"));
  const project = await registry.create(root, "my-app");
  assert.equal(project.name, "my-app");
  assert.match(project.branch, /main|master/);
  assert.equal(await registry.resolveInside(project.id), project.path);
  await assert.rejects(
    () => registry.create(root, "my-app"),
    /already exists/,
  );
});
