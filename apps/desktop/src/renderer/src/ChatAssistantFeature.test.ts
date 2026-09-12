import { describe, expect, it } from "vitest";
import shellSource from "./WorkspaceShell.vue?raw";
import historyActionsSource from "./features/chat-assistant/useChatAssistantHistoryActions.ts?raw";
import scrollSource from "./composables/useConversationScrollFollow.ts?raw";
import messageListSource from "./components/ConversationMessageList.vue?raw";
import processingTimelineSource from "./components/ConversationProcessingTimeline.vue?raw";
import sidebarSource from "./components/LeftSidebar.vue?raw";
import lazySource from "./components/lazyAppComponents.ts?raw";
import composerSource from "./features/chat-assistant/ChatAssistantComposer.vue?raw";
import homeSource from "./features/chat-assistant/ChatAssistantHome.vue?raw";
import overlaySource from "./features/chat-assistant/ChatAssistantOverlay.vue?raw";
import headerSource from "./features/chat-assistant/ChatAssistantHeader.vue?raw";
import featureSource from "./features/chat-assistant/useChatAssistant.ts?raw";
import modeSource from "./features/chat-assistant/useChatAssistantMode.ts?raw";
import webSearchSource from "./features/chat-assistant/useChatAssistantWebSearch.ts?raw";

describe("independent chat assistant feature", () => {
  it("places chat beside agent teams without replacing the workspace view", () => {
    const modelIndex = sidebarSource.indexOf('label: "自定义模型配置"');
    const chatIndex = sidebarSource.indexOf('label: "聊天"');
    const teamIndex = sidebarSource.indexOf('label: "智能体团队"');
    expect(modelIndex).toBeGreaterThan(-1);
    expect(teamIndex).toBeGreaterThan(modelIndex);
    expect(chatIndex).toBeGreaterThan(teamIndex);
    expect(sidebarSource).toContain('emit("openChatAssistant")');
    expect(shellSource).toContain('@open-chat-assistant="chatAssistant.open"');
    expect(shellSource).toContain(
      "chatAssistant.active.value ? 'chat-assistant'"
    );
    expect(featureSource).not.toContain("workspaceMainView");
  });

  it("lazy-loads a teleported floating surface with minimize and history controls", () => {
    expect(lazySource).toContain(
      '() => import("../features/chat-assistant/ChatAssistantOverlay.vue")'
    );
    expect(shellSource).toContain('<Teleport to="body">');
    expect(shellSource).toContain('v-if="chatAssistant.visible.value');
    expect(headerSource).toContain('aria-label="最小化聊天助手"');
    expect(homeSource).toContain("visibleHistory");
    expect(homeSource).toContain("查看全部");
    expect(homeSource).toContain("selectConversation(item.sessionId)");
    expect(overlaySource).toContain("useChatAssistantHistoryActions({");
    expect(historyActionsSource).toContain(
      "options.controller().newConversation()"
    );
    expect(overlaySource).toContain("width: min(44vw");
    expect(overlaySource).toContain("height: min(88vh");
    expect(overlaySource).toContain('aria-label="调整聊天窗口宽度"');
    expect(overlaySource).toContain('aria-label="调整聊天窗口高度"');
    expect(overlaySource).toContain("chat-assistant-resize-edge is-left");
    expect(overlaySource).toContain("chat-assistant-resize-edge is-top");
    expect(overlaySource).not.toContain("chat-assistant-resize-handle");
    expect(overlaySource).toContain('"deepwrite:chat-assistant-size:v2"');
  });

  it("centers the new-chat empty state without moving recent history", () => {
    expect(overlaySource).toContain("<ChatAssistantHome");
    expect(overlaySource).toContain(".chat-assistant-home-wrap {");
    expect(overlaySource).toContain("height: 100%");
    expect(overlaySource).toContain("box-sizing: border-box");
    expect(homeSource).toContain("chat-assistant-home.is-empty");
    expect(homeSource).toContain("place-items: center");
    expect(homeSource).toContain("chat-assistant-home.has-history");
    expect(homeSource).toContain("grid-template-rows: minmax(80px, 1fr) auto");
    expect(homeSource).not.toContain("align-self: end");
  });

  it("shares the agent conversation timeline instead of maintaining a chat-only trace", () => {
    expect(overlaySource).toContain(
      'import ConversationMessageList from "../../components/ConversationMessageList.vue"'
    );
    expect(overlaySource).toContain("<ConversationMessageList");
    expect(overlaySource).not.toContain("ChatAssistantProcessingTrace");
    expect(messageListSource).toContain("<ConversationMessageItem");
    expect(processingTimelineSource).toContain(
      "processingDisplayItems(message, true, longProposalItems)"
    );
    expect(processingTimelineSource).toContain(
      "processingDisplayItems(message)"
    );
  });

  it("stops following the tail as soon as the user scrolls upward", () => {
    expect(overlaySource).toContain(
      'import { useConversationScrollFollow } from "../../composables/useConversationScrollFollow"'
    );
    expect(overlaySource).toContain("useConversationScrollFollow({");
    expect(overlaySource).toContain(
      ':handle-conversation-wheel="handleConversationWheel"'
    );
    expect(overlaySource).toContain(
      ':handle-conversation-scroll="handleConversationScroll"'
    );
    expect(scrollSource).toMatch(
      /if \(!followsConversationTail\.value\)\s*\{\s*return;/
    );
    expect(scrollSource).toContain("tailFollowLockedForResponse.value");
    expect(scrollSource).toContain(
      "const preservedScrollTop = element.scrollTop"
    );
    expect(overlaySource).not.toContain(
      "scrollTo({ top: scroller.value.scrollHeight })"
    );
  });

  it("isolates normal and per-project controllers and sends the selected context", () => {
    expect(modeSource).toContain('key: "chat-assistant:normal"');
    expect(modeSource).toContain("`chat-assistant:project:${suffix}`");
    expect(featureSource).toContain(
      '"chat-assistant",\n      "chat-assistant:normal"'
    );
    expect(modeSource).toContain("controller.value.sendAssistantMessage(");
    expect(overlaySource).toContain("assistant.sendAssistantMessage(");
    expect(composerSource).toContain("emit('stop')");
    expect(composerSource).toContain('accessible-label="聊天模型"');
    expect(overlaySource).toContain("controller.value!.configuredModels.value");
    expect(composerSource).toContain("附件功能后续开放");
    expect(composerSource).toContain("语音功能后续开放");
  });

  it("adds a persisted DeepSeek-only web search toggle before the model selector", () => {
    const searchIndex = composerSource.indexOf('aria-label="智能搜索"');
    const modelIndex = composerSource.indexOf('accessible-label="聊天模型"');
    expect(searchIndex).toBeGreaterThan(-1);
    expect(modelIndex).toBeGreaterThan(searchIndex);
    expect(composerSource).toContain("webSearchAvailable");
    expect(composerSource).toContain("is-active");
    expect(composerSource).toContain("var(--accent-soft)");
    expect(composerSource).toContain("<span>智能搜索</span>");
    expect(composerSource).not.toContain('<AppIcon name="search"');
    expect(webSearchSource).toContain(
      '"deepwrite:chat-assistant-web-search:v1"'
    );
    expect(webSearchSource).toContain("isDeepSeekWebSearchCompatible");
    expect(modeSource).toContain("webSearchEnabled: true");
  });

  it("uses one context list and immutable book association in the project dialog", () => {
    expect(headerSource).toContain('accessible-label="切换聊天上下文"');
    expect(overlaySource).toContain("context:normal");
    expect(overlaySource).toContain("+ 添加新项目配置");
    expect(overlaySource).not.toContain('class="chat-assistant-mode-tabs"');
    expect(overlaySource).toContain("编辑项目");
    expect(overlaySource).toContain('actionIcon: "edit"');
    expect(overlaySource).toContain('@edit-project="openEditProject"');
    expect(overlaySource).not.toContain(
      'class="chat-assistant-project-action"'
    );
    expect(overlaySource).toContain('accessible-label="关联书籍"');
    expect(overlaySource).toContain(
      "projectConfigMode === 'edit' || projectConfigPending"
    );
    expect(overlaySource).toContain("关联书籍已锁定，不可更换");
    expect(modeSource).not.toContain("projectOptions.value[0].project");
    expect(overlaySource).toContain("恢复默认");
    expect(overlaySource).toContain("uiMessage.success");
    expect(overlaySource).toContain("可查询创作空间目录");
    expect(overlaySource).not.toContain('chat-assistant-context"');
    expect(overlaySource).toContain(
      "grid-template-rows: auto minmax(0, 1fr) auto"
    );
    expect(overlaySource).toContain("var(--theme-line)");
    expect(overlaySource).toContain("assistant.isBusy.value");
    expect(overlaySource).toContain("!assistant.projectAvailable.value");
  });
});
