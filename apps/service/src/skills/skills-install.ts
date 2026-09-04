import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { buildSkillsInstallInvocation } from "./skills-cli.js";

const execFileAsync = promisify(execFile);

export interface SkillsInstallInput {
  source: string;
  global?: boolean;
  skillNames?: readonly string[];
  agents: readonly string[];
}

export async function installSkillsFromSource(
  projectPath: string,
  input: SkillsInstallInput,
): Promise<{ stdout: string; stderr: string }> {
  const { command, args } = buildSkillsInstallInvocation(input);
  const result = await execFileAsync(command, [...args], {
    cwd: projectPath,
    env: process.env,
    maxBuffer: 2 * 1024 * 1024,
    timeout: 5 * 60_000,
  });
  return { stdout: String(result.stdout), stderr: String(result.stderr) };
}
