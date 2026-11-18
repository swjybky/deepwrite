import { z } from "zod";
import { EnvelopeBaseSchema } from "./envelope";

export const WRITING_CONTEXT_PATH = "AGENTS.md" as const;
export const WRITING_CONTEXT_MAX_CHARACTERS = 10_000;
export const WritingContextWorkspaceTypeSchema = z.enum([
  "short",
  "script",
  "academic"
]);
export type WritingContextWorkspaceType = z.infer<
  typeof WritingContextWorkspaceTypeSchema
>;

export const DEFAULT_SHORT_WRITING_CONTEXT = `# 短篇上下文

人物、剧情与正文由同一个短篇智能体统一维护，可以跨阶段查阅，但内容必须写回它所属的对象。未读取的正文、剧情或人设不得当成事实；技能是方法，素材是参考，不会自动成为本篇设定。发现冲突时先指出，再用最小改动方案，不要默默覆盖其他阶段已经确认的内容。

## 建设思路

- 建设思路，作者自由定义，可以从人物开始，也可以从剧情某个阶段开始，不做限制与强制要求

## 人物阶段

- 文本样式可维护一份整体人设；条目样式的概览只做姓名、定位和一句话摘要的索引，完整人物卡写入独立条目。
- 完整人物卡至少包含身份与处境，核心欲望、恐惧、缺陷、秘密与底线，遇到选择时的行动逻辑，关系中的利益与情感张力，语言/行为辨识度，以及人物弧起点。
- 不把尚未发生的剧情写成既成事实。人物调整影响剧情时先指出影响，不静默改掉剧情正文。

## 剧情阶段

- 当前作品启用了哪些阶段、它们的顺序和说明，以当前作品目录为准。
- 上层阶段回答故事为何成立，下层阶段把它拆成可执行冲突、选择、场景、信息顺序、转折、伏笔与结局兑现。
- 每层只写该层成品，不把人物卡全文或小说正文抄进剧情稿；发现因果断裂、人物失真或承诺未兑现时明确标注。

## 正文阶段

- 目录依据已确认的剧情结构建立。依据不足且用户没有明确给出时，不猜测整套小节清单。
- 写当前小节前，按需读取相关人物、剧情、相邻正文和上一节状态；延续时间、空间、关系、知情范围、物品、伤势与情绪。
- 正文用行动、选择、对白和可感知细节推进冲突，不复述大纲，不把标题、分析、说明或工具记录写入正文。
- 状态可记录人物、剧情、情感及其他需要延续的信息。例如，记录本节结束时的处境、关系、情绪、已知与隐瞒信息、关键物品、未解决冲突和下一节接续点。它只供连续写作参考，不锁定正文修订。
- 按剧情设计初始化小节目录。需要导语时，将已有导语写入导语小节。
`;

export const DEFAULT_SCRIPT_WRITING_CONTEXT = `# 剧本上下文

本文说明当前剧本各阶段写什么、根据什么来写。人物、剧情与剧本正文由同一个剧本智能体统一维护，可以跨阶段查阅，但内容必须写回它所属的对象。未读取的正文、剧情或人设不得当成事实；技能是方法，素材是参考，不会自动成为本剧本设定。发现冲突时先指出，再用最小改动方案，不要默默覆盖其他阶段已经确认的内容。

## 建设思路
- 阶段及依赖关系由用户定义。按需读取当前阶段依赖的内容。

## 人物阶段

- 文本样式可维护一份整体人设；条目样式的概览只做姓名、定位和一句话摘要的索引，完整人物卡写入独立条目。
- 完整人物卡至少包含身份与处境，欲望、恐惧、缺陷、秘密与底线，选择时的行动逻辑，关系中的利益与情感张力，语言/动作辨识度，以及人物弧起点。
- 人物特征要能通过表演、行为、对白或视听细节呈现。不把尚未发生的剧情写成既成事实。

## 剧情阶段

- 当前作品启用了哪些阶段、它们的顺序和说明，以当前作品目录为准。
- 上层阶段回答命题和主线为何成立，下层阶段把它拆成分集、场景链、节拍、对抗、信息顺序、转折、悬念与兑现。
- 区分故事真相与观众看到的呈现顺序；结构稿写到可执行场景为止，不把成片对白和动作正文抄进去。

## 正文阶段

- 目录依据已确认的剧情结构建立。依据不足且用户没有明确给出时，不猜测整套分集或分场清单。
- 写当前剧集前，按需读取相关人物、剧情、相邻正文和上一集状态；延续时间、空间、关系、知情范围、道具、伤势与情绪。
- 冲突通过可见行动、对白、调度与视听信息推进，不用解释代替画面；正文遵守应用注入的场景标题、动作、对白、OS/VO 与时空转换格式。
- 状态可记录人物、剧情、情感及其他需要延续的信息。例如，记录本集结束时的处境、关系、情绪、已知与隐瞒信息、关键道具、未解决冲突和下一集接续点。它只供连续创作参考，不锁定正文修订。
- 按剧情设计初始化剧集目录，正文可留空。
`;

export const DEFAULT_ACADEMIC_WRITING_CONTEXT = `# 学术写作上下文

本文规定当前学术作品各层写什么、依据什么来写。研究底座、论证框架与正文编写由学术智能体统一维护，按需跨层读取，但内容必须写回所属对象。技能库是方法论，素材库是参考资料；未在「文献与证据卡」或已绑定素材库中核实的题录、DOI 与实验数据，严禁当作既成事实写入正文。

## 总体原则（先给思路、拆解框架、分步写作）

- 遵循「研究立意与核心贡献 → 术语与符号表 / 文献与证据卡 → 论证框架阶段 → 分节写作指引 / 正文 / 节末状态」的分层推进节奏，不在缺少框架与证据边界时直接堆写长篇空泛正文。
- 防幻觉死线：严禁编造文献作者、年份、期刊会议、DOI 或实验数值；缺口处一律输出 \`[待补引用: ...]\` 或 \`[待补数据: ...]\` 显式占位。

## 研究底座

- \`研究立意与核心贡献\`：明确研究问题（RQ）、核心方法或理论主张一句话概括、不超过 3 条可证成的核心贡献，以及目标期刊/会议/学位或读者约束。
- \`术语与符号表\`：维护全文统一的专业术语中英对照、缩写首次展开规范与数学符号定义表，避免跨章节符号漂移。
- \`文献与证据卡\`：每张卡具有作品内唯一的 \`citeKey\`，区分 \`literature\`（核实题录、核心结论、局限与本文关系）与 \`evidence\`（核实实验表、统计口径、案例或史料证据）。

## 论证框架

- 当前作品启用的阶段、顺序与说明以左侧「论证框架」目录为准。
- 框架层只写逻辑脉络、形式化骨架、实验/证据映射矩阵与章节提纲，不提前堆砌正式论文段落。发现前后假设或贡献口径不一致时先指出并收敛。

## 正文编写

- 正文支持单层「节」或「章 → 节」两级结构；每节由 \`写作指引（brief）\`、\`正文（body）\`、\`节末状态（state）\` 三联文档组成。
- 动笔写 \`正文\` 前，先核对本节 \`写作指引\`、\`术语与符号表\`、相关 \`citeKey\` 卡片及相邻小节的 \`节末状态\`。
- 行文保持高信息密度、因果严密、术语一致，去除空洞排比与套话；引用格式与文末 \`参考文献\` 严格遵守当前作品设定的 \`citationStyle\`。
- 完成本节修订后，同步更新 \`节末状态\`（记录本节首次定义的缩写与符号、实际引用的 \`citeKey\`、已兑现论点及对后文的跨节承诺）。
`;

export function writingContextCharacterCount(content: string): number {
  return Array.from(content).length;
}

function refineWritingContext(
  content: string,
  context: z.core.$RefinementCtx<unknown>,
  path: Array<string | number> = ["content"]
): void {
  if (writingContextCharacterCount(content) > WRITING_CONTEXT_MAX_CHARACTERS) {
    context.addIssue({
      code: "custom",
      path,
      message: "Writing context exceeds the maximum character count."
    });
  }
}

const WritingContextBookIdSchema = z.string().trim().min(1).max(512);

export const ReadWritingContextInputSchema = z
  .object({ bookId: WritingContextBookIdSchema })
  .strict();
export type ReadWritingContextInput = z.infer<
  typeof ReadWritingContextInputSchema
>;

export const ReadWritingContextResultSchema = z
  .object({
    bookId: WritingContextBookIdSchema,
    workspaceType: WritingContextWorkspaceTypeSchema,
    content: z.string().max(WRITING_CONTEXT_MAX_CHARACTERS * 2),
    truncated: z.boolean()
  })
  .strict()
  .superRefine((value, context) => {
    refineWritingContext(value.content, context);
  });
export type ReadWritingContextResult = z.infer<
  typeof ReadWritingContextResultSchema
>;

export const WriteWritingContextInputSchema = z
  .object({
    bookId: WritingContextBookIdSchema,
    content: z.string().max(WRITING_CONTEXT_MAX_CHARACTERS * 2)
  })
  .strict()
  .superRefine((value, context) => {
    refineWritingContext(value.content, context);
  });
export type WriteWritingContextInput = z.infer<
  typeof WriteWritingContextInputSchema
>;

export const WriteWritingContextResultSchema = z
  .object({
    bookId: WritingContextBookIdSchema,
    workspaceType: WritingContextWorkspaceTypeSchema
  })
  .strict();
export type WriteWritingContextResult = z.infer<
  typeof WriteWritingContextResultSchema
>;

export const CatalogReadWritingContextCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("catalog.readWritingContext"),
    payload: ReadWritingContextInputSchema
  });

export const CatalogWriteWritingContextCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("catalog.writeWritingContext"),
    payload: WriteWritingContextInputSchema
  });
