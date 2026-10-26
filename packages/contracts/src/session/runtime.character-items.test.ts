import { describe, expect, it } from "vitest";
import {
  createShortWorkspaceContentRevision,
  shortWorkspaceRuntimeFixture
} from "../index.test-support";
import { WorkspaceRuntimeContextSchema } from "./runtime";

function characterContext(
  workspaceType: "short" | "script",
  content = "女主的完整人物设定。"
) {
  const base = shortWorkspaceRuntimeFixture();
  const workspace = {
    ...base,
    activeStageId: "character_design" as const,
    activeAgentId: workspaceType,
    characterStructure: {
      format: "list" as const,
      items: [
        {
          id: "character-1",
          title: "女主",
          order: 1,
          content,
          revision: createShortWorkspaceContentRevision(content)
        },
        {
          id: "character-2",
          title: "男主",
          order: 2,
          content: "男主的完整人物设定。",
          revision: createShortWorkspaceContentRevision("男主的完整人物设定。")
        }
      ]
    },
    stages: base.stages.map((stage) =>
      stage.stageId === "character_design"
        ? {
            ...stage,
            title: "概览",
            content: "女主、男主的人物索引。",
            revision:
              createShortWorkspaceContentRevision("女主、男主的人物索引。")
          }
        : stage
    )
  };
  return {
    workspace,
    context: {
      [workspaceType === "short" ? "shortWorkspace" : "scriptWorkspace"]:
        workspace,
      activeResource: {
        id: `book-document:${workspace.id}:character-1`,
        domain: "creation" as const,
        title: "女主",
        path: [workspace.title, "人物", "女主"],
        source: "live-editor" as const,
        content
      }
    }
  };
}

describe.each(["short", "script"] as const)(
  "%s character item runtime context",
  (workspaceType) => {
    it.each(["女主的完整人物设定。", ""])(
      "matches a selected character card separately from its overview (%j)",
      (content) => {
        const { context } = characterContext(workspaceType, content);
        expect(() =>
          WorkspaceRuntimeContextSchema.parse(context)
        ).not.toThrow();
      }
    );

    it("also matches a character by its direct item id", () => {
      const { context } = characterContext(workspaceType);
      context.activeResource.id = "character-1";
      context.activeResource.title = "重命名的人物卡";
      expect(() => WorkspaceRuntimeContextSchema.parse(context)).not.toThrow();
    });

    it("compares a bounded editor snapshot with the complete character card", () => {
      const content = `${"人设".repeat(10_010)}末尾设定。`;
      const { context } = characterContext(workspaceType, content);
      const activeResource = {
        ...context.activeResource,
        content: content.slice(0, 20_000),
        truncated: true,
        originalLength: content.length
      };
      expect(() =>
        WorkspaceRuntimeContextSchema.parse({ ...context, activeResource })
      ).not.toThrow();
      for (const invalidResource of [
        { ...activeResource, content: `错${activeResource.content.slice(1)}` },
        { ...activeResource, originalLength: content.length - 1 }
      ]) {
        expect(() =>
          WorkspaceRuntimeContextSchema.parse({
            ...context,
            activeResource: invalidResource
          })
        ).toThrow("must match the live active resource snapshot");
      }
    });

    it("rejects stale, other-card and overview content for a selected card", () => {
      const { workspace, context } = characterContext(workspaceType);
      for (const content of [
        "旧的人物设定。",
        workspace.characterStructure.items[1]!.content,
        workspace.stages.find(({ stageId }) => stageId === "character_design")!
          .content
      ]) {
        expect(() =>
          WorkspaceRuntimeContextSchema.parse({
            ...context,
            activeResource: { ...context.activeResource, content }
          })
        ).toThrow("must match the live active resource snapshot");
      }
    });

    it("rejects character content without a matching card identity", () => {
      const { context } = characterContext(workspaceType);
      expect(() =>
        WorkspaceRuntimeContextSchema.parse({
          ...context,
          activeResource: {
            ...context.activeResource,
            id: "unknown-character",
            title: "未知人物"
          }
        })
      ).toThrow("must match the live active resource snapshot");
    });

    it("continues to validate the overview and text-style character stage", () => {
      const { workspace, context } = characterContext(workspaceType);
      const overview = workspace.stages.find(
        ({ stageId }) => stageId === "character_design"
      )!;
      const activeResource = {
        ...context.activeResource,
        id: `book-document:${workspace.id}:character_design`,
        title: "概览",
        content: overview.content
      };
      const key =
        workspaceType === "short" ? "shortWorkspace" : "scriptWorkspace";
      for (const characterStructure of [
        workspace.characterStructure,
        { format: "list", items: [] },
        { format: "text" }
      ]) {
        expect(() =>
          WorkspaceRuntimeContextSchema.parse({
            [key]: { ...workspace, characterStructure },
            activeResource
          })
        ).not.toThrow();
      }
    });
  }
);
