import { access, mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import skillText from "./skill/SKILL.md?raw";
import { ExternalControlError } from "./errors";

const SKILL_TARGETS = [
  { id: "zcode", label: "ZCode", directory: [".zcode", "skills"] },
  { id: "kimi", label: "Kimi Code", directory: [".agents", "skills"] },
  { id: "claude", label: "Claude Code", directory: [".claude", "skills"] },
  { id: "codex", label: "Codex", directory: [".codex", "skills"] },
  { id: "agents", label: "DeepSeek Harness", directory: [".agents", "skills"] },
  { id: "workbuddy", label: "WorkBuddy", directory: [".workbuddy", "skills"] }
] as const;

function skillFile(home: string, directory: readonly string[]): string {
  return join(home, ...directory, "deepwrite", "SKILL.md");
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export function listSkillTargets(home: string) {
  return Promise.all(
    SKILL_TARGETS.map(async ({ id, label, directory }) => ({
      id,
      label,
      installed: await exists(skillFile(home, directory))
    }))
  );
}

/** Only ever writes deepwrite/SKILL.md, so other skills stay untouched. */
export async function installSkill(
  home: string,
  targetId: string
): Promise<void> {
  const target = SKILL_TARGETS.find(({ id }) => id === targetId);
  if (!target) {
    throw new ExternalControlError(
      "external.invalid_input",
      "未知的安装目标。"
    );
  }
  const path = skillFile(home, target.directory);
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, skillText, "utf8");
  await rename(temporary, path);
}
