import { describe, expect, it } from "vitest";
import {
  BuiltinSubagentSettingsSchema,
  defaultBuiltinSubagentSettings
} from "./builtin-subagents";

describe("built-in management tool settings migration", () => {
  it("defaults every group to disabled without changing the persisted shape", () => {
    const settings = defaultBuiltinSubagentSettings();
    expect(Object.keys(settings)).toEqual(["skill", "material", "team"]);
    for (const setting of Object.values(settings)) {
      expect(setting.enabled).toBe(false);
      expect(Object.keys(setting)).toEqual(["enabled", "description"]);
    }
  });
  it.each(["skill", "material"] as const)(
    "migrates the old %s default even when enabled",
    (domain) => {
      const settings = defaultBuiltinSubagentSettings();
      settings[domain] = {
        enabled: true,
        description: `仅当用户主动要求或明确确认在当前作品绑定的${domain === "skill" ? "技能库" : "素材库"}中创建、记录、优化或编辑内容时调用。普通创作、查询、引用和使用技能不触发。`
      };
      expect(BuiltinSubagentSettingsSchema.parse(settings)[domain]).toEqual(
        defaultBuiltinSubagentSettings()[domain]
      );
    }
  );
  it.each([
    "仅在用户要求查看、管理或优化当前作品绑定团队的成员提示词时调用。先读取原提示词，修改逐项审阅，明确接受后保存。",
    "仅在用户要求查看、管理或优化当前作品实际生效团队的成员提示词时调用。有绑定时使用绑定团队，无绑定时使用当前类型启用的团队。先读取原提示词，修改逐项审阅，明确接受后保存。"
  ])("migrates historical team descriptions: %s", (description) => {
    const settings = defaultBuiltinSubagentSettings();
    settings.team = { enabled: true, description };
    expect(BuiltinSubagentSettingsSchema.parse(settings).team).toEqual(
      defaultBuiltinSubagentSettings().team
    );
  });
  it.each([true, false])(
    "keeps custom descriptions and enabled=%s",
    (enabled) => {
      const settings = defaultBuiltinSubagentSettings();
      for (const domain of ["skill", "material", "team"] as const)
        settings[domain] = { enabled, description: "用户自定义调用说明" };
      expect(BuiltinSubagentSettingsSchema.parse(settings)).toEqual(settings);
    }
  );
});
