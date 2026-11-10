import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  BUILTIN_AGENT_PROMPT_KEYS,
  BUILTIN_AGENT_SYSTEM_PROMPTS,
  DEFAULT_LONG_AGENT_SETTINGS
} from "@deepwrite/contracts";
import {
  isBuiltinAgentSystemPrompt,
  localizeAgentSystemPrompt
} from "./builtin-agent-prompts";
import { LibraryAgentConfigStore } from "./library-agent-config-store";
import {
  LONG_AGENT_SETTINGS_DISK_VERSION,
  LongAgentConfigStore
} from "./long-agent-config-store";
import { setNativeLanguage } from "./native-i18n";
import { WorkspaceAgentConfigStore } from "./workspace-agent-config-store";

afterEach(() => setNativeLanguage("zh-CN", "zh-CN"));

describe("built-in agent prompts follow the app language", () => {
  it("recognizes every language of a built-in prompt and keeps custom ones", () => {
    for (const key of BUILTIN_AGENT_PROMPT_KEYS) {
      const { "zh-CN": zh, "en-US": en } = BUILTIN_AGENT_SYSTEM_PROMPTS[key];
      expect(isBuiltinAgentSystemPrompt(key, zh)).toBe(true);
      expect(
        isBuiltinAgentSystemPrompt(key, `${en.replace(/\n/g, "\r\n")}\n`)
      ).toBe(true);
      expect(localizeAgentSystemPrompt(key, zh, "en-US")).toBe(en);
      expect(localizeAgentSystemPrompt(key, undefined, "zh-CN")).toBe(zh);
      expect(
        localizeAgentSystemPrompt(key, `${zh}\n补充：只写悬疑。`, "en-US")
      ).toBe(`${zh}\n补充：只写悬疑。`);
    }
    expect(
      isBuiltinAgentSystemPrompt(
        "short",
        BUILTIN_AGENT_SYSTEM_PROMPTS.long["zh-CN"]
      )
    ).toBe(false);
  });

  it("serves untouched saved prompts in the current language from every store", async () => {
    const root = await mkdtemp(join(tmpdir(), "deepwrite-prompt-locale-"));
    await mkdir(join(root, "config"), { recursive: true });
    const custom = "我的长篇提示词：只写群像。";
    await writeFile(
      join(root, "config", "long-workspace-agents.json"),
      JSON.stringify({
        version: LONG_AGENT_SETTINGS_DISK_VERSION,
        workspaceType: "long",
        agents: DEFAULT_LONG_AGENT_SETTINGS.agents.map((agent) => ({
          id: agent.id,
          systemPrompt: custom,
          welcomeShortcuts: agent.welcomeShortcuts,
          readAccess: agent.readAccess
        }))
      })
    );
    const workspace = new WorkspaceAgentConfigStore(root);
    const library = new LibraryAgentConfigStore(root);
    const long = new LongAgentConfigStore(root);
    // Saving the Chinese defaults stores them as written.
    await workspace.save({
      ...(await workspace.list("short")),
      agents: (await workspace.list("short")).agents
    });

    setNativeLanguage("en-US", "zh-CN");
    expect((await workspace.resolve("short", "short")).systemPrompt).toBe(
      BUILTIN_AGENT_SYSTEM_PROMPTS.short["en-US"]
    );
    expect((await workspace.resolve("script", "script")).systemPrompt).toBe(
      BUILTIN_AGENT_SYSTEM_PROMPTS.script["en-US"]
    );
    expect((await library.resolve("material")).systemPrompt).toBe(
      BUILTIN_AGENT_SYSTEM_PROMPTS.material["en-US"]
    );
    expect((await library.resolve("skill")).systemPrompt).toBe(
      BUILTIN_AGENT_SYSTEM_PROMPTS.skill["en-US"]
    );
    expect((await long.resolve("long")).systemPrompt).toBe(custom);

    setNativeLanguage("auto", "zh-Hans-CN");
    expect((await workspace.resolve("short", "short")).systemPrompt).toBe(
      BUILTIN_AGENT_SYSTEM_PROMPTS.short["zh-CN"]
    );
    await long.reset("long");
    setNativeLanguage("auto", "en-US");
    expect((await long.resolve("long")).systemPrompt).toBe(
      BUILTIN_AGENT_SYSTEM_PROMPTS.long["en-US"]
    );
  });
});
