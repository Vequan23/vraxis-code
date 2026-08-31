import { chmod, stat } from "node:fs/promises";
import { arch, platform } from "node:os";
import { join } from "node:path";

if (platform() !== "win32") {
  const helper = join(process.cwd(), "node_modules", "node-pty", "prebuilds", `${platform()}-${arch()}`, "spawn-helper");
  try {
    const mode = (await stat(helper)).mode;
    await chmod(helper, mode | 0o111);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}
