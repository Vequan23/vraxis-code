import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

const maximumPngBytes = 10 * 1024 * 1024;
const maximumPixels = 16_000_000;

export interface VisualComparisonResult {
  passed: boolean;
  width?: number;
  height?: number;
  diffPixels?: number;
  totalPixels?: number;
  diffRatio?: number;
  diffAvailable?: boolean;
  failure?: string;
}

async function boundedPng(path: string, label: string): Promise<PNG> {
  const file = await stat(path);
  if (!file.isFile()) throw new TypeError(`${label} must be a regular PNG file.`);
  if (file.size > maximumPngBytes) throw new TypeError(`${label} must be 10 MB or smaller.`);
  const buffer = await readFile(path);
  const signature = "89504e470d0a1a0a";
  if (buffer.length < 24 || buffer.subarray(0, 8).toString("hex") !== signature || buffer.subarray(12, 16).toString("ascii") !== "IHDR") {
    throw new TypeError(`${label} is not a valid PNG file.`);
  }
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (!width || !height || width > 8_192 || height > 8_192 || width * height > maximumPixels) {
    throw new TypeError(`${label} dimensions exceed the 16 megapixel safety limit.`);
  }
  return PNG.sync.read(buffer, { checkCRC: true });
}

export async function compareVisualBaseline(
  baselinePath: string,
  actualPath: string,
  diffPath: string,
  maxDiffRatio: number,
): Promise<VisualComparisonResult> {
  const [baseline, actual] = await Promise.all([
    boundedPng(baselinePath, "Visual baseline"),
    boundedPng(actualPath, "Captured browser frame"),
  ]);
  if (baseline.width !== actual.width || baseline.height !== actual.height) {
    return {
      passed: false,
      width: actual.width,
      height: actual.height,
      totalPixels: actual.width * actual.height,
      diffAvailable: false,
      failure: `Visual baseline is ${baseline.width}×${baseline.height}, but the captured frame is ${actual.width}×${actual.height}.`,
    };
  }
  const diff = new PNG({ width: actual.width, height: actual.height });
  const diffPixels = pixelmatch(baseline.data, actual.data, diff.data, actual.width, actual.height, {
    threshold: 0.1,
    includeAA: false,
  });
  const totalPixels = actual.width * actual.height;
  const diffRatio = diffPixels / totalPixels;
  const passed = diffRatio <= maxDiffRatio;
  if (!passed) {
    await mkdir(dirname(diffPath), { recursive: true, mode: 0o700 });
    const temporary = `${diffPath}.tmp`;
    await writeFile(temporary, PNG.sync.write(diff), { mode: 0o600 });
    await rename(temporary, diffPath);
  }
  return {
    passed,
    width: actual.width,
    height: actual.height,
    diffPixels,
    totalPixels,
    diffRatio,
    diffAvailable: !passed,
    ...(!passed ? { failure: `${diffPixels} pixels (${(diffRatio * 100).toFixed(3)}%) differ; the recipe allows ${(maxDiffRatio * 100).toFixed(3)}%.` } : {}),
  };
}
