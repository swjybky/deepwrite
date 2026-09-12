import { verifyVueInteractions } from "./conversation-vue-interactions";
import { createApp, h, nextTick, ref, type App } from "vue";
import { createPinia } from "pinia";
import AgentConversation from "../../src/renderer/src/components/AgentConversation.vue";
import type { ChatMessage } from "../../src/renderer/src/types/conversation";
import "../../src/renderer/src/styles.css";

Date.now = () => Date.parse("2026-09-11T00:00:01.000Z");
const frame = () => new Promise(requestAnimationFrame);
const percentile = (values: number[]) =>
  [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1];
let app: App | undefined;
const messages = ref<ChatMessage[]>([]);
const draft = ref("");
const responding = ref(true);
const globals = window as typeof window & Record<string, unknown>;
globals.prepareVueProbe = async (turns: number, enabled: boolean) => {
  app?.unmount();
  draft.value = "";
  responding.value = true;
  const body = Array.from(
    { length: 8 },
    (_, i) =>
      `测试段落 ${i}：**保留所有历史正文**，这是一段虚构内容，用于观察长会话输入和滚动性能。\n\n`
  ).join("");
  messages.value = Array.from(
    { length: turns },
    (_, i) =>
      [
        {
          id: `user-${i}`,
          role: "user",
          content: `第 ${i} 个测试问题`,
          createdAt: "2026-09-11T00:00:00.000Z",
          status: "completed"
        },
        {
          id: `assistant-${i}`,
          role: "assistant",
          content: `${body}唯一定位标记_${i}_END`,
          thinking: "示例思考记录".repeat(100),
          toolCalls: [
            {
              id: `tool-${i}`,
              name: "read_workspace",
              status: "completed",
              args: { sample: "仅测试数据".repeat(100) }
            }
          ],
          createdAt: "2026-09-11T00:00:00.000Z",
          status: i === turns - 1 ? "streaming" : "completed"
        }
      ] as ChatMessage[]
  ).flat();
  const props = {
    conversationHistory: [],
    currentSessionId: "probe-session",

    canSend: false,
    canSendAttachments: false,
    canStop: true,
    runtimeAvailable: true,
    models: [],
    selectedModelId: "",
    thinkingLevel: "off" as const,
    webSearchEnabled: false,
    temperature: 0.7,
    approvalMode: "request-approval" as const,
    agentTeamMode: "normal" as const,
    contextTitle: "测试",
    bookTitle: "测试作品",
    stageLabel: "测试阶段",
    agentLabel: "测试智能体",
    agentId: undefined,
    libraryDomain: undefined,
    librarySkills: undefined,
    welcomeShortcuts: undefined,
    availableSkills: [],
    availableMaterials: [],
    editorReferences: [],
    leftCollapsed: false,
    rightCollapsed: false,
    deferHistoryRendering: enabled,
    canRewriteHistory: true,
    submitEditedMessage: async () => false
  };
  const start = performance.now();
  app = createApp({
    render: () =>
      h(AgentConversation, {
        ...props,
        responding: responding.value,
        messages: messages.value,
        draft: draft.value,
        "onUpdate:draft": (value: string) => {
          draft.value = value;
        }
      })
  });
  app.use(createPinia());
  app.mount("#app");
  await nextTick();
  const mountedMs = performance.now() - start;
  await frame();
  await frame();
  await frame();
  return {
    turns,
    enabled,
    mountedMs,
    nodeCount: document.querySelectorAll("*").length,
    messageCount: document.querySelectorAll("[data-conversation-message-id]")
      .length
  };
};
globals.measureVueProbe = async () => {
  const streamCosts: number[] = [],
    frameCosts: number[] = [],
    inputCosts: number[] = [];
  let previous: number | undefined;
  for (let i = 0; i < 40; i += 1) {
    await frame();
    const start = performance.now();
    if (previous !== undefined) frameCosts.push(start - previous);
    previous = start;
    messages.value.at(-1)!.content += " 新增正文";
    await nextTick();
    void document.querySelector(".message-list")?.getBoundingClientRect()
      .height;
    streamCosts.push(performance.now() - start);
    const inputStart = performance.now();
    draft.value += "测";
    await nextTick();
    void document.querySelector(".composer")?.getBoundingClientRect().height;
    inputCosts.push(performance.now() - inputStart);
  }
  const scroller = document.querySelector<HTMLElement>(".conversation-scroll")!;
  const lastTop = scroller.scrollTop;
  scroller.dispatchEvent(new WheelEvent("wheel", { deltaY: -100 }));
  scroller.scrollTop = Math.max(0, lastTop - 500);
  await frame();
  const lockedTop = scroller.scrollTop;
  messages.value.at(-1)!.content += " 手动上滚后仍继续生成";
  await nextTick();
  await frame();
  await frame();
  const lockedDelta = scroller.scrollTop - lockedTop;
  const targetId = messages.value.length > 20 ? "user-10" : "user-2";
  const target = document.querySelector<HTMLElement>(
    `[data-conversation-turn-id="${targetId}"]`
  );
  target?.click();
  await new Promise((resolve) => setTimeout(resolve, 1_200));
  const message = document.querySelector<HTMLElement>(
    `[data-conversation-message-id="${targetId}"]`
  );
  const navigationOffset = message
    ? message.getBoundingClientRect().top - scroller.getBoundingClientRect().top
    : null;
  return {
    streamP95Ms: percentile(streamCosts),
    frameP95Ms: percentile(frameCosts),
    inputP95Ms: percentile(inputCosts),
    lockedDelta,
    navigationOffset,
    deferredGroups: document.querySelectorAll(
      ".conversation-message-group.is-deferred"
    ).length
  };
};
globals.selectVueHistory = () => {
  const items = document.querySelectorAll("[data-conversation-message-id]");
  const range = document.createRange();
  range.setStartBefore(items[0]!);
  range.setEndAfter(items[items.length - 1]!);
  getSelection()!.removeAllRanges();
  getSelection()!.addRange(range);
  return getSelection()!.toString();
};

globals.verifyVueInteractions = () =>
  verifyVueInteractions(messages, responding);
