import {
  createDefaultGeneralSettings,
  type DeepWriteApi
} from "@deepwrite/contracts";

export function createGeneralSettingsTestApi(): DeepWriteApi["generalSettings"] {
  return {
    async list() {
      return {
        persisted: false,
        settings: {
          ...createDefaultGeneralSettings(),
          permissionMode: "request-approval",
          autoSave: false
        }
      };
    },
    async save(settings) {
      return { persisted: true, settings };
    },
    async openNotificationSettings() {}
  };
}
