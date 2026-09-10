import { ref } from "vue";
import {
  BuiltinSubagentSettingsSchema,
  type BuiltinSubagentSettings
} from "@deepwrite/contracts/renderer";
import { useSettingsStore } from "../stores/settingsStore";
import { uiMessage } from "../ui-feedback";

export function useBuiltinSubagentSettings() {
  const saving = ref(false);
  const settings = useSettingsStore();
  async function save(input: BuiltinSubagentSettings): Promise<boolean> {
    const api = window.deepwrite;
    if (!api || saving.value || settings.agentTeamSaving) return false;
    const parsed = BuiltinSubagentSettingsSchema.safeParse(input);
    if (!parsed.success) {
      uiMessage.warning("请输入调用描述，长度不超过 1,000 字。");
      return false;
    }
    saving.value = true;
    settings.agentTeamSaving = true;
    try {
      settings.markLoaded(
        "agentTeams",
        await api.agentTeams.saveBuiltins(parsed.data)
      );
      uiMessage.success("已保存内置管理子智能体设置");
      return true;
    } catch (error) {
      uiMessage.error(
        error instanceof Error ? error.message : "保存失败，请重试。"
      );
      return false;
    } finally {
      saving.value = false;
      settings.agentTeamSaving = false;
    }
  }
  return { saving, save };
}
