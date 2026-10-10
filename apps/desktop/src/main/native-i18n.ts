import type { AppLanguage } from "@deepwrite/contracts";
import { resolveAppLocale, type AppLocale } from "../localization/locale";
import zh from "./native-messages/zh-CN";
import en from "./native-messages/en-US";

const messages: Record<AppLocale, Record<keyof typeof zh, string>> = {
  "zh-CN": zh,
  "en-US": en
};
let currentLocale: AppLocale = "zh-CN";

export function setNativeLanguage(
  language: AppLanguage,
  systemLocale: string
): void {
  currentLocale = resolveAppLocale(language, systemLocale);
}

export function nativeLocale(): AppLocale {
  return currentLocale;
}

export function nativeText(key: keyof typeof zh): string {
  return messages[currentLocale][key];
}

const dynamicMessages = {
  "zh-CN": {
    startupDetails: (
      phase: string,
      code: string,
      configuration: boolean,
      path: string
    ) =>
      `${phase}时发生错误（${code}）。\n\n${configuration ? "请检查用户配置目录的访问权限和磁盘空间，再尝试启动。\n\n" : ""}请将下方本地诊断记录提供给开发者协助排查。\n\n记录位置（目录可写时生成）：\n${path}`,
    downloadTeam: (name: string) => `下载智能体团队“${name}”`,
    migrationDetails: (
      source: string,
      target: string,
      restoreDefault: boolean,
      createsSubfolder: boolean
    ) =>
      `当前位置：${source}\n目标位置：${target}\n\n${createsSubfolder ? "所选文件夹中已有其他文件，将在其中新建上方的子文件夹存放用户数据，原有文件保持不变。\n\n" : ""}将迁移历史记录、模型与加密密钥、智能体配置、偏好、用量、自定义字体及应用内保存的数据。已有外部作品保持原位。\n\n原目录会保留；迁移失败时继续使用原目录。${restoreDefault ? "目标默认目录中的旧数据会先保留为同级备份，不会被覆盖。" : ""}`,
    workspaceRejectedDetails: (rejected: string, replacement: string) =>
      `原工作目录与应用安装目录重叠（位于安装目录内，或包含安装目录）：\n${rejected}\n\n安装目录由安装程序管理，安装、更新或卸载都可能改动其中的内容。为避免作品丢失，已改用：\n${replacement}\n\n原目录中的文件没有被移动或删除。请把它们移到安装目录之外后，再到“设置 → 工作目录”重新选择。`
  },
  "en-US": {
    startupDetails: (
      phase: string,
      code: string,
      configuration: boolean,
      path: string
    ) =>
      `Startup failed during: ${phase} (${code}).\n\n${configuration ? "Check configuration folder permissions and available disk space, then try again.\n\n" : ""}Share the local diagnostic log below with the developer for troubleshooting.\n\nLog location (created if the folder is writable):\n${path}`,
    downloadTeam: (name: string) => `Download Agent Team “${name}”`,
    migrationDetails: (
      source: string,
      target: string,
      restoreDefault: boolean,
      createsSubfolder: boolean
    ) =>
      `Current location: ${source}\nDestination: ${target}\n\n${createsSubfolder ? "The selected folder already contains other files, so the subfolder shown above will be created for user data. Existing files stay untouched.\n\n" : ""}This moves history, models and encrypted keys, agent settings, preferences, usage, custom fonts, and data saved within the app. Existing external projects stay in place.\n\nThe original folder is preserved and will remain in use if migration fails.${restoreDefault ? " Existing data at the default destination will be preserved in a sibling backup folder." : ""}`,
    workspaceRejectedDetails: (rejected: string, replacement: string) =>
      `The previous workspace folder overlaps the application installation folder (it is inside it or contains it):\n${rejected}\n\nThe installation folder is managed by the installer, and installing, updating or uninstalling can change what is inside it. To protect your work DeepWrite is now using:\n${replacement}\n\nNothing in the previous folder was moved or deleted. Move it outside the installation folder, then choose it again in Settings → Workspace folder.`
  }
};

export function nativeMessages(): (typeof dynamicMessages)["zh-CN"] {
  return dynamicMessages[currentLocale];
}
