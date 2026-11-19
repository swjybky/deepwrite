import { describe, expect, it } from "vitest";
import shellSource from "./WorkspaceShell.vue?raw";
import sidebarSource from "./components/LeftSidebar.vue?raw";
import { moreFeatures } from "./components/sidebarMoreFeatures";
import featureSource from "./features/chat-assistant/useChatAssistant.ts?raw";

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
});
