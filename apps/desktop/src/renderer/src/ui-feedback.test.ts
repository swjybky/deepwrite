import { describe, expect, it, vi } from "vitest";
import { dismissUiMessage, uiMessage, uiMessageItems } from "./ui-feedback";
import source from "./ui-feedback.ts?raw";
import hostSource from "./components/ToastHost.vue?raw";

describe("ui-feedback", () => {
  it("keeps global floating messages lightweight and centered at the top", () => {
    expect(source).toContain("const MAX_VISIBLE_MESSAGES = 3");
    expect(source).toContain("export const uiMessage = {");
    expect(source).not.toContain("naive-ui");
    expect(source).not.toContain("createDiscreteApi");
    expect(hostSource).toContain('<Teleport to="body">');
    expect(hostSource).toContain("position: fixed");
    expect(hostSource).toContain("left: 50%");
    expect(hostSource).toContain("var(--surface-raised)");
  });

  it("sizes each message to its content and wraps at the existing limit", () => {
    expect(hostSource).toContain("justify-items: center");
    expect(hostSource).toContain("width: calc(100vw - 32px)");
    expect(hostSource).toContain("width: fit-content");
    expect(hostSource).toContain("max-width: min(520px, 100%)");
    expect(hostSource).toContain('class="toast-message__content"');
    expect(hostSource).toContain("white-space: normal");
    expect(hostSource).toContain("overflow-wrap: anywhere");
  });

  it("keeps a message's action, and leaves ordinary messages without one", () => {
    const run = vi.fn();
    const withAction = uiMessage.warning("需要处理", {
      action: { label: "去处理", run }
    });
    const plain = uiMessage.info("已保存");
    expect(uiMessageItems.value.map((item) => item.action?.label)).toEqual([
      "去处理",
      undefined
    ]);
    uiMessageItems.value[0]?.action?.run();
    expect(run).toHaveBeenCalledTimes(1);
    dismissUiMessage(withAction);
    dismissUiMessage(plain);
  });

  it("lets the action run without also counting as a click on the message", () => {
    expect(hostSource).toContain('@click="dismissUiMessage(item.id)"');
    expect(hostSource).toContain('@click.stop="runAction(item)"');
    expect(hostSource).toContain(
      "dismissUiMessage(item.id);\n  item.action?.run();"
    );
  });
});
