import "./analysis-probe-i18n";
import { createApp, h, nextTick } from "vue";
import { createPinia } from "pinia";
import {
  createEnvelope,
  type DeepWriteApi,
  type ExtrasAgentRunRequest,
  type ModelConfig,
  type StyleComparisonResult,
  type SystemEventEnvelope
} from "@deepwrite/contracts/renderer";
import StyleComparisonPage from "../../src/renderer/src/extras/style-comparison/StyleComparisonPage.vue";
import { thinkingLabel } from "../../src/renderer/src/components/modelSettingsDraft";
import { useStyleComparisonStore } from "../../src/renderer/src/extras/style-comparison/store";
import { DEFAULT_STYLE_COMPARISON_METHOD } from "../../src/renderer/src/extras/style-comparison/method";
import {
  applyAppearanceThemeToDocument,
  defaultAppearanceTheme
} from "../../src/renderer/src/composables/appearanceThemeRuntime";
import "../../src/renderer/src/styles.css";

document.body.style.minWidth = "0";
document.body.style.margin = "0";
const model: ModelConfig = {
  id: "style-probe-model",
  label: "文风验证模型",
  provider: "custom",
  modelId: "invalid-probe-model",
  api: "openai-completions",
  baseUrl: "https://provider.example.test/v1",
  reasoning: false,
  defaultThinkingLevel: "off",
  thinkingLevelOptions: ["low", "medium", "high"],
  temperatureOptions: [0, 0.7, 1],
  contextWindow: 200_000,
  maxTokens: 16_000,
  hasApiKey: false
};
const alternateModel: ModelConfig = {
  ...model,
  id: "style-alternate-model",
  label: "文风验证备用模型",
  reasoning: true
};
const runtime = { provider: "custom", model: "probe", mode: "provider" };
const profile = {
  id: "default",
  name: "文风比对",
  description: "浏览器验证专用方法",
  systemPrompt: DEFAULT_STYLE_COMPARISON_METHOD,
  builtin: true
};
const settings = { agentId: "style-comparison", profiles: [profile] };
const listeners = new Set<(event: SystemEventEnvelope) => void>();
let request: ExtrasAgentRunRequest | undefined;
let runCount = 0;
let abortCount = 0;
const api = {
  extrasAgents: {
    run: async (input: ExtrasAgentRunRequest) => {
      request = input;
      runCount++;
      return {
        sessionId: input.sessionId,
        runId: `style-probe-${runCount}`,
        acceptedAt: new Date().toISOString(),
        runtime
      };
    },
    profiles: {
      list: async () => settings,
      save: async (input: { profiles: typeof settings.profiles }) => {
        settings.profiles = input.profiles;
        return settings;
      },
      reset: async () => settings
    }
  },
  session: {
    abort: async () => {
      abortCount++;
      return {
        sessionId: request?.sessionId,
        runId: `style-probe-${runCount}`,
        abortedAt: new Date().toISOString()
      };
    }
  },
  events: {
    subscribe: (listener: (event: SystemEventEnvelope) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  }
} as unknown as DeepWriteApi;
Object.assign(window, { deepwrite: api });
const pinia = createPinia();
createApp({
  render: () =>
    h(StyleComparisonPage, {
      models: [model, alternateModel],
      preferredModelId: model.id
    })
})
  .use(pinia)
  .mount("#app");
const comparison = useStyleComparisonStore(pinia);
const result: StyleComparisonResult = {
  summary: "两段文字都以短句传递情绪，待比对文本更偏重可观察的动作。",
  dimensions: ["用词", "节奏", "情绪"].map((name) => ({
    name,
    score: 70,
    reason: "参考文本的“雨停了”和待比对文本的“风停了”都用简短表达留出余味。"
  })),
  similarities: ["短句为主，情绪表达较克制。"],
  differences: ["参考文本关注环境，待比对文本更关注动作。"],
  score: 70
};
const frame = async () => {
  await nextTick();
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  );
};
function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
function element<T extends HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector);
  check(found, `缺少元素：${selector}`);
  return found;
}
function button(text: string): HTMLButtonElement {
  const found = [
    ...document.querySelectorAll<HTMLButtonElement>("button")
  ].find((candidate) => candidate.textContent?.trim() === text);
  check(found && !found.disabled, `缺少可用按钮：${text}`);
  return found;
}
function fill(selector: string, value: string): void {
  const input = element<HTMLTextAreaElement>(selector);
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}
function emit(type: string, payload: Record<string, unknown> = {}): void {
  check(request, "必须先通过开始按钮提交分析");
  const event = createEnvelope(
    type,
    {
      sessionId: request.sessionId,
      runId: `style-probe-${runCount}`,
      messageId: "style-probe-message",
      runtime,
      ...payload
    },
    { id: `style-probe-event-${Date.now()}` }
  ) as SystemEventEnvelope;
  listeners.forEach((listener) => listener(event));
}
async function complete(value: StyleComparisonResult): Promise<void> {
  check(request?.task.agentId === "style-comparison", "请求必须为文风比对");
  emit("extras_agent.output_updated", {
    agentId: "style-comparison",
    jobId: request.task.input.jobId,
    output: { kind: "style-comparison-result", result: value }
  });
  emit("agent.message_completed", {
    role: "assistant",
    content: JSON.stringify(value)
  });
  await frame();
}
async function selectHeaderModel(): Promise<void> {
  const trigger = element<HTMLButtonElement>(
    ".analysis-page-header .analysis-model-trigger"
  );
  trigger.click();
  await frame();
  const allTab = document.querySelector<HTMLButtonElement>(
    '.analysis-model-panel .model-picker-rail-btn[aria-label="全部模型"]'
  );
  allTab?.click();
  await frame();
  const modelOption = [
    ...document.querySelectorAll<HTMLElement>(
      '.analysis-model-panel [role="listbox"][aria-label="模型"] [role="option"]'
    )
  ].find((candidate) => candidate.textContent?.trim() === alternateModel.label);
  check(modelOption, `模型配置缺少选项：${alternateModel.label}`);
  modelOption.click();
  await frame();
  const thinkingOption = [
    ...document.querySelectorAll<HTMLElement>(
      '.analysis-model-panel [role="listbox"][aria-label="思考等级"] [role="option"]'
    )
  ].find(
    (candidate) => candidate.textContent?.trim() === thinkingLabel("high")
  );
  check(thinkingOption, `模型配置缺少选项：${thinkingLabel("high")}`);
  thinkingOption.click();
  await frame();
  trigger.click();
  await frame();
  check(!document.querySelector(".analysis-model-panel"), "模型配置可以收起");
  check(
    !document.querySelector(
      '.analysis-content [role="combobox"], .analysis-settings, #style-method'
    ),
    "正文不能保留开始前模型或方法设置"
  );
}
async function run(): Promise<Record<string, unknown>> {
  await frame();
  await selectHeaderModel();
  fill("#style-reference", "雨停了。街上很静。她看了看窗外，又把信收进抽屉。");
  fill("#style-target", "风停了。屋里没有声音。她捏着信角，半晌没松手。");
  await frame();
  button("开始分析").click();
  await frame();
  check(comparison.isBusy && request, "真实开始按钮应启动智能体");
  check(
    request.modelId === alternateModel.id && request.thinkingLevel === "high",
    "真实请求必须使用右上角选择的模型与思考强度"
  );
  check(
    !element<HTMLDetailsElement>(".comparison-materials").open,
    "开始分析后材料应收起，让结果与进度保持可见"
  );
  check(!document.querySelector(":popover-open"), "开始后默认收起执行过程");
  const trigger = element<HTMLButtonElement>(".analysis-status-trigger");
  trigger.click();
  await frame();
  const drawer = element(".analysis-process-drawer:popover-open");
  emit("agent.turn_started", { attempt: 1 });
  emit("tool.call_requested", { toolName: "probe_public_tool" });
  emit("tool.execution_completed", {
    toolName: "probe_public_tool",
    isError: false
  });
  emit("agent.thinking_delta", {
    delta: "PROBE_PRIVATE_REASONING_DO_NOT_RENDER"
  });
  emit("agent.message_delta", { delta: JSON.stringify(result) });
  await frame();
  check(drawer.textContent?.includes("分析工具执行完成"), "过程应展示工具事件");
  check(drawer.textContent?.includes(result.summary), "过程应展示真实公开输出");
  check(
    !document.body.textContent?.includes(
      "PROBE_PRIVATE_REASONING_DO_NOT_RENDER"
    ),
    "内部思考不能出现在界面"
  );
  element<HTMLButtonElement>('[aria-label="关闭执行过程"]').click();
  await frame();
  check(
    comparison.isBusy && document.activeElement === trigger,
    "关闭后继续分析并恢复触发按钮焦点"
  );
  await complete(result);
  check(
    comparison.result?.score === 70 && !comparison.isStale,
    "关闭过程后仍能接收完整结果"
  );
  button("重新分析").click();
  await frame();
  check(
    comparison.isBusy && comparison.isStale && comparison.result.score === 70,
    "重跑时必须保留并标识上次结果"
  );
  emit("agent.error", {
    code: "probe.failure",
    message: "本次验证请求失败，请重新分析。"
  });
  await frame();
  check(
    comparison.status === "error" && comparison.result.score === 70,
    "失败不能覆盖上次完成结果"
  );
  check(
    element(".comparison-result-heading").textContent?.includes(
      "上次完成的分析结果"
    ),
    "界面必须明确标识上次结果"
  );
  button("重新分析").click();
  await frame();
  button("停止分析").click();
  await frame();
  check(
    comparison.status === "stopped" && comparison.isStale && abortCount === 1,
    "真实停止按钮应停止任务并保留旧结果"
  );
  button("重新分析").click();
  await frame();
  emit("agent.turn_started", { attempt: 1 });
  emit("agent.thinking_delta", {
    delta: "PROBE_PRIVATE_REASONING_DO_NOT_RENDER"
  });
  const updated = { ...result, score: 76 };
  emit("agent.message_delta", { delta: JSON.stringify(updated) });
  await complete(updated);
  check(
    comparison.result.score === 76 && !comparison.isStale,
    "本次成功后才替换旧结果"
  );
  return {
    submittedRuns: runCount,
    processOpened: true,
    hiddenThinking: true,
    focusRestored: true,
    retainedOnFailure: true,
    retainedOnStop: true,
    headerModelSelection: true,
    finalScore: comparison.result.score
  };
}
async function show(scheme: "light" | "dark", size: number, process: boolean) {
  applyAppearanceThemeToDocument({
    scheme,
    theme: {
      ...defaultAppearanceTheme(scheme),
      uiFontSize: size,
      accent: "#8a4bc2"
    },
    uiFontFamily: "system",
    editorFontFamily: "song"
  });
  const opened = document.querySelector(
    ".analysis-process-drawer:popover-open"
  );
  if (opened) element<HTMLButtonElement>('[aria-label="关闭执行过程"]').click();
  await frame();
  const page = element(".style-comparison-page");
  page.scrollTop = 0;
  if (process) {
    element<HTMLButtonElement>(".analysis-status-trigger").click();
    await frame();
    const drawer = element(".analysis-process-drawer:popover-open");
    check(drawer.scrollWidth <= drawer.clientWidth + 1, "过程抽屉不能横向溢出");
  }
  await frame();
  check(page.scrollWidth <= page.clientWidth + 1, "页面不能横向溢出");
  const clipped = [
    ...page.querySelectorAll<HTMLElement>("input, textarea")
  ].filter((input) => input.getBoundingClientRect().right > innerWidth + 1);
  check(clipped.length === 0, "输入框不能超出窗口");
  return {
    scheme,
    size,
    process,
    scrollWidth: page.scrollWidth,
    clientWidth: page.clientWidth
  };
}
Object.assign(window, {
  runStyleAnalysisProbe: run,
  showStyleAnalysisProbe: show
});
