import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type ProjectFolderPicker = () => Promise<string | null>;

export async function pickProjectFolderWithSystemDialog(prompt = "Choose a project for Vraxis Code"): Promise<string | null> {
  return pickFolderWithSystemDialog(prompt);
}

export async function pickParentFolderWithSystemDialog(): Promise<string | null> {
  return pickFolderWithSystemDialog("Choose where to create the new project");
}

async function pickFolderWithSystemDialog(prompt: string): Promise<string | null> {
  try {
    const result = process.platform === "darwin"
      ? await execFileAsync("osascript", [
        "-e",
        `POSIX path of (choose folder with prompt "${prompt.replace(/"/g, "\\\"")}")`,
      ], { timeout: 120_000, maxBuffer: 64 * 1024 })
      : process.platform === "win32"
        ? await execFileAsync("powershell.exe", [
          "-NoProfile",
          "-NonInteractive",
          "-STA",
          "-Command",
          `Add-Type -AssemblyName System.Windows.Forms; $dialog = New-Object System.Windows.Forms.FolderBrowserDialog; $dialog.Description = "${prompt.replace(/"/g, '`"')}"; if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($dialog.SelectedPath) } else { exit 2 }`,
        ], { timeout: 120_000, maxBuffer: 64 * 1024 })
        : await pickLinuxProjectFolder(prompt);
    return result.stdout.trim() || null;
  } catch (error) {
    const code = (error as { code?: number }).code;
    if (code === 2 || (process.platform !== "win32" && code === 1)) return null;
    const diagnostic = `${(error as { stderr?: string }).stderr || ""} ${error instanceof Error ? error.message : ""}`;
    if (/user canceled|cancelled|canceled|-128|exit code 1/i.test(diagnostic)) return null;
    throw new Error("The project chooser could not open.");
  }
}

async function pickLinuxProjectFolder(prompt: string): Promise<{ stdout: string }> {
  try {
    return await execFileAsync("zenity", [
      "--file-selection",
      "--directory",
      `--title=${prompt}`,
    ], { timeout: 120_000, maxBuffer: 64 * 1024 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  try {
    return await execFileAsync("kdialog", [
      "--getexistingdirectory",
      ".",
      "--title",
      prompt,
    ], { timeout: 120_000, maxBuffer: 64 * 1024 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error("Install Zenity or KDialog to choose a project from the browser. The desktop app includes its own project chooser.");
    }
    throw error;
  }
}
