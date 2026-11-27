import "./analysis-probe-i18n";
import { createApp, h, nextTick, ref } from "vue";
import { RevisionAnalysisPage } from "../../src/renderer/src/components/lazyAppComponents";
import WorkspaceFeatureFrame from "../../src/renderer/src/components/WorkspaceFeatureFrame.vue";
import { useRevisionAnalysis } from "../../src/renderer/src/extras/revision-analysis/useRevisionAnalysis";
import { thinkingLabel } from "../../src/renderer/src/components/modelSettingsDraft";
import {
  applyAppearanceThemeToDocument,
  defaultAppearanceTheme
} from "../../src/renderer/src/composables/appearanceThemeRuntime";
import {
  DEFAULT_REVISION_METHOD,
  type DeepWriteApi,
  type ModelConfig,
  type CatalogSnapshot,
  type ExtrasAgentRunRequest,
  type SystemEventEnvelope
} from "@deepwrite/contracts/renderer";
import "../../src/renderer/src/styles.css";
document.body.style.minWidth = "0";
document.body.style.margin = "0";
const model = {
  id: "model",
  label: "验证模型",
  provider: "test",
  modelId: "test",
  api: "openai-completions",
  baseUrl: "https://example.test",
  reasoning: false,
  defaultThinkingLevel: "off",
  thinkingLevelOptions: ["off"],
  contextWindow: 200000,
  maxTokens: 16000
} as ModelConfig;
const alternateModel: ModelConfig = {
  ...model,
  id: "revision-alternate-model",
  label: "修改验证备用模型",
  reasoning: true,
  thinkingLevelOptions: ["low", "high"]
};
const models = [model, alternateModel];
const library = {
  id: "library",
  title: "我的修改技能",
  skillKind: "general",
  skillType: "short",
  overview: "",
  isBuiltin: false,
  entries: [],
  projectRevision: 1,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z"
} as const;
let request: ExtrasAgentRunRequest | undefined;
const saved: unknown[] = [];
const methodSettings = {
  agentId: "revision-analysis",
  profiles: [
    {
      id: "default",
      name: "修改分析",
      description: "从修改前后的正文差异中提炼可复用的修改技能。",
      systemPrompt: DEFAULT_REVISION_METHOD,
      builtin: true
    }
  ]
};
const api = {
  extrasAgents: {
    run: async (input: ExtrasAgentRunRequest) => {
      request = input;
      return {
        sessionId: input.sessionId,
        runId: "probe-run",
        acceptedAt: new Date().toISOString(),
        runtime: { provider: "test", model: "test", mode: "provider" }
      };
    },
    profiles: {
      list: async () => methodSettings,
      save: async () => methodSettings,
      reset: async () => methodSettings
    }
  },
  session: { abort: async () => ({}) },
  catalog: {
    createLibraryEntry: async (input: unknown) => {
      saved.push(input);
      return {};
    }
  }
} as unknown as DeepWriteApi;
const c = useRevisionAnalysis({ api: () => api });
c.setConfiguredModels(models);
const visible = ref(true);
const leftCollapsed = ref(false);
const catalog = ref({ skills: [library] } as unknown as CatalogSnapshot);
createApp({
  render: () =>
    h("div", { class: "desktop-shell is-left-collapsed is-right-collapsed" }, [
      h(
        WorkspaceFeatureFrame,
        {
          class: "long-book-analysis-main-view",
          leftCollapsed: leftCollapsed.value,
          expandButtonClass: "long-book-analysis-expand-sidebar",
          label: "修改分析"
        },
        () =>
          visible.value
            ? h(RevisionAnalysisPage, {
                controller: c,
                models,
                catalogSnapshot: catalog.value
              })
            : h("div", "其他页面，修改分析在后台继续")
      )
    ])
}).mount("#app");
const frame = async () => {
  await nextTick();
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  );
};
function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
function button(text: string) {
  const button = [
    ...document.querySelectorAll<HTMLButtonElement>("button")
  ].find((b) => b.textContent?.trim() === text);
  check(button, `缺少按钮：${text}`);
  return button;
}
function fill(label: string, text: string) {
  const el = document.querySelector<HTMLTextAreaElement>(
    `[aria-label="${label}"]`
  );
  check(el, `缺少输入：${label}`);
  el.value = text;
  el.dispatchEvent(new Event("input", { bubbles: true }));
}
function event(type: string, payload: Record<string, unknown> = {}) {
  check(request, "分析请求应存在");
  c.handleEvent({
    type,
    payload: { sessionId: request.sessionId, runId: "probe-run", ...payload }
  } as SystemEventEnvelope);
}
async function selectHeaderModel() {
  const trigger = document.querySelector<HTMLButtonElement>(
    ".analysis-page-header .analysis-model-trigger"
  );
  check(trigger, "模型配置必须位于右上角页头");
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
  ].find((item) => item.textContent?.trim() === alternateModel.label);
  check(modelOption, `右上角配置缺少选项：${alternateModel.label}`);
  modelOption.click();
  await frame();
  const thinkingOption = [
    ...document.querySelectorAll<HTMLElement>(
      '.analysis-model-panel [role="listbox"][aria-label="思考等级"] [role="option"]'
    )
  ].find((item) => item.textContent?.trim() === thinkingLabel("high"));
  check(thinkingOption, `右上角配置缺少选项：${thinkingLabel("high")}`);
  thinkingOption.click();
  await frame();
  trigger.click();
  await frame();
  check(!document.querySelector(".analysis-model-panel"), "模型配置可以收起");
  check(
    !document.querySelector(
      '.analysis-content [role="combobox"], .analysis-content .analysis-settings'
    ),
    "正文不应保留开始前模型或分析设置"
  );
  check(!document.querySelector(".revision-result"), "生成前不应出现保存设置");
}
async function run() {
  const deadline = Date.now() + 15000;
  while (!document.querySelector('[aria-label="修改前正文"]')) {
    check(Date.now() < deadline, "懒加载页面超时");
    await frame();
  }
  await frame();
  await c.loadSettings();
  await frame();
  await selectHeaderModel();
  fill(
    "修改前正文",
    "雨落在窗上。\n她感到非常悲伤，因为那封信让她想起很久以前的事情。\n她把信收进抽屉。\n夜色深了。"
  );
  fill(
    "修改后正文",
    "雨敲着窗。\n她捏住信角，半晌没松手。\n她把信收进抽屉。\n夜色深了。\n抽屉没有关严。"
  );
  await frame();
  check(!c.changes.value.length, "初始未手动比较差异");
  button("开始分析").click();
  await frame();
  await frame();
  check(c.isBusy.value && c.changes.value.length === 2, "直接开始自动比较差异");
  check(
    request?.modelId === alternateModel.id && request.thinkingLevel === "high",
    "真实分析请求必须跟随右上角模型与思考强度选择"
  );
  check(!document.querySelector(":popover-open"), "开始后过程默认收起");
  const trigger = document.querySelector<HTMLButtonElement>(
    ".analysis-status-trigger"
  )!;
  trigger.click();
  await frame();
  check(
    document.querySelector(".analysis-process-drawer:popover-open"),
    "可以打开过程抽屉"
  );
  document
    .querySelector<HTMLButtonElement>('[aria-label="关闭执行过程"]')!
    .click();
  await frame();
  check(
    c.isBusy.value && document.activeElement === trigger,
    "关闭过程不中止并恢复焦点"
  );
  await c.stop();
  await frame();
  document.querySelector<HTMLElement>(".revision-materials > summary")!.click();
  await frame();
  button("刷新差异").click();
  await frame();
  check(c.changes.value.length === 2, "应有两组差异");
  fill("差异 1 的修改理由", "用动作代替解释，让情绪留白。");
  await frame();
  button("开始分析").click();
  await frame();
  await frame();
  check(c.isBusy.value && request, "点击开始应启动任务");
  check(
    request.task.agentId === "revision-analysis" &&
      request.task.input.changes[0]?.reason === "用动作代替解释，让情绪留白。",
    "理由必须传入任务快照"
  );
  visible.value = false;
  await frame();
  check(c.isBusy.value, "切页不应停止任务");
  event("agent.message_delta", {
    delta:
      "# 修改分析报告\n\n## 修改概览\n从直接解释情绪，转向可观察的动作与有余味的细节。\n\n## 差异 1\n用户明确希望用动作代替解释。修改后通过捏住信角表现情绪，同时压缩直述信息。\n\n## 差异 2\n新增未关严的抽屉。推断：为结尾保留悬念，具体意图尚未说明。\n\n## 修改方向\n优先寻找能承载情绪的动作；只在读者需要补足理解时保留解释。"
  });
  event("extras_agent.output_updated", {
    agentId: "revision-analysis",
    jobId: request.task.input.jobId,
    output: {
      kind: "revision-analysis-result",
      result: {
        report: "",
        title: "以动作承载情绪的修改方法",
        description: "用于修订情绪描写较直白的场景，以符合人物的动作承载情绪。",
        body: "# 以动作承载情绪\n\n## 适用场景\n情绪描写较直白的短篇场景。\n\n## 执行步骤\n1. 找出直接解释情绪的句子。\n2. 选择与当下处境一致的微动作。\n3. 删除动作已经表达的信息。\n\n## 检查清单\n- 动作是否符合人物？\n- 是否保留必要的因果线索？\n- 是否避免所有场景一律删解释？"
      }
    }
  });
  event("agent.message_completed");
  visible.value = true;
  await frame();
  check(c.result.value && !c.isStale.value, "返回页面应显示新结果");
  check(c.result.value.report.includes("差异 1"), "应保留工具调用前输出的报告");
  c.result.value.body += "\n- 保留用户补充的具体限制。";
  // Exercise actual PopupSelect and save button.
  const select = document.querySelector<HTMLButtonElement>(
    '[aria-label="修改分析目标技能库"]'
  );
  check(select, "技能库选择器应存在");
  select.click();
  await frame();
  const option = [
    ...document.querySelectorAll<HTMLElement>('[role="option"]')
  ].find((el) => el.textContent?.includes("我的修改技能"));
  check(option, "技能库选项应存在");
  option.click();
  await frame();
  button("保存到技能库").click();
  await frame();
  check(saved.length === 1, "技能应保存一次");
  check(button("已保存此版技能").disabled, "重复保存应被禁用");
  const nextResult = { ...c.result.value, title: "新的动作修改方法" };
  button("重新分析").click();
  await frame();
  check(
    select.textContent?.includes(library.title),
    "旧结果保留期间不能提前清空目标库"
  );
  check(request.task.agentId === "revision-analysis", "重新分析请求应存在");
  event("extras_agent.output_updated", {
    agentId: "revision-analysis",
    jobId: request.task.input.jobId,
    output: { kind: "revision-analysis-result", result: nextResult }
  });
  event("agent.message_completed");
  await frame();
  check(
    !select.textContent?.includes(library.title) &&
      button("保存到技能库").disabled,
    "新结果成功后必须重新选择保存目标"
  );
  select.click();
  await frame();
  const nextOption = [
    ...document.querySelectorAll<HTMLElement>('[role="option"]')
  ].find((el) => el.textContent?.includes(library.title));
  check(nextOption, "新结果可以选择目标技能库");
  nextOption.click();
  c.result.value!.body += "\n- 本次结果补充。";
  catalog.value = { ...catalog.value, skills: [{ ...library }] };
  await frame();
  check(
    !button("保存到技能库").disabled,
    "编辑当前结果与刷新目录应保留有效目标"
  );
  catalog.value = { ...catalog.value, skills: [] };
  await frame();
  check(button("保存到技能库").disabled, "目标库删除后必须清空失效选择");
  catalog.value = { ...catalog.value, skills: [library] };
  await frame();
  return {
    differenceGroups: c.changes.value.length,
    backgroundCompleted: true,
    editedSkillSaved: saved.length,
    duplicateBlocked: true,
    headerModelSelection: true,
    newResultRequiresDestination: true,
    removedDestinationCleared: true
  };
}
async function scrollProbe(collapsed: boolean, length: number) {
  leftCollapsed.value = collapsed;
  const previousResult = c.result.value;
  check(previousResult, "滚动验证应有可复用的结果夹具");
  if (length === 1) {
    c.clear();
    await frame();
  }
  await c.start();
  await frame();
  check(request?.task.agentId === "revision-analysis", "分析请求应存在");
  event("extras_agent.output_updated", {
    agentId: "revision-analysis",
    jobId: request.task.input.jobId,
    output: {
      kind: "revision-analysis-result",
      result: { ...previousResult, report: "修改报告段落。\n\n".repeat(length) }
    }
  });
  event("agent.message_completed");
  await frame();
  check(c.status.value === "completed", "前台分析应已完成");
  return { collapsed, length, ...inspectScroll() };
}
function inspectScroll() {
  const page = document.querySelector<HTMLElement>(".revision-analysis-page")!;
  const save = button("保存到技能库").getBoundingClientRect();
  return {
    clientHeight: page.clientHeight,
    scrollHeight: page.scrollHeight,
    scrollTop: page.scrollTop,
    top: page.getBoundingClientRect().top,
    bottom: page.getBoundingClientRect().bottom,
    viewportHeight: innerHeight,
    saveTop: save.top,
    saveBottom: save.bottom,
    hostScroll: page.parentElement!.scrollTop,
    shellScroll: page.parentElement!.parentElement!.scrollTop,
    appScroll: document.querySelector("#app")!.scrollTop
  };
}
async function show(
  scheme: "light" | "dark",
  size: number,
  menu: boolean,
  state: string
) {
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
  await frame();
  const page = document.querySelector<HTMLElement>(".revision-analysis-page")!;
  document
    .querySelector<HTMLButtonElement>('[aria-label="关闭执行过程"]')
    ?.click();
  page.scrollTop = 0;
  if (state === "results")
    document
      .querySelector(".revision-result")!
      .scrollIntoView({ block: "start" });
  if (state === "process") {
    document
      .querySelector<HTMLButtonElement>(".analysis-status-trigger")!
      .click();
    await frame();
    const drawer = document.querySelector<HTMLElement>(
      ".analysis-process-drawer:popover-open"
    )!;
    check(
      drawer && drawer.scrollWidth <= drawer.clientWidth + 1,
      "过程抽屉不能横向溢出"
    );
  }
  if (menu) {
    document
      .querySelector<HTMLButtonElement>(".analysis-model-trigger")!
      .click();
  }
  await frame();
  check(page.scrollWidth <= page.clientWidth + 1, "页面不能横向溢出");
  const clipped = [
    ...page.querySelectorAll<HTMLElement>("input, textarea")
  ].filter((el) => el.getBoundingClientRect().right > innerWidth + 1);
  check(clipped.length === 0, "输入框不能超出窗口");
  return {
    scheme,
    size,
    state,
    scrollWidth: page.scrollWidth,
    clientWidth: page.clientWidth
  };
}
Object.assign(window, {
  runRevisionAnalysisProbe: run,
  runRevisionScrollProbe: scrollProbe,
  inspectRevisionScrollProbe: inspectScroll,
  showRevisionAnalysisProbe: show
});
