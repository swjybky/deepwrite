import { describe, expect, it } from "vitest";
import source from "./LeftSidebar.vue?raw";

describe("LeftSidebar account controls", () => {
  it("separates the account menu from the settings-page button", () => {
    expect(source).toContain('@click="toggleAccountMenu"');
    expect(source).toContain('aria-label="打开设置"');
    expect(source).toContain('@click="openSettings"');
    expect(source).not.toContain('@click="emit(\'openSettings\')"');
  });

  it("offers settings, name and author-contact actions from the account menu", () => {
    expect(source).toContain("<span>设置</span>");
    expect(source).toContain('@click="openSettings"');
    expect(source).toContain("<span>姓名</span>");
    expect(source).toContain("联系作者");
    expect(source).toContain('profileDialog.value = "name"');
    expect(source).toContain('profileDialog.value = "contact"');
  });

  it("persists the user name and shows the requested author contact", () => {
    expect(source).toContain('const USER_NAME_STORAGE_KEY = "deepwrite:user-name:v1"');
    expect(source).toContain("localStorage.setItem(USER_NAME_STORAGE_KEY, nextName)");
    expect(source).toContain("如果你有任何反馈，或者想体验最新版本，请添加作者微信并加入交流群。");
    expect(source).toContain("deepseekwrite");
  });

  it("shows a background-running marker for learning imitation", () => {
    expect(source).toContain("imitationRunning");
    expect(source).toContain("nav-background-status");
    expect(source).toContain("后台中");
  });
});
