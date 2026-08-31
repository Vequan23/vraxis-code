import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { verifyDesktopRelease } from "./verify-desktop-release.mjs";

const options = { tag: "v0.1.0", version: "0.1.0", owner: "Vequan23", repository: "vraxis-code" };

async function fixture(overrides = {}) {
  const root = await mkdtemp(join(tmpdir(), "vraxis-code-release-"));
  const fileName = "vraxis-code-0.1.0-darwin-arm64.dmg";
  const bytes = Buffer.from("signed-notarized-disk-image");
  await writeFile(join(root, fileName), bytes);
  const manifest = {
    schemaVersion: 1,
    product: { id: "vraxis-code", name: "Vraxis Code", version: "0.1.0", bundleId: "com.vraxis.code" },
    channel: "stable",
    generatedAt: "2026-08-31T12:00:00.000Z",
    security: { signed: true, notarized: true },
    artifacts: [{
      kind: "dmg",
      platform: "darwin",
      arch: "arm64",
      fileName,
      downloadUrl: `https://github.com/Vequan23/vraxis-code/releases/download/v0.1.0/${fileName}`,
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    }],
    ...overrides,
  };
  const manifestPath = join(root, "release.json");
  await writeFile(manifestPath, JSON.stringify(manifest));
  return { manifestPath, fileName };
}

test("accepts only a matching signed, notarized, checksummed release", async () => {
  const release = await fixture();
  const verified = await verifyDesktopRelease(release.manifestPath, options);
  assert.equal(verified.manifest.security.signed, true);
  assert.equal(verified.artifactPath, join(release.manifestPath, "..", release.fileName));
});

test("rejects unsigned, mismatched, and tampered release artifacts", async () => {
  const unsigned = await fixture({ security: { signed: false, notarized: false } });
  await assert.rejects(verifyDesktopRelease(unsigned.manifestPath, options), /signed and notarized/);

  const wrongTag = await fixture();
  await assert.rejects(verifyDesktopRelease(wrongTag.manifestPath, { ...options, tag: "v0.2.0" }), /must match package version/);

  const tampered = await fixture();
  await writeFile(join(tampered.manifestPath, "..", tampered.fileName), "different bytes");
  await assert.rejects(verifyDesktopRelease(tampered.manifestPath, options), /size does not match|checksum does not match/);
});
