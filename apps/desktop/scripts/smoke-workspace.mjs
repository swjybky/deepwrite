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
  // Smoke selectors assert the Chinese UI, while first-run language
  // resolution follows the host locale (en-US on CI runners). Seed the
  // persisted language so every smoke run boots in the same UI language.
  await writeFile(
    join(profile, "config", "general-settings.json"),
    JSON.stringify({
      version: 2,
      permissionMode: "auto-approve",
      autoApproveCrossStageOperations: true,
      autoSave: true,
      language: "zh-CN",
      showInMenuBar: true
    })
  );
}
