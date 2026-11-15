import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Keep smoke-created projects inside the disposable profile, away from Documents. */
export async function prepareSmokeWorkspace(profile) {
  const workspace = join(profile, "workspace");
  await mkdir(workspace, { recursive: true });
  await mkdir(join(profile, "config"), { recursive: true });
  await writeFile(
    join(profile, "config", "workspace-directory.json"),
    JSON.stringify({ version: 1, path: workspace })
  );
  // UI smoke selectors use Chinese; CI hosts normally start in English.
  // Preserve saved settings on reopen so language persistence stays testable.
  await writeFile(
    join(profile, "config", "general-settings.json"),
    JSON.stringify({
      version: 2,
      permissionMode: "auto-approve",
      autoSave: true,
      language: "zh-CN",
      showInMenuBar: true
    }),
    { flag: "wx" }
  ).catch((error) => {
    if (error.code !== "EEXIST") throw error;
  });
}
