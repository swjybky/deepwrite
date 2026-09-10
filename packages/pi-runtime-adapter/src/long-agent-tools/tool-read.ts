import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
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

function metaLines(meta: Record<string, unknown>): string[] {
  return Object.entries(meta).flatMap(([key, value]) => {
    if (value === undefined || value === "" || value === null) return [];
    const text = Array.isArray(value) ? value.join("、") : String(value);
    return text ? [`${key}: ${text}`] : [];
  });
}

export function buildReadTool(ctx: LongToolContext): AgentTool {
  const {
    readableRoots,
    loadIndex,
    readWholeDocument,
    fullyReadDocuments,
    fullyReadRecords
  } = ctx;
  return defineTool({
    name: "read",
    label: "读取对象正文",
    description:
      "按稳定业务 id 一次读全目标的正文与精简信息，没有预览模式。人物和章卡必须同时给出 document。人物 current_state/history 默认映射最新已提交账本；可传 chapter_id 精确读取指定章。修改任何已有正文之前必须先用本工具完整读取。",
    parameters: strictObject({
      id: entityIdParameter,
      document: Type.Optional(documentParameter),
      chapter_id: Type.Optional(chapterContextIdParameter)
    }),
    execute: async (_toolCallId, params, signal) => {
      const index = await loadIndex(signal);
      const target = resolveLongTarget(index, {
        id: params.id,
        ...(params.document ? { document: params.document } : {}),
        ...(params.chapter_id ? { chapter_id: params.chapter_id } : {})
      });
      if (!readableRoots.has(LONG_STAGE_ROOTS[target.stage])) {
        throw new Error(`当前智能体无权读取 ${target.stage} 阶段。`);
      }

      if (target.addressing === "field") {
        fullyReadRecords.set(target.id, target.content);
        return textResult(
          [
            `${target.title}（${target.id}）`,
            ...metaLines(longEntityMeta(target.record)),
            "",
            target.content || "（正文为空）"
          ].join("\n")
        );
      }

      const character = index.characters.find((item) => item.id === params.id);
      const characterMeta = character
        ? metaLines({
            name: character.name,
            aliases: character.aliases,
            type_id: character.group
          })
        : [];
      if (target.inlineContent !== undefined) {
        const publicId = target.publicId ?? target.id;
        const publicDocument = target.publicDocument ?? target.document;
        return textResult(
          [
            `${target.title}（${publicId}${
              publicDocument ? `／${publicDocument}` : ""
            }）`,
            ...characterMeta,
            "",
            target.inlineContent || "（正文为空）"
          ].join("\n")
        );
      }
      const live = await readWholeDocument(target.file, signal);
      fullyReadDocuments.set(live.file.id, {
        content: live.content,
        file: live.file
      });
      const publicId = target.publicId ?? target.id;
      const publicDocument = target.publicDocument ?? target.document;
      return textResult(
        [
          `${target.title}（${publicId}${
            publicDocument ? `／${publicDocument}` : ""
          }）`,
          ...characterMeta,
          "",
          live.content || "（正文为空）"
        ].join("\n")
      );
    }
  });
}
