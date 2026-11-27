import { computed } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SHORT_AGENT_WELCOME_SHORTCUTS } from "@deepwrite/contracts/renderer";
import { resolveAgentWelcome } from "../data/agentWelcome";
import { EMPTY_WORKSPACE_DOCUMENT } from "../data/emptyWorkspaceDocument";
import { buildWindowFrameMenus } from "../composables/buildWindowFrameMenus";
import { VOICE_LANGUAGE_OPTIONS } from "../composables/voiceSettingsOptions";
import {
  formatVoiceDuration,
  formatVoiceTokens
} from "../composables/voiceUsageSummary";
import { setAppLanguage } from "./index";

afterEach(() => setAppLanguage("zh-CN", "zh-CN"));

describe("workspace interface localization", () => {
  it("updates existing option objects without changing their business values", () => {
    setAppLanguage("zh-CN", "zh-CN");
    const rows = [...VOICE_LANGUAGE_OPTIONS];
    const values = rows.map((row) => row.value);
    const labels = computed(() => rows.map((row) => row.label));
    const chinese = [...labels.value];
    setAppLanguage("en-US", "zh-CN");
    expect(labels.value).not.toEqual(chinese);
    expect(labels.value.every((value) => !/\p{Script=Han}/u.test(value))).toBe(
      true
    );
    expect(rows.map((row) => row.value)).toEqual(values);
    setAppLanguage("zh-CN", "en-US");
    expect(labels.value).toEqual(chinese);
  });

  it("localizes untouched welcome defaults and preserves customized shortcut text", () => {
    const defaults = [...DEFAULT_SHORT_AGENT_WELCOME_SHORTCUTS.short];
    const welcome = computed(() =>
      resolveAgentWelcome("short", undefined, undefined, defaults)
    );
    expect(welcome.value.questions).toEqual(defaults);
    setAppLanguage("en-US", "zh-CN");
    expect(welcome.value.title).toBe(
      "Start with the current short story stage"
    );
    expect(welcome.value.questions[0]).toBe(
      "Continue developing the current stage"
    );
    expect(defaults).toEqual(DEFAULT_SHORT_AGENT_WELCOME_SHORTCUTS.short);
    const custom = ["按我的中文提示写作", "Keep my text", "保留我的角色名称"];
    expect(
      resolveAgentWelcome("short", undefined, undefined, custom).questions
    ).toEqual(custom);
  });

  it("keeps empty workspace metadata responsive without changing document identity", () => {
    const document = EMPTY_WORKSPACE_DOCUMENT;
    const content = computed(() => document.content);
    expect(content.value).toContain("新建书籍");
    setAppLanguage("en-US", "zh-CN");
    expect(content.value).toContain("New Book");
    expect(document.title).toBe("No book open");
    expect(document.id).toBe("deepwrite-empty-workspace");
    expect(document.readOnly).toBe(true);
    expect(document.format).toBe("设定");
  });

  it("keeps menu actions identified independently of translated labels", () => {
    const create = vi.fn();
    const actions = {
      busy: () => false,
      create,
      open: async () => {},
      settings: async () => {},
      leftCollapsed: () => false,
      rightCollapsed: () => false,
      toggleLeft: vi.fn(),
      toggleRight: vi.fn(),
      canToggleRight: () => true,
      escape: vi.fn()
    };
    const menus = computed(() => buildWindowFrameMenus(actions));
    expect(menus.value[0]?.label).toBe("文件");
    setAppLanguage("en-US", "zh-CN");
    expect(menus.value[0]?.label).toBe("File");
    expect(menus.value.map((menu) => menu.id)).toEqual(["file", "view"]);
    menus.value[0]?.run("create");
    expect(create).toHaveBeenCalledOnce();
  });

  it("formats units in the current language while preserving values", () => {
    expect(formatVoiceDuration(65000)).toBe("1 分 5 秒");
    setAppLanguage("en-US", "zh-CN");
    expect(formatVoiceDuration(65000)).toBe("1m 5s");
    expect(formatVoiceDuration(3660000)).toBe("1h 1m");
    expect(formatVoiceTokens(12345)).toBe("12,345");
    expect(formatVoiceTokens(undefined)).toBe("Not reported");
  });
});
