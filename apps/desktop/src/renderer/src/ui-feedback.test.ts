import { describe, expect, it, vi } from "vitest";
import { dismissUiMessage, uiMessage, uiMessageItems } from "./ui-feedback";

describe("ui-feedback", () => {
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
});
