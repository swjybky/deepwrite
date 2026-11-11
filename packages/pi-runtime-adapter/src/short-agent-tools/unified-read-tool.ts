import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import { defineTool } from "./schema";
import {
  currentWritingWorkspaceNavigation,
  renderWritingWorkspaceDirectory
} from "../writing-workspace-directory";
import {
  countWritingContentCharacters,
  writingReadContentCountLine,
  WRITING_READ_CONTENT_COUNT_DESCRIPTION
} from "../writing-content-counts";
import {
  orderedExpertSections,
  textResult,
  workspaceKindLabel,
  type BuildWritingWorkspaceToolsInput,
  type ShortWorkspaceToolSharedState
} from "./shared";
import {
  stableWritingIdParameter,
  writingDocumentParameter,
  writingReadKindParameter
} from "./tool-parameters";
import {
  resolveShortUnifiedTarget,
  type ShortUnifiedTarget
} from "./unified-target";

const LARGE_DRAFT_CHARACTER_THRESHOLD = 50_000;

export interface ShortUnifiedReadEvidence {
  content: string;
  revision: string;
}

export interface ShortUnifiedReadState {
  fullyRead: Map<string, ShortUnifiedReadEvidence>;
}

export function createShortUnifiedReadState(): ShortUnifiedReadState {
  return { fullyRead: new Map() };
}

export function hasCurrentReadEvidence(
  state: ShortUnifiedReadState,
  target: ShortUnifiedTarget
): boolean {
  const evidence = state.fullyRead.get(target.documentId);
  return (
    evidence?.revision === target.revision &&
    evidence.content === target.content
  );
}

export function recordUpdatedReadEvidence(
  state: ShortUnifiedReadState,
  target: ShortUnifiedTarget,
  content: string,
  revision: string
): void {
  state.fullyRead.set(target.documentId, { content, revision });
}

function readDraftDirectory(
  input: BuildWritingWorkspaceToolsInput,
  state: ShortWorkspaceToolSharedState
): string {
  const sections = orderedExpertSections(input, state.expertSections);
  const bodyCharacters = sections.reduce(
    (total, section) =>
      total + countWritingContentCharacters(section.body.content),
    0
  );
  const characterStateCharacters = sections.reduce(
    (total, section) =>
      total + countWritingContentCharacters(section.characterState.content),
    0
  );
  return [
    `【${input.workspace.expertDraft.title}】`,
    "kind: draft",
    "id: draft",
    `正文总字数：${bodyCharacters} 字`,
    `人物状态总字数：${characterStateCharacters} 字`,
    "",
    ...sections.map(
      (section, index) =>
        `${index + 1}. ${section.title}（id=${section.id}；字数要求=${section.wordCountRequirement || "未设置"}；正文字数=${countWritingContentCharacters(section.body.content)}；人物状态字数=${countWritingContentCharacters(section.characterState.content)}）`
    )
  ].join("\n");
}

function readAllDraftSections(
  input: BuildWritingWorkspaceToolsInput,
  state: ShortWorkspaceToolSharedState,
  readState: ShortUnifiedReadState,
  document: "body" | "character_state"
): string {
  const fileKind = document === "body" ? "body" : "characterState";
  const sections = orderedExpertSections(input, state.expertSections);
  const parts = sections.map((section, index) => {
    const file = section[fileKind];
    readState.fullyRead.set(file.documentId, {
      content: file.content,
      revision: file.revision
    });
    return [
      `【${index + 1}. ${section.title}｜id=${section.id}｜document=${document}】`,
      writingReadContentCountLine(file.content),
      file.content || "（正文为空）"
    ].join("\n");
  });
  const totalCharacters = sections.reduce(
    (total, section) =>
      total + countWritingContentCharacters(section[fileKind].content),
    0
  );
  return [
    `【${input.workspace.expertDraft.title}｜全部${document === "body" ? "正文" : "人物状态"}】`,
    `sections: ${sections.length}`,
    `total_characters: ${totalCharacters}`,
    `合计字数：${totalCharacters} 字`,
    ...(totalCharacters > LARGE_DRAFT_CHARACTER_THRESHOLD
      ? [
          `长度提示：合计超过 ${LARGE_DRAFT_CHARACTER_THRESHOLD} 字，后续精读或修改时建议按 draft_section 的稳定 id 分步读取；本次仍按明确请求完整返回。`
        ]
      : []),
    "",
    ...parts
  ].join("\n\n");
}

export function buildShortUnifiedReadTool(
  input: BuildWritingWorkspaceToolsInput,
  sharedState: ShortWorkspaceToolSharedState,
  readState: ShortUnifiedReadState
): AgentTool {
  return defineTool({
    name: "read",
    label: `读取${workspaceKindLabel(input)}对象`,
    description:
      "按稳定业务 id 一次读全人物概览、人物条目、剧情结构或正文小节，没有分页和预览模式。kind 与 id 必须按目录配对：人物概览用 kind=character_overview、id=character_design；剧情结构用 kind=plot_stage 与该阶段 id，不能把 plot_stage-… 与 character_overview 混用。kind=workspace、id=workspace 获取实时人物、剧情结构和正文小节目录，包含本轮新建对象；不知道目标 id 时先读此目录，不要用人名或标题代替 id。kind=draft_section 必须同时给出 document=body 或 character_state。kind=draft、id=draft 读取正文目录及各小节的正文、人物状态字数；再设置 include_all_sections=true 可一次返回全部小节及合计字数，不传 document 时默认 body。全部正文超过五万字时会给出分步精读建议，但仍完整返回。修改任何已有正文前必须先 read 完整读取。" +
      WRITING_READ_CONTENT_COUNT_DESCRIPTION,
    parameters: Type.Object(
      {
        kind: writingReadKindParameter,
        id: stableWritingIdParameter,
        document: Type.Optional(writingDocumentParameter),
        include_all_sections: Type.Optional(
          Type.Boolean({
            description:
              "仅 kind=draft、id=draft：一次返回全部小节。不传 document 时默认 body；读取人物状态须指定 document=character_state。"
          })
        )
      },
      { additionalProperties: false }
    ),
    execute: async (_toolCallId, params) => {
      if (params.kind === "workspace") {
        if (String(params.id).trim() !== "workspace") {
          throw new Error("作品对象目录的稳定 id 固定为 workspace。");
        }
        if (params.document || params.include_all_sections === true) {
          throw new Error(
            "作品对象目录不接受 document 或 include_all_sections=true。"
          );
        }
        return textResult(
          renderWritingWorkspaceDirectory(
            currentWritingWorkspaceNavigation(input.workspace, sharedState)
          )
        );
      }
      if (params.kind === "draft") {
        if (String(params.id).trim() !== "draft") {
          throw new Error("正文目录的稳定 id 固定为 draft。");
        }
        if (params.include_all_sections === true) {
          return textResult(
            readAllDraftSections(
              input,
              sharedState,
              readState,
              params.document ?? "body"
            )
          );
        }
        if (params.document) {
          throw new Error(
            "读取正文目录时，document 只与 include_all_sections=true 一起使用。"
          );
        }
        return textResult(readDraftDirectory(input, sharedState));
      }
      if (params.include_all_sections === true) {
        throw new Error("include_all_sections 仅用于 kind=draft、id=draft。");
      }
      if (params.kind === "draft_section" && !params.document) {
        throw new Error(
          "读取 draft_section 必须指定 document=body 或 character_state。"
        );
      }
      const target = resolveShortUnifiedTarget(input, sharedState, {
        kind: params.kind,
        id: String(params.id),
        ...(params.document ? { document: params.document } : {})
      });
      if (!target.truncated) {
        readState.fullyRead.set(target.documentId, {
          content: target.content,
          revision: target.revision
        });
      }
      return textResult(
        [
          `【${target.title}】`,
          `kind: ${target.kind}`,
          `id: ${target.id}`,
          ...(params.document ? [`document: ${params.document}`] : []),
          writingReadContentCountLine(target.content, target.truncated),
          ...(target.truncated
            ? ["读取状态：运行时快照已截断，不能据此修改目标。"]
            : []),
          "",
          target.content || "（正文为空）"
        ].join("\n")
      );
    }
  });
}
