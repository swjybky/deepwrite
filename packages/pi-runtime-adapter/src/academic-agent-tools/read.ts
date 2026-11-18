import {
  ACADEMIC_SECTION_FILE_KINDS,
  ACADEMIC_TERMINOLOGY_DOCUMENT_ID,
  ACADEMIC_THESIS_OVERVIEW_DOCUMENT_ID,
  type AcademicSectionFileKind
} from "@deepwrite/contracts";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import { renderAcademicWorkspaceDirectory } from "../prompts-academic-rules";
import { literalUnion } from "../short-agent-tools/schema";
import { writingReadContentCountLine } from "../writing-content-counts";
import {
  academicTextResult,
  currentAcademicWorkspaceContext,
  defineAcademicTool,
  ensureAcademicOverlayFileLoaded,
  recordAcademicFullRead,
  syncAcademicSharedStateFromCore,
  type AcademicOverlayCard,
  type AcademicOverlayFile,
  type AcademicReadState,
  type AcademicWorkspaceToolSharedState,
  type BuildAcademicWorkspaceToolsInput
} from "./shared";

const LARGE_FILE_CHARACTER_THRESHOLD = 50_000;

export const ACADEMIC_READ_KINDS = [
  "workspace",
  "foundation",
  "reference_card",
  "framework_stage",
  "chapter",
  "section"
] as const;

export function findAcademicCardByIdOrCiteKey(
  state: AcademicWorkspaceToolSharedState,
  rawId: string
): AcademicOverlayCard | undefined {
  const needle = rawId.trim();
  const direct = state.cards.get(needle);
  if (direct) return direct;
  const lower = needle.toLowerCase();
  for (const id of state.cardOrder) {
    const card = state.cards.get(id);
    if (card && card.citeKey.toLowerCase() === lower) {
      return card;
    }
  }
  return undefined;
}

export function buildAcademicReadTool(
  input: BuildAcademicWorkspaceToolsInput,
  sharedState: AcademicWorkspaceToolSharedState,
  readState: AcademicReadState
): AgentTool {
  const english = input.promptLocale === "en-US";
  return defineAcademicTool({
    name: "read",
    label: english ? "Read academic object" : "读取学术作品对象",
    description: english
      ? "Read academic work objects by stable kind and id. kind=workspace returns the live directory. kind=foundation reads thesis_overview or terminology. kind=reference_card reads by card id or citeKey. kind=framework_stage reads by stage id. kind=chapter lists sections in a chapter. kind=section reads document=brief | body | state. Full reads grant overwrite credentials; head/tail/offset/limit preview slices without granting overwrite credentials."
      : "按稳定 kind 与 id 读取学术作品对象。kind=workspace 返回实时目录（含本轮新建临时对象）；kind=foundation 读取 thesis_overview 或 terminology；kind=reference_card 支持传卡片 id 或 citeKey；kind=framework_stage 读取论证框架阶段；kind=chapter 列出该章下的小节目录；kind=section 读取小节（须指定 document=brief | body | state）。不带 head/tail/offset/limit 的全文读取授予全文覆盖凭证；带分段或预览参数不授予覆盖凭证。",
    parameters: Type.Object({
      kind: literalUnion(ACADEMIC_READ_KINDS, {
        description: english
          ? "Target object kind."
          : "目标类型：workspace、foundation、reference_card、framework_stage、chapter 或 section。"
      }),
      id: Type.Optional(
        Type.String({
          description: english
            ? "Stable object id (or citeKey for reference_card; workspace for kind=workspace)."
            : "稳定业务 id（reference_card 支持传 citeKey；workspace 可省略或传 workspace）。"
        })
      ),
      document: Type.Optional(
        literalUnion(ACADEMIC_SECTION_FILE_KINDS, {
          description: english
            ? "Required when kind=section: brief, body, or state."
            : "仅 kind=section 时使用：brief（本节写作要旨）、body（正文）或 state（本节论证状态）。"
        })
      ),
      head: Type.Optional(
        Type.Integer({
          description: english
            ? "Preview only the first N characters (1–50000). Does not grant full-overwrite credential."
            : "仅预览开头前 N 个字符（1–50000）；不授予全文覆盖凭证。"
        })
      ),
      tail: Type.Optional(
        Type.Integer({
          description: english
            ? "Preview only the last N characters (1–50000). Does not grant full-overwrite credential."
            : "仅预览结尾后 N 个字符（1–50000）；不授予全文覆盖凭证。"
        })
      ),
      offset: Type.Optional(
        Type.Integer({
          description: english
            ? "Slice start offset (>= 0). Does not grant full-overwrite credential."
            : "分段读取起始字符偏移（>= 0）；不授予全文覆盖凭证。"
        })
      ),
      limit: Type.Optional(
        Type.Integer({
          description: english
            ? "Slice character count (1–50000). Does not grant full-overwrite credential."
            : "分段读取字符数（1–50000）；不授予全文覆盖凭证。"
        })
      )
    }),
    execute: async (_toolCallId, params, signal) => {
      await syncAcademicSharedStateFromCore(input, sharedState, signal);

      const isPreview =
        params.head !== undefined ||
        params.tail !== undefined ||
        params.offset !== undefined ||
        params.limit !== undefined;

      if (
        params.head !== undefined &&
        (params.head < 1 || params.head > 50_000)
      ) {
        throw new Error("head：应在 1 到 50000 之间。");
      }
      if (
        params.tail !== undefined &&
        (params.tail < 1 || params.tail > 50_000)
      ) {
        throw new Error("tail：应在 1 到 50000 之间。");
      }
      if (params.offset !== undefined && params.offset < 0) {
        throw new Error("offset：不能小于 0。");
      }
      if (
        params.limit !== undefined &&
        (params.limit < 1 || params.limit > 50_000)
      ) {
        throw new Error("limit：应在 1 到 50000 之间。");
      }
      if (params.head !== undefined && params.tail !== undefined) {
        throw new Error("head 与 tail 不能同时传入，请择一使用。");
      }
      if (
        (params.head !== undefined || params.tail !== undefined) &&
        (params.offset !== undefined || params.limit !== undefined)
      ) {
        throw new Error("head/tail 预览与 offset/limit 分段不能同时传入。");
      }

      if (params.kind === "workspace") {
        if (isPreview) {
          throw new Error(
            english
              ? "kind=workspace directory does not accept head/tail/offset/limit."
              : "kind=workspace 目录不接受 head/tail/offset/limit 分段参数。"
          );
        }
        return academicTextResult(
          renderAcademicWorkspaceDirectory(
            currentAcademicWorkspaceContext(input.workspace, sharedState),
            input.promptLocale
          )
        );
      }

      const rawId = (params.id ?? "").trim();

      if (params.kind === "chapter") {
        if (!rawId) {
          throw new Error(
            english
              ? "id: chapter id is required."
              : "id：读取 chapter 须提供章 id。"
          );
        }
        const chapter = sharedState.chapters.get(rawId);
        if (!chapter) {
          throw new Error(
            english
              ? `Chapter not found: ${rawId}`
              : `未找到章（id=${rawId}），请先用 read(kind="workspace") 核对目录。`
          );
        }
        const sections = sharedState.sectionOrder
          .map((sectionId) => sharedState.sections.get(sectionId))
          .filter((section): section is NonNullable<typeof section> =>
            Boolean(section && section.chapterId === chapter.id)
          );
        return academicTextResult(
          [
            `【${chapter.title}】`,
            `kind: chapter`,
            `id: ${chapter.id}`,
            `sections: ${sections.length}`,
            "",
            ...(sections.length
              ? sections.map(
                  (section, index) =>
                    `${index + 1}. ${section.title}（id=${section.id}；字数要求=${section.wordCountRequirement || "未设置"}；brief=${section.brief.characters}；body=${section.body.characters}；state=${section.state.characters}）`
                )
              : [
                  english
                    ? "(no sections in this chapter)"
                    : "（本章下暂无小节）"
                ])
          ].join("\n")
        );
      }

      let file: AcademicOverlayFile;
      let resolvedId: string;
      let extraHeaders: string[] = [];

      if (params.kind === "foundation") {
        const targetId =
          rawId ||
          (input.workspace.activeTarget?.kind === "thesis_overview" ||
          input.workspace.activeTarget?.kind === "terminology"
            ? input.workspace.activeTarget.targetId
            : "");
        if (targetId === ACADEMIC_THESIS_OVERVIEW_DOCUMENT_ID) {
          file = sharedState.thesisOverview;
          resolvedId = ACADEMIC_THESIS_OVERVIEW_DOCUMENT_ID;
        } else if (targetId === ACADEMIC_TERMINOLOGY_DOCUMENT_ID) {
          file = sharedState.terminology;
          resolvedId = ACADEMIC_TERMINOLOGY_DOCUMENT_ID;
        } else {
          throw new Error(
            english
              ? `Invalid foundation id "${rawId}". Expected thesis_overview or terminology.`
              : `foundation 的 id 须为 thesis_overview 或 terminology（当前收到：${rawId || "空"}）。`
          );
        }
      } else if (params.kind === "reference_card") {
        if (!rawId) {
          throw new Error(
            english
              ? "id: provide card id or citeKey for reference_card."
              : "id：读取 reference_card 须提供卡片 id 或 citeKey。"
          );
        }
        const card = findAcademicCardByIdOrCiteKey(sharedState, rawId);
        if (!card) {
          throw new Error(
            english
              ? `Reference card not found: ${rawId}`
              : `未找到文献/证据卡（${rawId}），请用 read(kind="workspace") 或 search 核对。`
          );
        }
        file = card.file;
        resolvedId = card.id;
        extraHeaders = [
          `citeKey: ${card.citeKey}`,
          `cardType: ${card.cardType}`
        ];
      } else if (params.kind === "framework_stage") {
        const stageId =
          rawId ||
          (input.workspace.activeTarget?.kind === "framework_stage"
            ? input.workspace.activeTarget.targetId
            : "");
        const stage = sharedState.frameworkStages.get(stageId);
        if (!stage) {
          throw new Error(
            english
              ? `Framework stage not found: ${stageId || "(empty)"}`
              : `未找到论证框架阶段（${stageId || "空"}），请核对目录中的 stage id。`
          );
        }
        file = stage.file;
        resolvedId = stage.id;
        extraHeaders = [
          `enabled: ${stage.enabled}`,
          `description: ${stage.description}`
        ];
      } else {
        const sectionId =
          rawId ||
          (input.workspace.activeTarget?.kind === "section"
            ? input.workspace.activeTarget.targetId
            : "");
        if (!sectionId) {
          throw new Error(
            english
              ? "id: section id is required when no active section is selected."
              : "id：当前未打开具体小节，读取 section 须显式提供小节 id。"
          );
        }
        const section = sharedState.sections.get(sectionId);
        if (!section) {
          throw new Error(
            english
              ? `Section not found: ${sectionId}`
              : `未找到正文小节（id=${sectionId}），请先用 read(kind="workspace") 核对目录。`
          );
        }
        const docKind: AcademicSectionFileKind | undefined = params.document;
        if (!docKind) {
          throw new Error(
            english
              ? "document: reading section requires document=brief, body, or state."
              : "document：读取 section 必须指定 document=brief、body 或 state。"
          );
        }
        file = section[docKind];
        resolvedId = section.id;
        extraHeaders = [
          `document: ${docKind}`,
          ...(section.chapterId ? [`chapterId: ${section.chapterId}`] : []),
          `wordCountRequirement: ${section.wordCountRequirement || (english ? "unset" : "未设置")}`
        ];
      }

      if (
        !file.loaded &&
        !isPreview &&
        file.length > LARGE_FILE_CHARACTER_THRESHOLD
      ) {
        return academicTextResult(
          english
            ? `Full text not returned: "${file.title}" has ${file.length} characters (> 50000). Use offset=0, limit=50000 (or head/tail) to read slices; partial reads do not grant full-overwrite credentials.`
            : `未返回全文：《${file.title}》共 ${file.length} 字符（超过 50000 字符上限）。请使用 offset=0、limit=50000 或 head/tail 分段读取；分段读取不授予全文覆盖凭证。`
        );
      }

      const loaded = await ensureAcademicOverlayFileLoaded(input, file, signal);
      if (
        !isPreview &&
        loaded.content.length > LARGE_FILE_CHARACTER_THRESHOLD
      ) {
        return academicTextResult(
          english
            ? `Full text not returned: "${loaded.title}" has ${loaded.content.length} characters (> 50000). Use offset=0, limit=50000 (or head/tail) to read slices; partial reads do not grant full-overwrite credentials.`
            : `未返回全文：《${loaded.title}》共 ${loaded.content.length} 字符（超过 50000 字符上限）。请使用 offset=0、limit=50000 或 head/tail 分段读取；分段读取不授予全文覆盖凭证。`
        );
      }

      let sliceStart = 0;
      let sliceEnd = loaded.content.length;
      if (params.head !== undefined) {
        sliceStart = 0;
        sliceEnd = Math.min(loaded.content.length, params.head);
      } else if (params.tail !== undefined) {
        sliceStart = Math.max(0, loaded.content.length - params.tail);
        sliceEnd = loaded.content.length;
      } else if (params.offset !== undefined || params.limit !== undefined) {
        sliceStart = params.offset ?? 0;
        if (sliceStart > loaded.content.length) {
          throw new Error(
            english
              ? "offset exceeds target document length."
              : "offset 超出目标文稿长度。"
          );
        }
        sliceEnd = Math.min(
          loaded.content.length,
          sliceStart + (params.limit ?? LARGE_FILE_CHARACTER_THRESHOLD)
        );
      }

      const returnedText = isPreview
        ? loaded.content.slice(sliceStart, sliceEnd)
        : loaded.content;

      if (!isPreview) {
        recordAcademicFullRead(readState, loaded);
      }

      return academicTextResult(
        [
          `【${loaded.title}】`,
          `kind: ${params.kind}`,
          `id: ${resolvedId}`,
          ...extraHeaders,
          writingReadContentCountLine(
            loaded.content,
            false,
            input.promptLocale
          ),
          ...(isPreview
            ? [
                english
                  ? `Preview range: ${sliceStart}–${sliceEnd} / ${loaded.content.length}. Preview/partial reads do NOT grant full-overwrite credentials.`
                  : `预览范围：${sliceStart}–${sliceEnd} / ${loaded.content.length}。预览与分段读取不授予全文覆盖凭证。`
              ]
            : []),
          "",
          returnedText || (english ? "(empty)" : "（正文为空）")
        ].join("\n")
      );
    }
  });
}
