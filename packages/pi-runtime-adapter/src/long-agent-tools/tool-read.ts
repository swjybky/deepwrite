import { createHash } from "node:crypto";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { StringEnum, Type } from "@earendil-works/pi-ai";
import { defineTool, textResult } from "./shared";
import {
  chapterContextIdParameter,
  documentParameter,
  entityIdParameter,
  strictObject
} from "./schemas";
import { LONG_STAGE_ROOTS } from "./entity-registry";
import { longEntityMeta } from "./entity-records";
import { resolveLongTarget } from "./target";
import type { LongToolContext } from "./context";
import {
  writingReadContentCountLine,
  WRITING_READ_CONTENT_COUNT_DESCRIPTION
} from "../writing-content-counts";

const continuityProposalSource =
  "内容来自本轮连续性归档提案。归档结果以账本状态为准。";

function metaLines(meta: Record<string, unknown>): string[] {
  return Object.entries(meta).flatMap(([key, value]) => {
    if (value === undefined || value === "" || value === null) return [];
    const text = Array.isArray(value) ? value.join("、") : String(value);
    return text ? [`${key}: ${text}`] : [];
  });
}

export function buildReadTool(ctx: LongToolContext): AgentTool {
  return defineTool({
    name: "read",
    label: "读取对象正文",
    description:
      "按稳定业务 id 读取正文与精简信息；人物和章卡须给 document。默认全文；range=head|tail 只读开头或结尾，max_chars 默认2000、上限8000，单独传入时默认 range=head，不授予编辑凭据。人物 current_state/history 默认映射最新账本，可用 chapter_id 指定章。全文未变且仍在上下文时返回重复读取提示；修改已有正文前必须完整读取。" +
      WRITING_READ_CONTENT_COUNT_DESCRIPTION,
    parameters: strictObject({
      id: entityIdParameter,
      document: Type.Optional(documentParameter),
      chapter_id: Type.Optional(chapterContextIdParameter),
      range: Type.Optional(StringEnum(["head", "tail"] as const)),
      max_chars: Type.Optional(
        Type.Number({
          description:
            "读取片段字符数，整数1–8000，默认2000；单独传入时按 range=head 读取。"
        })
      )
    }),
    execute: async (toolCallId, rawParams, signal) => {
      const params = { ...rawParams };
      const normalized: string[] = [];
      if (params.max_chars !== undefined && !params.range) {
        params.range = "head";
        normalized.push("单独 max_chars 按 range=head 读取片段");
      }
      if (params.id.startsWith("chapter_") && params.chapter_id !== undefined) {
        if (params.chapter_id !== params.id)
          throw new Error(
            `章节定位冲突：id=${params.id} 与 chapter_id=${params.chapter_id} 不同。读取章节请仅传 id 和 document；例如 read(id="${params.id}", document="${params.document ?? "body"}")。`
          );
        delete params.chapter_id;
        normalized.push("移除与章节 id 相同的重复 chapter_id");
      }
      const result = (text: string) =>
        textResult(
          (normalized.length
            ? `【参数归一化】${normalized.join("；")}\n`
            : "") + text
        );
      const maximum = params.max_chars ?? 2_000;
      if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 8_000)
        throw new Error("max_chars 必须是1–8000的整数。");
      const index = await ctx.reloadIndex(signal);
      const target = resolveLongTarget(index, {
        id: params.id,
        ...(params.document ? { document: params.document } : {}),
        ...(params.chapter_id ? { chapter_id: params.chapter_id } : {})
      });
      if (!ctx.readableRoots.has(LONG_STAGE_ROOTS[target.stage]))
        throw new Error(`当前智能体无权读取 ${target.stage} 阶段。`);
      const character = index.characters.find(({ id }) => id === params.id);
      const meta =
        target.addressing === "field"
          ? metaLines(longEntityMeta(target.record))
          : character
            ? metaLines({
                name: character.name,
                aliases: character.aliases,
                type_id: character.group
              })
            : [];
      const id =
        target.addressing === "field"
          ? target.id
          : (target.publicId ?? target.id);
      const document =
        target.addressing === "field"
          ? undefined
          : (target.publicDocument ?? target.document);
      const header = `${target.title}（${id}${document ? `／${document}` : ""}）`;
      let content: string;
      let key: string;
      let source: string | undefined;
      if (target.addressing === "field") {
        content = target.content;
        key = `record:${target.id}`;
        if (!params.range) ctx.fullyReadRecords.set(target.id, content);
      } else if (target.inlineContent !== undefined) {
        content = target.inlineContent;
        key = `inline:${id}/${document ?? ""}@${params.chapter_id ?? ""}`;
      } else if (params.range) {
        const excerpt = await ctx.readDocumentRange(
          target.file,
          params.range,
          maximum,
          signal
        );
        content = excerpt.content;
        return result(
          [
            "片段，修改前须完整读取。",
            header,
            ...meta,
            ...(excerpt.fromContinuityProposal
              ? [continuityProposalSource]
              : []),
            writingReadContentCountLine(content),
            "",
            content || "（正文为空）"
          ].join("\n")
        );
      } else {
        const live = await ctx.readWholeDocument(target.file, signal);
        content = live.content;
        key = `file:${live.file.id}`;
        if (live.fromContinuityProposal) source = continuityProposalSource;
        ctx.fullyReadDocuments.set(live.file.id, live);
      }
      if (params.range) {
        const characters = Array.from(content);
        content = (
          params.range === "head"
            ? characters.slice(0, maximum)
            : characters.slice(-maximum)
        ).join("");
        return result(
          [
            "片段，修改前须完整读取。",
            header,
            ...meta,
            writingReadContentCountLine(content),
            "",
            content || "（正文为空）"
          ].join("\n")
        );
      }
      const text = [
        header,
        ...meta,
        ...(source ? [source] : []),
        writingReadContentCountLine(content),
        "",
        content || "（正文为空）"
      ].join("\n");
      const fingerprint = createHash("sha256").update(text).digest("hex");
      if (ctx.retainedReads.get(key)?.fingerprint === fingerprint)
        return result(
          [
            header,
            ...(source ? [source] : []),
            "该文档自上次读取后未变化，原文仍在上文。"
          ].join("\n")
        );
      ctx.retainedReads.set(key, { fingerprint, toolCallId });
      return result(
        text +
          (Array.from(content).length > 8_000
            ? "\n\n本文较长；只需结尾或片段时可用 range / search。"
            : "")
      );
    }
  });
}
