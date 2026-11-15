import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";

const run = promisify(execFile);

export async function readFeedbackDeviceModel(): Promise<string> {
  try {
    let model = "";
    const options = { timeout: 3_000, maxBuffer: 16 * 1024, windowsHide: true };
    if (process.platform === "darwin") {
      model = (await run("/usr/sbin/sysctl", ["-n", "hw.model"], options))
        .stdout;
    } else if (process.platform === "win32") {
      model = (
        await run(
          "powershell.exe",
          [
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; $computer = Get-CimInstance Win32_ComputerSystem; Write-Output ($computer.Manufacturer + ' ' + $computer.Model)"
          ],
          options
        )
      ).stdout;
    } else if (process.platform === "linux") {
      const parts = await Promise.all(
        ["sys_vendor", "product_name"].map((name) =>
          readFile(`/sys/class/dmi/id/${name}`, "utf8")
        )
      );
      model = parts.map((part) => part.trim()).join(" ");
    }
    return Array.from(model.trim().replace(/\s+/gu, " "))
      .slice(0, 128)
      .join("");
  } catch {
    // Hardware lookup must not prevent a user from submitting feedback.
    return "";
  }
}
