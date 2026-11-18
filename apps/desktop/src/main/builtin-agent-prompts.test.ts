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
import { AcademicAgentConfigStore } from "./academic-agent-config-store";
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

  it("recognizes the pre-guard and pre-checkpoint long prompts in both languages", () => {
    const current = BUILTIN_AGENT_SYSTEM_PROMPTS.long;
    const beforeGuards = [
      current["zh-CN"]
        .replace(
          "写章节前读本章章卡和上一章结尾；章卡写作上下文够用就直接写，缺什么只读那一个对象",
          "写章节前读取章卡、出场人物和最近检查点的接续包；检查点之后若有已写未提交的章节，再读取这些章节的正文结尾"
        )
        .replace(
          "细化章卡时，把本章要用的上下文写进章卡的写作上下文小节，只写本章用得上的。",
          ""
        ),
      current["en-US"]
        .replace(
          "before drafting, read this chapter's card and the previous chapter's ending. If the card's writing context is enough, start writing; otherwise read only the missing object.",
          "before writing a chapter, read its chapter card, the characters who appear and the latest checkpoint's handoff. If written, uncommitted chapters follow that checkpoint, also read their manuscript endings."
        )
        .replace(
          " When refining a chapter card, put the context needed for that chapter in its writing-context section, including only what this chapter needs.",
          ""
        )
    ];
    const beforeCheckpoint = [
      beforeGuards[0]!.replace(
        "写章节前读取章卡、出场人物和最近检查点的接续包；检查点之后若有已写未提交的章节，再读取这些章节的正文结尾",
        "写章节前读取章卡、出场人物、上一章的交接和相关连续性"
      ),
      beforeGuards[1]!.replace(
        "before writing a chapter, read its chapter card, the characters who appear and the latest checkpoint's handoff. If written, uncommitted chapters follow that checkpoint, also read their manuscript endings.",
        "before writing a chapter, read its chapter card, the characters who appear, the previous chapter's handoff and the relevant continuity."
      )
    ];
    for (const text of [...beforeGuards, ...beforeCheckpoint]) {
      expect(text).not.toBe(current["zh-CN"]);
      expect(text).not.toBe(current["en-US"]);
      expect(isBuiltinAgentSystemPrompt("long", text)).toBe(true);
      expect(localizeAgentSystemPrompt("long", text, "en-US")).toBe(
        current["en-US"]
      );
    }
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
    const academic = new AcademicAgentConfigStore(root);
    // Saving the Chinese defaults stores them as written.
    await workspace.save({
      ...(await workspace.list("short")),
      agents: (await workspace.list("short")).agents
    });
    await academic.save({
      workspaceType: "academic",
      agents: (await academic.list()).agents.map((agent) => ({
        id: agent.id,
        systemPrompt: agent.systemPrompt,
        welcomeShortcuts: agent.welcomeShortcuts,
        modelMode: agent.modelMode
      }))
    });

    setNativeLanguage("en-US", "zh-CN");
    expect((await workspace.resolve("short", "short")).systemPrompt).toBe(
      BUILTIN_AGENT_SYSTEM_PROMPTS.short["en-US"]
    );
    expect((await workspace.resolve("script", "script")).systemPrompt).toBe(
      BUILTIN_AGENT_SYSTEM_PROMPTS.script["en-US"]
    );
    expect((await academic.resolve("academic")).systemPrompt).toBe(
      BUILTIN_AGENT_SYSTEM_PROMPTS.academic["en-US"]
    );
    expect((await library.resolve("material")).systemPrompt).toBe(
      BUILTIN_AGENT_SYSTEM_PROMPTS.material["en-US"]
    );
    expect((await library.resolve("skill")).systemPrompt).toBe(
      BUILTIN_AGENT_SYSTEM_PROMPTS.skill["en-US"]
    );
    expect((await long.resolve("long")).systemPrompt).toBe(custom);

    const customAcademic = "我的学术提示词：聚焦实证经济学因果推断。";
    await academic.save({
      workspaceType: "academic",
      agents: [
        {
          id: "academic",
          systemPrompt: customAcademic,
          welcomeShortcuts: (await academic.list()).agents[0]!.welcomeShortcuts,
          modelMode: "inherit"
        }
      ]
    });
    expect((await academic.resolve("academic")).systemPrompt).toBe(
      customAcademic
    );

    setNativeLanguage("auto", "zh-Hans-CN");
    expect((await workspace.resolve("short", "short")).systemPrompt).toBe(
      BUILTIN_AGENT_SYSTEM_PROMPTS.short["zh-CN"]
    );
    await long.reset("long");
    await academic.reset("academic");
    setNativeLanguage("auto", "en-US");
    expect((await long.resolve("long")).systemPrompt).toBe(
      BUILTIN_AGENT_SYSTEM_PROMPTS.long["en-US"]
    );
    expect((await academic.resolve("academic")).systemPrompt).toBe(
      BUILTIN_AGENT_SYSTEM_PROMPTS.academic["en-US"]
    );
  });
});
