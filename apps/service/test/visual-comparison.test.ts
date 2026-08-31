import assert from "node:assert/strict";
import { mkdtemp, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PNG } from "pngjs";
import { compareVisualBaseline } from "../src/verification/visual-comparison.js";

function png(red: number): Buffer {
  const image = new PNG({ width: 4, height: 4 });
  for (let index = 0; index < image.data.length; index += 4) {
    image.data[index] = red;
    image.data[index + 1] = 0;
    image.data[index + 2] = 0;
    image.data[index + 3] = 255;
  }
  return PNG.sync.write(image);
}

test("passes a matching visual baseline without creating a diff artifact", async () => {
  const root = await mkdtemp(join(tmpdir(), "vraxis-visual-pass-"));
  const baseline = join(root, "baseline.png");
  const actual = join(root, "actual.png");
  const diff = join(root, "diff.png");
  await writeFile(baseline, png(255));
  await writeFile(actual, png(255));
  const result = await compareVisualBaseline(baseline, actual, diff, 0);
  assert.equal(result.passed, true);
  assert.equal(result.diffRatio, 0);
  await assert.rejects(stat(diff), /ENOENT/);
});

test("retains a bounded visual diff when the tolerance is exceeded", async () => {
  const root = await mkdtemp(join(tmpdir(), "vraxis-visual-fail-"));
  const baseline = join(root, "baseline.png");
  const actual = join(root, "actual.png");
  const diff = join(root, "diff.png");
  await writeFile(baseline, png(255));
  await writeFile(actual, png(0));
  const result = await compareVisualBaseline(baseline, actual, diff, 0.01);
  assert.equal(result.passed, false);
  assert.equal(result.diffPixels, 16);
  assert.equal(result.diffRatio, 1);
  assert.equal(result.diffAvailable, true);
  assert.equal((await stat(diff)).isFile(), true);
  assert.match(result.failure ?? "", /100\.000%/);
});
