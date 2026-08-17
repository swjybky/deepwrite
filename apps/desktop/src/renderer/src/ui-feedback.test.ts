import { describe, expect, it } from "vitest";
import { uiMessage, uiMessageItems, dismissUiMessage } from "./ui-feedback";

describe("uiMessage", () => {
  it("formats Zod too_small title error into human-friendly Chinese message", () => {
    const rawZodError = JSON.stringify([
      {
        origin: "string",
        code: "too_small",
        minimum: 1,
        inclusive: true,
        path: ["title"],
        message: "Invalid input"
      }
    ]);

    const id = uiMessage.error(rawZodError);
    const item = uiMessageItems.value.find((msg) => msg.id === id);
    expect(item?.content).toBe("标题不能为空，请输入有效标题。");
    dismissUiMessage(id);
  });

  it("passes normal string messages through unchanged", () => {
    const id = uiMessage.info("普通提示文案");
    const item = uiMessageItems.value.find((msg) => msg.id === id);
    expect(item?.content).toBe("普通提示文案");
    dismissUiMessage(id);
  });
});
