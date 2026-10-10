import type {
  ExtrasAgentResolvedTaskOf,
  LongBookAnalysisRuntimeContext
} from "@deepwrite/contracts";

function context(
  phase: "batch" | "reduce" | "final"
): LongBookAnalysisRuntimeContext {
  const base = {
    jobId: "job-1",
    unitId: `unit-${phase}`,
    sourceTitle: "测试长篇",
    selectionStart: 1,
    selectionEnd: 2
  };
  if (phase === "batch") {
    return {
      ...base,
      phase,
      segments: [
        {
          id: "segment-1",
          chapterId: "chapter-1",
          chapterOrder: 1,
          chapterTitle: "第一章",
          segmentIndex: 1,
          segmentCount: 1,
          text: "雨夜收到一封信。"
        }
      ]
    };
  }
  return {
    ...base,
    phase,
    notes: [
      {
        id: "note-1",
        label: "第一章笔记",
        chapterStart: 1,
        chapterEnd: 1,
        text: "开篇以延迟信息制造悬念。"
      },
      {
        id: "note-2",
        label: "第二章笔记",
        chapterStart: 2,
        chapterEnd: 2,
        text: "人物选择推动下一轮压力。"
      }
    ]
  };
}

export function longBookAnalysisTask(
  phase: "batch" | "reduce" | "final"
): ExtrasAgentResolvedTaskOf<"long-book-analysis"> {
  return {
    agentId: "long-book-analysis",
    profile: {
      id: "plot-structure",
      name: "剧情结构",
      description: "拆解剧情结构。",
      systemPrompt: "依据章节证据提炼剧情结构。",
      output: { domain: "material", kind: "plot", stageId: "pacing" }
    },
    input: context(phase)
  };
}
