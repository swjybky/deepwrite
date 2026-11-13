import { expectSourceToContain } from "../../test-utils/sourceText";
import { describe, expect, it } from "vitest";
import shellSource from "./WorkspaceShell.vue?raw";
import historyActionsSource from "./features/chat-assistant/useChatAssistantHistoryActions.ts?raw";
import scrollSource from "./composables/useConversationScrollFollow.ts?raw";
import messageListSource from "./components/ConversationMessageList.vue?raw";
import processingTimelineSource from "./components/ConversationProcessingTimeline.vue?raw";
import timelineBlocksSource from "./components/conversationTimelineBlocks.ts?raw";
import sidebarSource from "./components/LeftSidebar.vue?raw";
import { moreFeatures } from "./components/sidebarMoreFeatures";
import asyncComponentsSource from "./components/lazyAppComponents.ts?raw";
import featureImportsSource from "./components/lazyFeatureImports.ts?raw";
const lazySource = `${asyncComponentsSource}\n${featureImportsSource}`;
import composerComponentSource from "./features/chat-assistant/ChatAssistantComposer.vue?raw";
const composerSource = composerComponentSource;
import homeSource from "./features/chat-assistant/ChatAssistantHome.vue?raw";
import overlayComponentSource from "./features/chat-assistant/ChatAssistantOverlay.vue?raw";
import overlayWindowSource from "./features/chat-assistant/useChatAssistantWindow.ts?raw";
import projectConfigSource from "./features/chat-assistant/ChatAssistantProjectConfig.vue?raw";
import projectConfigLogicSource from "./features/chat-assistant/useChatAssistantProjectConfig.ts?raw";
const overlaySource = [
  overlayComponentSource,
  overlayWindowSource,
  projectConfigSource,
  projectConfigLogicSource
].join("\n");
import headerSource from "./features/chat-assistant/ChatAssistantHeader.vue?raw";
import featureSource from "./features/chat-assistant/useChatAssistant.ts?raw";
import modeSource from "./features/chat-assistant/useChatAssistantMode.ts?raw";
import webSearchSource from "./features/chat-assistant/useChatAssistantWebSearch.ts?raw";

describe("independent chat assistant feature", () => {
  it("places chat in more features without replacing the workspace view", () => {
    expect(sidebarSource).not.toContain('label: "自定义模型配置"');
    expect(sidebarSource).not.toContain('label: "聊天"');
    expect(moreFeatures).toContainEqual({
      id: "chat-assistant",
      label: "聊天",
      description: "打开独立聊天助手",
      icon: "message"
    });
    expect(sidebarSource).toContain('emit("openChatAssistant")');
    expect(shellSource).toContain('@open-chat-assistant="chatAssistant.open"');
    expect(shellSource).toContain(
      "chatAssistant.active.value ? 'chat-assistant'"
    );
    expect(featureSource).not.toContain("workspaceMainView");
  });

  it("lazy-loads a teleported floating surface with minimize and history controls", () => {
    expectSourceToContain(
      lazySource,
      '() => import("../features/chat-assistant/ChatAssistantOverlay.vue")'
    );
    expect(shellSource).toContain('<Teleport to="body">');
    expect(shellSource).toContain('v-if="chatAssistant.visible.value');
    expect(headerSource).toContain("minimizeAssistant");
    expect(homeSource).toContain("visibleHistory");
    expect(homeSource).toContain("viewAll");
    expect(homeSource).toContain("selectConversation(item.sessionId)");
    expect(overlaySource).toContain("useChatAssistantHistoryActions({");
    expect(historyActionsSource).toContain(
      "options.controller().newConversation()"
    );
    expect(overlaySource).toContain("width: min(44vw");
    expect(overlaySource).toContain("height: min(88vh");
    expect(overlaySource).toContain("chatAssistant.resizeChatWidth");
    expect(overlaySource).toContain("chatAssistant.resizeChatHeight");
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
    expect(processingTimelineSource).toContain("conversationTimelineBlocks(");
    expect(timelineBlocksSource).toContain("processingDisplayItems(");
    expect(processingTimelineSource).toContain("<ConversationWorkGroup");
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
    expect(composerSource).toContain("<ConversationModelConfigSelect");
    expect(overlaySource).toContain("controller.value!.configuredModels.value");
    expect(composerSource).toContain("openAttachmentPicker");
    expect(composerSource).toContain("chatAssistant.voiceInput");
    expect(composerSource).toContain("<VoiceInputBar");
  });

  it("puts model, reasoning, temperature and the persisted web search toggle in the workspace model menu", () => {
    expect(composerSource).toContain('src="./chat-assistant-composer.css"');
    expect(composerSource).toContain(
      ':web-search-available="webSearchAvailable"'
    );
    expect(composerSource).toContain(
      ':hides-web-search="webSearchVisible === false"'
    );
    expect(composerSource).not.toContain("<PopupSelect");
    expect(overlaySource).toContain("useConversationModelOptions({");
    expect(overlaySource).toContain(
      '@select-temperature="controller.selectTemperature($event)"'
    );
    expect(webSearchSource).toContain(
      '"deepwrite:chat-assistant-web-search:v1"'
    );
    expect(webSearchSource).not.toContain("isDeepSeekWebSearchCompatible");
    expect(overlaySource).toContain("useWebSearchStatusStore");
    expect(modeSource).toContain(
      "chatTaskWithWebSearch(task, webSearchEnabled)"
    );
  });

  it("uses one context list and immutable book association in the project dialog", () => {
    expect(headerSource).toContain("switchContext");
    expect(overlaySource).toContain("context:normal");
    expect(overlaySource).toContain("chatAssistant.addProjectOption");
    expect(overlaySource).not.toContain('class="chat-assistant-mode-tabs"');
    expect(overlaySource).toContain("editProject");
    expect(overlaySource).toContain('actionIcon: "edit"');
    expect(overlaySource).toContain('@edit-project="editContext"');
    expect(overlaySource).not.toContain(
      'class="chat-assistant-project-action"'
    );
    expect(overlaySource).toContain("chatAssistant.linkedBook");
    expect(overlaySource).toContain(
      "projectConfigMode === 'edit' || projectConfigPending"
    );
    expect(overlaySource).toContain("chatAssistant.bookLinkLocked");
    expect(modeSource).not.toContain("projectOptions.value[0].project");
    expect(overlaySource).toContain("longBookAnalysis.restoreDefault");
    expect(overlaySource).toContain("uiMessage.success");
    expect(overlaySource).toContain("chatAssistant.normalContext");
    expect(overlaySource).not.toContain('chat-assistant-context"');
    expect(overlaySource).toContain(
      "grid-template-rows: auto minmax(0, 1fr) auto"
    );
    expect(overlaySource).toContain("var(--theme-line)");
    expect(overlaySource).toContain("assistant.isBusy.value");
    expect(overlaySource).toContain("!assistant.projectAvailable.value");
  });
});
