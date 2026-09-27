import type { Ref } from "vue";
import type { LongBookAnalysisPhase } from "./analysis-pipeline-types";

export type LongBookAnalysisProcessTone = "info" | "success" | "error";

export interface LongBookAnalysisProcessEntry {
  id: string;
  createdAt: string;
  title: string;
  detail?: string;
  phase: LongBookAnalysisPhase | null;
  tone: LongBookAnalysisProcessTone;
}

export interface LongBookAnalysisProcessState {
  processEntries: Ref<LongBookAnalysisProcessEntry[]>;
  currentActivity: Ref<string>;
  liveOutput: Ref<string>;
}

const PHASE_LABELS: Record<LongBookAnalysisPhase, string> = {
  batch: "分批提炼",
  reduce: "归并笔记",
  final: "生成正式结果"
};

const TOOL_LABELS: Record<string, string> = {
  list_analysis_inputs: "正在核对当前输入清单",
  read_analysis_input: "正在读取章节或分析笔记",
  search_analysis_inputs: "正在搜索章节证据",
  write_analysis_note: "正在保存本阶段分析笔记",
  write_analysis_result: "正在生成可编辑结果"
};

export function analysisPhaseLabel(phase: LongBookAnalysisPhase): string {
  return PHASE_LABELS[phase];
}

export function formatAnalysisProgress(
  phase: LongBookAnalysisPhase | null,
  completedUnits: number,
  estimatedUnits: number
): string {
  if (!phase) return "尚未开始";
  const total = Math.max(1, completedUnits, estimatedUnits);
  return `${analysisPhaseLabel(phase)} · 处理步骤 ${Math.min(completedUnits, total)}/${total}`;
}

export class LongBookAnalysisProcessTracker {
  private sequence = 0;
  private phase: LongBookAnalysisPhase | null = null;

  constructor(private readonly state: LongBookAnalysisProcessState) {}

  reset(): void {
    this.sequence = 0;
    this.phase = null;
    this.state.processEntries.value = [];
    this.state.currentActivity.value = "";
    this.state.liveOutput.value = "";
  }

  start(
    presetName: string,
    selectionStart: number,
    selectionEnd: number,
    batchCount: number
  ): void {
    this.reset();
    this.add(
      `开始执行“${presetName}”预设`,
      `仅运行当前预设 · 第 ${selectionStart}-${selectionEnd} 章 · ${batchCount} 个分析批次`
    );
    this.state.currentActivity.value = "正在准备第一个分析批次";
  }

  beginUnit(phase: LongBookAnalysisPhase, detail: string): void {
    this.phase = phase;
    this.state.liveOutput.value = "";
    this.state.currentActivity.value = analysisPhaseLabel(phase);
    this.add(analysisPhaseLabel(phase), detail);
  }

  retry(): void {
    this.add("继续执行", "从上次停止或失败的步骤继续");
    this.state.currentActivity.value = "正在重新启动当前步骤";
  }

  requestStop(): void {
    this.add("正在停止", "等待当前模型请求安全结束");
    this.state.currentActivity.value = "正在停止";
  }

  thinking(): void {
    this.state.currentActivity.value = "模型正在整理当前阶段";
  }

  appendMessage(delta: string): void {
    const next = `${this.state.liveOutput.value}${delta}`;
    this.state.liveOutput.value = next.slice(-20_000);
    this.state.currentActivity.value = "模型正在输出当前阶段说明";
  }

  completeMessage(content: string): void {
    if (!this.state.liveOutput.value.trim() && content.trim()) {
      this.state.liveOutput.value = content.slice(-20_000);
    }
    this.state.currentActivity.value = "当前模型步骤已完成";
  }

  toolStarted(toolName: string): void {
    const label = TOOL_LABELS[toolName] ?? "正在执行分析工具";
    this.state.currentActivity.value = label;
    this.add(label);
  }

  toolCompleted(toolName: string, isError: boolean): void {
    if (isError) {
      this.add(
        `${TOOL_LABELS[toolName] ?? "分析工具"}失败`,
        "模型将决定是否重试当前动作",
        "error"
      );
    }
  }

  noteWritten(characterCount: number): void {
    this.add(
      "本阶段分析笔记已生成",
      `${characterCount.toLocaleString()} 字符`,
      "success"
    );
  }

  resultWritten(title: string): void {
    this.add("可编辑结果已生成", title, "success");
    this.state.currentActivity.value = "结果已显示，可随时写入资料库";
  }

  complete(): void {
    this.add("当前预设执行完成", "结果已保留在下方预览区", "success");
    this.state.currentActivity.value = "执行完成";
  }

  fail(message: string): void {
    this.add("执行失败", message, "error");
    this.state.currentActivity.value = "执行失败，可从当前步骤重试";
  }

  stopped(): void {
    this.add("执行已停止", "已完成的步骤仍然保留", "info");
    this.state.currentActivity.value = "已停止，可继续";
  }

  /**
   * Parked on the agent process's concurrent-run ceiling. Deliberately not an
   * error tone: the round resumes on its own once a slot frees up.
   */
  capacityPaused(): void {
    this.add("等待并发空闲", "本地智能体并发已满，稍后自动继续", "info");
    this.state.currentActivity.value = "等待并发空闲，稍后自动继续";
  }

  private add(
    title: string,
    detail?: string,
    tone: LongBookAnalysisProcessTone = "info"
  ): void {
    this.sequence += 1;
    const entries = [
      ...this.state.processEntries.value,
      {
        id: `analysis_process_${this.sequence}`,
        createdAt: new Date().toISOString(),
        title,
        ...(detail ? { detail } : {}),
        phase: this.phase,
        tone
      }
    ];
    this.state.processEntries.value = entries.slice(-120);
  }
}
