import { shortHash } from "./hash";
import {
  composeParts,
  type LongMaterialPlannedEntry,
  type LongMaterialRenderContext
} from "./entry";
import { LONG_MATERIAL_ENTRY_TARGET_CHARACTERS } from "./limits";
import {
  chapterLabel,
  cleanText,
  nestHeadings,
  splitParagraphs
} from "./markdown";
import type { LongMaterialGuideSubmission } from "./guide";
import type { LongMaterialSource } from "./source";

type StyleSource = {
  content: string;
  excerpts: { chapter: number; text: string; comment: string }[];
};

/** 文风画像 and its excerpts, from decomposition records or the guide run. */
export function renderStyle(
  context: LongMaterialRenderContext,
  style: StyleSource,
  enhanced: boolean
): LongMaterialPlannedEntry[] {
  const book = context.bookTitle;
  const prefix = enhanced ? "enhance:" : "";
  const scope = enhanced ? "仿写增强 · 文风分析" : "整书拆解 · 文风分析";
  return [
    ...composeParts(context, {
      key: `${prefix}style`,
      kind: "draft",
      stageId: "draft_excerpt",
      title: "文风画像",
      scope,
      description: (part, count) =>
        `《${book}》文风画像${count > 1 ? `第 ${part + 1}/${count} 篇` : ""}：叙事视角、句式节奏、对白、描写与章末手法；写正文前先读。`,
      sections: [nestHeadings(style.content, 1)]
    }),
    ...(style.excerpts.length
      ? composeParts(context, {
          key: `${prefix}style-excerpts`,
          kind: "draft",
          stageId: "draft_excerpt",
          title: "典型片段与点评",
          scope,
          description: () =>
            `《${book}》典型片段与点评：原文短段落及可迁移的写法说明；体会语感时读，不照抄原句。`,
          sections: style.excerpts.map(
            ({ chapter, text, comment }) =>
              `## 第${chapter}章\n\n> ${cleanText(text).replace(/\n/gu, "\n> ")}\n\n点评：${cleanText(comment)}`
          )
        })
      : [])
  ].map((entry) => (enhanced ? { ...entry, enhanced: true } : entry));
}

export function decompositionStyle(
  source: LongMaterialSource
): StyleSource | undefined {
  const style = source.decomposition?.style;
  return style && cleanText(style.content)
    ? {
        content: style.content,
        excerpts: style.excerpts.map(({ chapterOrder, text, comment }) => ({
          chapter: chapterOrder,
          text,
          comment
        }))
      }
    : undefined;
}

export function guideStyle(
  submission: LongMaterialGuideSubmission
): StyleSource | undefined {
  return submission.style
    ? { content: submission.style.profile, excerpts: submission.style.excerpts }
    : undefined;
}

export function renderSamples(
  context: LongMaterialRenderContext,
  source: LongMaterialSource
): LongMaterialPlannedEntry[] {
  const book = context.bookTitle;
  return source.samples
    .filter(({ body }) => cleanText(body))
    .flatMap((sample) => {
      const label = chapterLabel(sample.number, sample.title);
      const pieces = splitParagraphs(
        sample.body,
        LONG_MATERIAL_ENTRY_TARGET_CHARACTERS
      );
      return composeParts(context, {
        key: `sample:${sample.chapterId}`,
        kind: "draft",
        stageId: "draft_excerpt",
        title: `范文·${label}`,
        scope: `正文 · ${label}`,
        description: (part, count) =>
          `《${book}》${label}原文${count > 1 ? `第 ${part + 1}/${count} 段` : ""}；写正文时用来体会语感与节奏，不复制原句。`,
        sections: pieces
      });
    });
}

export function renderTopics(
  context: LongMaterialRenderContext,
  source: LongMaterialSource,
  kinds: ReadonlySet<string>
): LongMaterialPlannedEntry[] {
  const book = context.bookTitle;
  return (source.decomposition?.topics ?? [])
    .filter(({ kind, content }) => kinds.has(kind) && cleanText(content))
    .flatMap((topic) =>
      composeParts(context, {
        key: `topic:${shortHash(topic.key)}`,
        kind: topic.kind,
        stageId: topic.stageId,
        title: `专题·${topic.title}`,
        scope: `整书拆解专题 · ${topic.title}`,
        description: () =>
          `《${book}》专题「${topic.title}」：整书拆解时整理的专项分析；涉及这一主题时读。`,
        sections: [nestHeadings(topic.content, 1)]
      })
    );
}
