import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getDefaultMysteryAgentProfile } from "@deepwrite/contracts";
import { MysteryAgentConfigStore } from "./mystery-agent-config-store";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "deepwrite-mystery-agents-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    await rm(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("MysteryAgentConfigStore", () => {
  it("loads defaults, saves customized prompt and shortcuts, and resets cleanly", async () => {
    const root = await makeTempDir();
    const store = new MysteryAgentConfigStore(root);
    const initial = await store.list();

    expect(initial.workspaceType).toBe("mystery");
    expect(initial.agents).toHaveLength(1);
    expect(initial.agents[0]?.id).toBe("mystery");
    expect(initial.agents[0]?.systemPrompt).toBe(
      getDefaultMysteryAgentProfile("mystery").systemPrompt
    );

    const saved = await store.save({
      workspaceType: "mystery",
      agents: [
        {
          id: "mystery",
          systemPrompt: "自定义剧本杀主创智能体提示词：优先校验核诡与时间线。",
          welcomeShortcuts: ["梳理五步骨架", "补全角色底牌", "发起测本审计"]
        }
      ]
    });
    expect(saved.agents[0]?.systemPrompt).toContain("自定义剧本杀主创");

    const rawDisk = JSON.parse(
      await readFile(join(root, "config", "mystery-agents.json"), "utf8")
    ) as { version: number; workspaceType: string };
    expect(rawDisk.version).toBe(1);
    expect(rawDisk.workspaceType).toBe("mystery");

    const resolved = await store.resolve("mystery");
    expect(resolved.welcomeShortcuts[0]).toBe("梳理五步骨架");

    const reset = await store.reset("mystery");
    expect(reset.agents[0]?.systemPrompt).toBe(
      getDefaultMysteryAgentProfile("mystery").systemPrompt
    );
  });

  it("refuses corrupted non-object disk config without overwriting", async () => {
    const root = await makeTempDir();
    const configDir = join(root, "config");
    const store = new MysteryAgentConfigStore(root);
    await store.reset();
    await writeFile(join(configDir, "mystery-agents.json"), "[]", "utf8");
    await expect(store.list()).rejects.toThrow("已停止加载");
  });
});
