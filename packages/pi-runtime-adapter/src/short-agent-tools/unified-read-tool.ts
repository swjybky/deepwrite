import { assertWritingDocumentAvailable } from "./settlement";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { StringEnum } from "@earendil-works/pi-ai";
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
import { writingParameters } from "./tool-parameters";
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
  partialRanges: Map<string, { revision: string; ranges: [number, number][] }>;
}

export function createShortUnifiedReadState(): ShortUnifiedReadState {
  return { fullyRead: new Map(), partialRanges: new Map() };
}

function recordPartialRange(
  state: ShortUnifiedReadState,
  documentId: string,
  revision: string,
  range: [number, number]
): [number, number][] {
  const previous = state.partialRanges.get(documentId);
  const ranges = [
    ...(previous?.revision === revision ? previous.ranges : []),
    range
  ].sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const [start, end] of ranges) {
    const last = merged.at(-1);
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  state.partialRanges.set(documentId, { revision, ranges: merged });
  return merged;
}

/** Slices invite answers about the unread middle, so name what is unread. */
function partialCoverageLine(
  ranges: readonly [number, number][],
  total: number,
  english: boolean
): string {
  const read = ranges.reduce((sum, [start, end]) => sum + end - start, 0);
  if (read >= total)
    return english
      ? "Coverage this turn: the whole text has now been read in slices."
      : "本轮覆盖：已分段读完全文。";
  const unread: string[] = [];
  let cursor = 0;
  for (const [start, end] of ranges) {
    if (start > cursor) unread.push(`${cursor}–${start}`);
    cursor = end;
  }
  if (cursor < total) unread.push(`${cursor}–${total}`);
  const percent = Math.round(((total - read) / total) * 100);
  const readText = ranges.map(([start, end]) => `${start}–${end}`);
  return english
    ? `Coverage this turn: read ${readText.join(", ")}; unread ${unread.join(", ")} (about ${percent}%). Answer only from the read ranges; say what is unread instead of describing or inferring it.`
    : `本轮覆盖：已读 ${readText.join("、")}；未读 ${unread.join("、")}（约 ${percent}%）。只能依据已读范围作答，未读部分要说明未读，不要描述或推断。`;
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

function fileMetrics(
  state: ShortWorkspaceToolSharedState,
  file: { documentId: string; content: string; revision: string }
) {
  const metrics = state.coreFiles?.get(file.documentId);
  return metrics?.revision === file.revision
    ? metrics
    : {
        length: file.content.length,
        characters: countWritingContentCharacters(file.content)
      };
}

function readDraftDirectory(
  input: BuildWritingWorkspaceToolsInput,
  state: ShortWorkspaceToolSharedState
): string {
  const sections = orderedExpertSections(input, state.expertSections);
  const bodyCharacters = sections.reduce(
    (total, section) => total + fileMetrics(state, section.body).characters,
    0
  );
  const characterStateCharacters = sections.reduce(
    (total, section) =>
      total + fileMetrics(state, section.characterState).characters,
    0
  );
  return [
    `【${input.workspace.expertDraft.title}】`,
    "kind: draft",
    "id: draft",
    input.promptLocale === "en-US"
      ? `Total body characters: ${bodyCharacters}`
      : `正文总字数：${bodyCharacters} 字`,
    input.promptLocale === "en-US"
      ? `Total State characters: ${characterStateCharacters}`
      : `状态总字数：${characterStateCharacters} 字`,
    "",
    ...sections.map((section, index) =>
      input.promptLocale === "en-US"
        ? `${index + 1}. ${section.title} (id=${section.id}; length target=${section.wordCountRequirement || "not set"}; body characters=${fileMetrics(state, section.body).characters}; State characters=${fileMetrics(state, section.characterState).characters})`
        : `${index + 1}. ${section.title}（id=${section.id}；字数要求=${section.wordCountRequirement || "未设置"}；正文字数=${fileMetrics(state, section.body).characters}；状态字数=${fileMetrics(state, section.characterState).characters}）`
    )
  ].join("\n");
}

function readAllDraftSections(
  input: BuildWritingWorkspaceToolsInput,
  state: ShortWorkspaceToolSharedState,
  readState: ShortUnifiedReadState,
  document: "body" | "state" | "character_state"
): string {
  const fileKind = document === "body" ? "body" : "characterState";
  const sections = orderedExpertSections(input, state.expertSections);
  const totalLength = sections.reduce(
    (total, section) => total + fileMetrics(state, section[fileKind]).length,
    0
  );
  if (totalLength > LARGE_DRAFT_CHARACTER_THRESHOLD) {
    return input.promptLocale === "en-US"
      ? `Full text not returned: ${totalLength} characters including whitespace exceeds 50000. Read individual draft_section ids.\n${readDraftDirectory(input, state)}`
      : `未返回全文：合计 ${totalLength} 字符（含空白），超过 50000 字符。请按 draft_section 的 id 分步读取。\n${readDraftDirectory(input, state)}`;
  }
  for (const section of sections)
    assertWritingDocumentAvailable(input, state, section[fileKind].documentId);
  const parts = sections.map((section, index) => {
    const file = section[fileKind];
    readState.fullyRead.set(file.documentId, {
      content: file.content,
      revision: file.revision
    });
    return [
      `【${index + 1}. ${section.title}｜id=${section.id}｜document=${document}】`,
      writingReadContentCountLine(file.content, false, input.promptLocale),
      file.content ||
        (input.promptLocale === "en-US" ? "(empty)" : "（正文为空）")
    ].join("\n");
  });
  const totalCharacters = sections.reduce(
    (total, section) =>
      total + countWritingContentCharacters(section[fileKind].content),
    0
  );
  return [
    input.promptLocale === "en-US"
      ? `[${input.workspace.expertDraft.title} | all ${document === "body" ? "body" : "State"}]`
      : `【${input.workspace.expertDraft.title}｜全部${document === "body" ? "正文" : "状态"}】`,
    `sections: ${sections.length}`,
    `total_characters: ${totalCharacters}`,
    input.promptLocale === "en-US"
      ? `Total characters: ${totalCharacters}`
      : `合计字数：${totalCharacters} 字`,
    "",
    ...parts
  ].join("\n\n");
}

export function buildShortUnifiedReadTool(
  input: BuildWritingWorkspaceToolsInput,
  sharedState: ShortWorkspaceToolSharedState,
  readState: ShortUnifiedReadState
): AgentTool {
  const {
    stableWritingIdParameter,
    writingDocumentParameter,
    writingReadKindParameter
  } = writingParameters(input);
  return defineTool({
    name: "read",
    label:
      input.promptLocale === "en-US"
        ? `Read ${workspaceKindLabel(input)} object`
        : `读取${workspaceKindLabel(input)}对象`,
    description:
      (input.promptLocale === "en-US"
        ? "Read by stable kind/id from the directory. workspace/workspace lists current objects; draft/draft lists manuscript files and counts. draft_section requires document=body or state (State). section_scope=all_sections on draft returns all files (default body), but above 50000 characters including whitespace returns only the directory. Single objects above that limit require offset/limit reads, which do not authorize full-text overwrites. Read existing text in full before edits."
        : "按稳定业务 id 一次读全人物概览、人物条目、剧情结构或正文小节，超过 50000 字符（含空白）的对象须用 offset、limit 分段读取，分段读取不授予全文覆盖权限。kind 与 id 必须按目录配对：人物概览用 kind=character_overview、id=character_design；剧情结构用 kind=plot_stage 与目录中原样复制的阶段 id（如 plot_design、plot-stage-8f6f2d36），不能与 character_overview 混用。kind=workspace、id=workspace 获取实时人物、剧情结构和正文小节目录，包含本轮新建对象；不知道目标 id 时先读此目录，不要用人名或标题代替 id。kind=draft_section 必须同时给出 document=body 或 state。kind=draft、id=draft 读取正文目录及各小节的正文、状态字数；再设置 section_scope=all_sections 可一次返回全部小节及合计字数，不传 document 时默认 body。全部正文超过 50000 字符（含空白）时仅返回目录，请分小节读取。修改任何已有正文前必须先 read 完整读取。") +
      (input.workspace.readSource === "core"
        ? input.promptLocale === "en-US"
          ? " Reads use the latest saved files and include pending changes from this run."
          : "读取以最新保存版本为准，并叠加本轮待处理的提案。"
        : "") +
      (input.promptLocale === "en-US"
        ? " Counts exclude whitespace."
        : WRITING_READ_CONTENT_COUNT_DESCRIPTION),
    parameters: Type.Object(
      {
        kind: writingReadKindParameter,
        id: stableWritingIdParameter,
        document: Type.Optional(writingDocumentParameter),
        offset: Type.Optional(
          Type.Integer({
            minimum: 0,
            description:
              input.promptLocale === "en-US"
                ? "Start offset for a single-object slice, in UTF-16 code units, starting at 0."
                : "单对象分段读取的起点，按 UTF-16 字符偏移，从 0 开始。"
          })
        ),
        limit: Type.Optional(
          Type.Integer({
            minimum: 1,
            maximum: 50_000,
            description:
              input.promptLocale === "en-US"
                ? "Slice length, at most 50000 code units. Partial reads do not authorize full-text overwrites."
                : "单对象分段读取的字符数，最多 50000；不授予全文覆盖权限。"
          })
        ),
        section_scope: Type.Optional(
          StringEnum(["directory", "all_sections"] as const, {
            description:
              input.promptLocale === "en-US"
                ? "draft/draft only: directory lists sections (default); all_sections reads their text. document defaults to body; use state for State."
                : "仅 kind=draft、id=draft：directory 返回目录（默认）；all_sections 读取全部小节。不传 document 时默认 body；读取状态须指定 document=state。"
          })
        )
      },
      { additionalProperties: false }
    ),
    execute: async (_toolCallId, params) => {
      assertWritingDocumentAvailable(input, sharedState, "");
      const partial = params.offset !== undefined || params.limit !== undefined;
      if (partial && (params.kind === "workspace" || params.kind === "draft")) {
        throw new Error(
          input.promptLocale === "en-US"
            ? "Directories do not accept offset or limit. Select one object."
            : "目录不接受 offset 或 limit，请指定单个对象。"
        );
      }
      if (params.kind === "workspace") {
        if (String(params.id).trim() !== "workspace") {
          throw new Error(
            input.promptLocale === "en-US"
              ? "The work directory id must be workspace."
              : "作品对象目录的稳定 id 固定为 workspace。"
          );
        }
        if (params.document || params.section_scope === "all_sections") {
          throw new Error(
            input.promptLocale === "en-US"
              ? "The work directory does not accept document or section_scope=all_sections."
              : "作品对象目录不接受 document 或 section_scope=all_sections。"
          );
        }
        return textResult(
          renderWritingWorkspaceDirectory(
            currentWritingWorkspaceNavigation(input.workspace, sharedState),
            input.promptLocale,
            input.workspaceType
          )
        );
      }
      if (params.kind === "draft") {
        if (String(params.id).trim() !== "draft") {
          throw new Error(
            input.promptLocale === "en-US"
              ? "The manuscript directory id must be draft."
              : "正文目录的稳定 id 固定为 draft。"
          );
        }
        if (params.section_scope === "all_sections") {
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
            input.promptLocale === "en-US"
              ? "On the manuscript directory, document requires section_scope=all_sections."
              : "读取正文目录时，document 只与 section_scope=all_sections 一起使用。"
          );
        }
        return textResult(readDraftDirectory(input, sharedState));
      }
      if (params.section_scope === "all_sections") {
        throw new Error(
          input.promptLocale === "en-US"
            ? "section_scope only applies to kind=draft, id=draft."
            : "section_scope 仅用于 kind=draft、id=draft。"
        );
      }
      if (params.kind === "draft_section" && !params.document) {
        throw new Error(
          input.promptLocale === "en-US"
            ? "Reading draft_section requires document=body or state."
            : "读取 draft_section 必须指定 document=body 或 state。"
        );
      }
      const target = resolveShortUnifiedTarget(input, sharedState, {
        kind: params.kind,
        id: String(params.id),
        ...(params.document ? { document: params.document } : {})
      });
      assertWritingDocumentAvailable(input, sharedState, target.documentId);
      const metrics = fileMetrics(sharedState, target);
      if (!partial && metrics.length > LARGE_DRAFT_CHARACTER_THRESHOLD) {
        return textResult(
          input.promptLocale === "en-US"
            ? `Full text not returned: “${target.title}” has ${metrics.length} characters, exceeding 50000. Use offset=0, limit=50000 to read slices; slices do not authorize full-text overwrites.`
            : `未返回全文：《${target.title}》共 ${metrics.length} 字符，超过 50000 字符。请指定 offset=0、limit=50000 分段读取；分段读取不授予全文覆盖权限。`
        );
      }
      const offset = params.offset ?? 0;
      if (offset > metrics.length)
        throw new Error(
          input.promptLocale === "en-US"
            ? "offset exceeds the target length."
            : "offset 超出目标长度。"
        );
      const slicedByCore =
        partial &&
        sharedState.coreFiles?.get(target.documentId)?.revision ===
          target.revision;
      const content =
        partial && !slicedByCore
          ? target.content.slice(offset, offset + (params.limit ?? 50_000))
          : target.content;
      if (!partial && !target.truncated) {
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
          slicedByCore
            ? input.promptLocale === "en-US"
              ? `Current character count: ${metrics.characters}`
              : `当前字数：${metrics.characters} 字`
            : writingReadContentCountLine(
                target.content,
                target.truncated,
                input.promptLocale
              ),
          ...(target.truncated
            ? [
                input.promptLocale === "en-US"
                  ? "Read status: the runtime snapshot is truncated and cannot authorize edits."
                  : "读取状态：运行时快照已截断，不能据此修改目标。"
              ]
            : []),
          "",
          ...(partial
            ? [
                input.promptLocale === "en-US"
                  ? `Read range: ${offset}–${offset + content.length} / ${metrics.length}; ${offset + content.length < metrics.length ? `next_offset=${offset + content.length}` : "end reached"}. Partial reads do not authorize full-text overwrites.`
                  : `读取范围：${offset}–${offset + content.length} / ${metrics.length}；${offset + content.length < metrics.length ? `next_offset=${offset + content.length}` : "已到末尾"}。分段读取不授予全文覆盖权限。`,
                partialCoverageLine(
                  recordPartialRange(
                    readState,
                    target.documentId,
                    target.revision,
                    [offset, offset + content.length]
                  ),
                  metrics.length,
                  input.promptLocale === "en-US"
                )
              ]
            : []),
          content ||
            (input.promptLocale === "en-US" ? "(empty)" : "（正文为空）")
        ].join("\n")
      );
    }
  });
}
