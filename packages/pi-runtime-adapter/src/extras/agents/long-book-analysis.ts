import {
  fauxAssistantMessage,
  fauxText,
  fauxToolCall
} from "@earendil-works/pi-ai";
import type { LongBookAnalysisRuntimeContext } from "@deepwrite/contracts";
import type { ExtrasTaskAgentDefinition } from "../definition";
import {
  buildAnalysisInputTools,
  type AnalysisInputItem
} from "../tools/analysis-inputs";
import {
  buildAnalysisNoteTool,
  buildAnalysisResultTool
} from "../tools/analysis-results";

const PHASE_INSTRUCTIONS: Record<
  LongBookAnalysisRuntimeContext["phase"],
  string
> = {
  batch: "分析当前章节批次并写入结构化中间笔记。",
  reduce: "归并当前全部中间笔记并写入压缩后的结构化笔记。",
  final: "根据全部归并笔记生成正式 Markdown 拆书结果。"
};

function phaseRequirements(context: LongBookAnalysisRuntimeContext): string[] {
  if (context.phase === "batch") {
    return [
      "当前是分批分析阶段。",
      "先调用 list_analysis_inputs，再通过 read_analysis_input 尽量读完所有章节片段；需要定位时可使用 search_analysis_inputs。",
      "完成后必须通过 write_analysis_note 成功提交一份结构化、去重、带章节范围依据的中间笔记；调用失败时按错误修正参数后重交。",
      "本阶段不要生成正式素材或技能，不要调用未列出的工具。"
    ];
  }
  if (context.phase === "reduce") {
    return [
      "当前是中间笔记归并阶段。",
      "必须读取全部输入笔记，合并相同结论、保留差异和章节证据，并压缩重复内容。",
      "完成后必须通过 write_analysis_note 成功提交一份紧凑笔记；调用失败时按错误修正参数后重交。不要生成正式素材或技能。"
    ];
  }
  return [
    "当前是最终结果生成阶段。",
    "必须读取全部归并笔记，严格按照预设目标生成一份完整 Markdown 结果。",
    "完成后必须通过 write_analysis_result 成功提交一份结果；调用失败时按错误修正参数后重交。参数为 name（名称）、description（用途与适用场景）、content（完整 Markdown 正文，无需说明头部）。该工具只写预览区，不能声称已经正式落库。"
  ];
}

function analysisInputs(
  context: LongBookAnalysisRuntimeContext
): AnalysisInputItem[] {
  if (context.phase === "batch") {
    return context.segments.map((segment) => ({
      id: segment.id,
      label: `${segment.chapterOrder}. ${segment.chapterTitle}${segment.segmentCount > 1 ? `（片段 ${segment.segmentIndex}/${segment.segmentCount}）` : ""}`,
      text: segment.text,
      range: `第 ${segment.chapterOrder} 章`
    }));
  }
  return context.notes.map((note) => ({
    id: note.id,
    label: note.label,
    text: note.text,
    range: `第 ${note.chapterStart}-${note.chapterEnd} 章`
  }));
}

function fauxToolStep(
  context: LongBookAnalysisRuntimeContext,
  profileName: string,
  runId: string
) {
  const range = `第 ${context.selectionStart}-${context.selectionEnd} 章`;
  if (context.phase === "final") {
    return fauxToolCall(
      "write_analysis_result",
      {
        name: `${profileName}｜${range}`,
        description: "根据作品证据提炼可复用的写作方法与适用场景。",
        content: [
          `# ${profileName}`,
          "",
          `> 分析范围：${range}`,
          "",
          "## 核心发现",
          "",
          "- 这是 Faux Runtime 生成的端到端验证结果；真实模型会依据分批笔记填充完整证据、结构与可复用模板。",
          "",
          "## 执行模板",
          "",
          "1. 识别章节目标与阻力。",
          "2. 标记转折、兑现与结尾钩子。",
          "3. 将重复规律整理成可迁移检查清单。"
        ].join("\n")
      },
      { id: `${runId}-analysis-result` }
    );
  }
  return fauxToolCall(
    "write_analysis_note",
    {
      text: [
        `范围：${range}。`,
        `阶段：${context.phase === "batch" ? "章节分批提炼" : "中间笔记归并"}。`,
        "Faux 验证笔记：已保留章节范围、关键结构标签与递归归并所需的摘要边界。"
      ].join("\n")
    },
    { id: `${runId}-analysis-note` }
  );
}

export const longBookAnalysisAgent: ExtrasTaskAgentDefinition<"long-book-analysis"> =
  {
    id: "long-book-analysis",
    boundaryTitle: "长篇拆书",
    boundary: (task) => [
      `来源：${task.input.sourceTitle}`,
      `选择范围：第 ${task.input.selectionStart}-${task.input.selectionEnd} 章`,
      `预设：${task.profile.name}`,
      ...phaseRequirements(task.input),
      "当前阶段的分析正文直接放入提交工具参数，不要先在普通回复中重复输出；分批和归并阶段只提交紧凑笔记，不提前展开最终交付框架。",
      "只能读取本轮工具实际提供的内容；不得访问文件、网络、Shell、其它会话或资料库。",
      "只能使用本轮列出的章节或中间笔记 list/read/search 工具，以及当前阶段唯一允许的 write_analysis_note 或 write_analysis_result。写入工具只更新本次任务的内存笔记或结果预览，不会修改源文件，也不会直接写入资料库。"
    ],
    userMessage: ({ input }) =>
      [
        `拆书阶段: ${input.phase}；选择范围: 第 ${input.selectionStart}-${input.selectionEnd} 章`,
        "当前资源: 长篇拆书输入（章节正文或中间笔记请通过工具按需读取）",
        "",
        PHASE_INSTRUCTIONS[input.phase]
      ].join("\n"),
    requiredOutputTool: ({ input }) =>
      input.phase === "final" ? "write_analysis_result" : "write_analysis_note",
    tools: ({ input }) => {
      const target = {
        agentId: "long-book-analysis" as const,
        jobId: input.jobId
      };
      return [
        ...buildAnalysisInputTools(analysisInputs(input)),
        input.phase === "final"
          ? buildAnalysisResultTool({
              target,
              unitId: input.unitId,
              label: "写入长篇拆书结果",
              description:
                "提交 name 名称、description 使用说明和 content 完整 Markdown 正文到可编辑预览区。正文无需包含说明头部，保存到素材库或技能库时自动生成 name / description 头部。只更新预览，不会直接写入资料库。",
              completionMessage: "已写入长篇拆书结果预览，等待用户确认落库。",
              singleSubmission: false
            })
          : buildAnalysisNoteTool(target, input.unitId)
      ];
    },
    faux: (task, runId) => [
      fauxAssistantMessage(fauxToolStep(task.input, task.profile.name, runId), {
        stopReason: "toolUse"
      }),
      fauxAssistantMessage(fauxText("当前长篇拆书阶段已完成。"))
    ]
  };
