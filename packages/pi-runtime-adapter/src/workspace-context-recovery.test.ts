import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_LIBRARY_AGENT_PROFILES,
  DEFAULT_SHORT_WORKSPACE_AGENT_PROFILES
} from "@deepwrite/contracts";
import { rehydrateWorkspaceContext } from "./workspace-context-recovery";
import { emptyContextRefs } from "./kernel/context";
import {
  fixtureIndex,
  workspace,
  profile,
  indexResult,
  type LongCommandExecutor
} from "./long-agent-tools.test-support";

const refs = { ...emptyContextRefs(), skills: ["通用技法", "被撤销的技法"] };
const attachedSkills = [
  {
    id: "skill-good",
    title: "通用技法",
    content: "使用具体动作表达心理。",
    source: "attached-skill" as const,
    kind: "general" as const
  },
  {
    id: "skill-revoked",
    title: "被撤销的技法",
    content: "不应恢复的内容",
    source: "attached-skill" as const,
    kind: "style" as const
  }
];

describe("writing-specific source recovery", () => {
  it("rehydrates all currently bound skill bodies across kinds within budget and skips unbound skills", async () => {
    const agentProfile = structuredClone(
      DEFAULT_SHORT_WORKSPACE_AGENT_PROFILES[0]!
    );
    agentProfile.readAccess.skill = ["general"];
    const result = await rehydrateWorkspaceContext(
      {
        runId: "run",
        sessionId: "session",
        prompt: "写作",
        agentProfile,
        workspaceContext: { attachedSkills: [attachedSkills[0]!] }
      },
      "short-plot",
      refs,
      500
    );
    expect(result).toContain("使用具体动作表达心理");
    expect(result).not.toContain("不应恢复的内容");

    const crossKind = await rehydrateWorkspaceContext(
      {
        runId: "run",
        sessionId: "session",
        prompt: "写作",
        agentProfile,
        workspaceContext: { attachedSkills }
      },
      "short-plot",
      refs,
      500
    );
    expect(crossKind).toContain("使用具体动作表达心理");
    expect(crossKind).toContain("不应恢复的内容");
    const tiny = await rehydrateWorkspaceContext(
      {
        runId: "run",
        sessionId: "session",
        prompt: "写作",
        agentProfile,
        workspaceContext: { attachedSkills }
      },
      "short-plot",
      refs,
      2
    );
    expect(tiny).toBeUndefined();
  });

  it("uses a library manager's skill allowlist rather than workspace kinds", async () => {
    const libraryAgentProfile = structuredClone(
      DEFAULT_LIBRARY_AGENT_PROFILES[0]!
    );
    libraryAgentProfile.readAccess.skills = [
      {
        id: "skill-good",
        name: "通用技法",
        description: "测试技法",
        content: "使用具体动作表达心理。"
      }
    ];
    const result = await rehydrateWorkspaceContext(
      {
        runId: "run",
        sessionId: "session",
        prompt: "整理",
        libraryAgentProfile,
        workspaceContext: { attachedSkills }
      },
      "library-skill",
      refs,
      500
    );
    expect(result).toContain("通用技法");
    expect(result).not.toContain("被撤销的技法");
  });

  it("reads the long chapter tail from Core using the authorized book and Unicode offsets", async () => {
    const index = fixtureIndex();
    const body = `${"旧稿😀".repeat(800)}灯塔忽然熄灭。`;
    const file = index.chapters[0]!.body;
    const executor = vi.fn<LongCommandExecutor>(async (command) => {
      expect(command.context.runId).toBe("run");
      if (command.type === "long.getWorkspaceIndex") return indexResult(index);
      if (command.type !== "long.readDocument")
        throw new Error("Unexpected command");
      expect(command.payload.bookId).toBe(index.bookId);
      expect(command.payload.fileId).toBe(file.id);
      const characters = [...body];
      const end = Math.min(
        characters.length,
        command.payload.offset + command.payload.maxCharacters
      );
      return {
        status: "accepted",
        requestId: command.id,
        payload: {
          bookId: index.bookId,
          file,
          content: characters.slice(command.payload.offset, end).join(""),
          offset: command.payload.offset,
          totalCharacters: characters.length,
          nextOffset: end < characters.length ? end : null
        }
      };
    });
    const result = await rehydrateWorkspaceContext(
      {
        runId: "run",
        sessionId: "session",
        prompt: "继续写",
        longAgentProfile: profile("long"),
        workspaceContext: {
          longWorkspace: {
            ...workspace("long", "draft"),
            activeChapterCardId: "chapter_one"
          }
        },
        longCommandExecutor: executor
      },
      "long",
      emptyContextRefs(),
      4_000
    );
    expect(result).toContain("灯塔忽然熄灭。");
    expect(result).toContain("Core 当前保存版本");
    expect(result).toContain("修改前仍须 read");
    expect(executor).toHaveBeenCalledTimes(3);
  });
});
