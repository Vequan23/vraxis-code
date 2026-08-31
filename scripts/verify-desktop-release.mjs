import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

async function sha256(path) {
  const hash = createHash("sha256");
  await new Promise((resolveHash, reject) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.once("error", reject);
    stream.once("end", resolveHash);
  });
  return hash.digest("hex");
}

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} is invalid.`);
  return value;
}

export async function verifyDesktopRelease(manifestPath, options) {
  const manifest = object(JSON.parse(await readFile(manifestPath, "utf8")), "Release manifest");
  const product = object(manifest.product, "Release product");
  const security = object(manifest.security, "Release security");
  if (manifest.schemaVersion !== 1) throw new TypeError("Release manifest version is not supported.");
  if (product.id !== "vraxis-code" || product.name !== "Vraxis Code") throw new TypeError("Release product identity does not match Vraxis Code.");
  if (product.version !== options.version || options.tag !== `v${options.version}`) {
    throw new TypeError(`Release tag ${options.tag} must match package version ${options.version}.`);
  }
  if (manifest.channel !== "stable") throw new TypeError("Public releases must use the stable channel.");
  if (security.signed !== true || security.notarized !== true) {
    throw new TypeError("Public releases must be signed and notarized before publication.");
  }
  if (!Array.isArray(manifest.artifacts) || manifest.artifacts.length !== 1) {
    throw new TypeError("Release manifest must contain exactly one artifact.");
  }
  const artifact = object(manifest.artifacts[0], "Release artifact");
  if (artifact.kind !== "dmg" || artifact.platform !== "darwin" || !["arm64", "x64", "universal"].includes(artifact.arch)) {
    throw new TypeError("Release artifact must be a supported macOS disk image.");
  }
  if (typeof artifact.fileName !== "string" || basename(artifact.fileName) !== artifact.fileName || !artifact.fileName.endsWith(".dmg")) {
    throw new TypeError("Release artifact file name is unsafe.");
  }
  const expectedDownload = `https://github.com/${options.owner}/${options.repository}/releases/download/${options.tag}/${artifact.fileName}`;
  if (artifact.downloadUrl !== expectedDownload) throw new TypeError("Release download URL does not match the tagged GitHub release.");
  if (typeof artifact.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(artifact.sha256)) {
    throw new TypeError("Release artifact checksum is invalid.");
  }
  const artifactPath = resolve(dirname(manifestPath), artifact.fileName);
  const details = await stat(artifactPath);
  if (!details.isFile() || artifact.bytes !== details.size) throw new TypeError("Release artifact size does not match its manifest.");
  if (await sha256(artifactPath) !== artifact.sha256) throw new TypeError("Release artifact checksum does not match its bytes.");
  return { manifestPath: resolve(manifestPath), artifactPath, manifest };
}

async function main() {
  const manifestPath = process.argv[2];
  const tag = process.argv[3] ?? process.env.GITHUB_REF_NAME;
  if (!manifestPath || !tag) throw new TypeError("Usage: verify-desktop-release <manifest.json> <vX.Y.Z>");
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const verified = await verifyDesktopRelease(manifestPath, {
    tag,
    version: String(packageJson.version),
    owner: "Vequan23",
    repository: "vraxis-code",
  });
  process.stdout.write(`${JSON.stringify({ manifestPath: verified.manifestPath, artifactPath: verified.artifactPath })}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
