import { describe, expect, it } from "vitest";
import { locale, registerMessageCatalog } from "../../i18n";
import type { MessageSchema } from "../../i18n/messages";
import enUS from "./messages/en-US";
import zhCN from "./messages/zh-CN";
import { packT } from "./pack-labels";

describe("long material pack messages", () => {
  it("keeps both languages complete", () => {
    expect(Object.keys(enUS).sort()).toEqual(Object.keys(zhCN).sort());
    for (const value of [...Object.values(zhCN), ...Object.values(enUS)])
      expect(value.trim()).not.toBe("");
  });

  it("registers the page strings when the page code loads", () => {
    locale.value = "zh-CN";
    expect(packT("chapterLabel", { number: 3 })).toBe("第 3 章");
    locale.value = "en-US";
    expect(packT("chapterLabel", { number: 3 })).toBe("Chapter 3");
    locale.value = "zh-CN";
  });

  it("survives the startup catalog being registered after the page", () => {
    registerMessageCatalog("zh-CN", {} as MessageSchema);
    expect(packT("chapterLabel", { number: 3 })).toBe("第 3 章");
  });
});
