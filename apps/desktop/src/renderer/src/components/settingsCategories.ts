import { createScopedTranslator } from "../i18n";

const imageT = createScopedTranslator("components.imageModelSettings");
const webSearchT = createScopedTranslator("components.webSearchSettings");
const externalControlT = createScopedTranslator("extras.externalControl");
const t = createScopedTranslator("components.settingsPage");

export interface SettingsCategory {
  id: string;
  label: string;
  keywords?: string;
  icon?:
    | "directory"
    | "sparkles"
    | "globe"
    | "model"
    | "ledger"
    | "brain"
    | "settings"
    | "wand"
    | "archive"
    | "image";
}

export interface SettingsSection {
  id: string;
  label: string;
  categories: SettingsCategory[];
}

export const settingsSections: SettingsSection[] = [
  {
    id: "personal",
    get label() {
      return t("personal");
    },
    categories: [
      {
        id: "general",
        get label() {
          return t("general");
        },
        icon: "settings"
      },
      {
        id: "directory",
        get label() {
          return t("storage");
        },
        icon: "directory",
        get keywords() {
          return t("storageUserDataHistoryDefaultLocationWorkspaceFolder");
        }
      },
      {
        id: "body-text",
        get label() {
          return t("manuscriptText");
        },
        icon: "wand"
      },
      {
        id: "appearance",
        get label() {
          return t("appearance");
        },
        icon: "sparkles"
      },
      {
        id: "configuration",
        get label() {
          return t("contextSettings");
        },
        icon: "model"
      },
      {
        id: "web-search",
        get label() {
          return webSearchT("title");
        },
        get keywords() {
          return webSearchT("keywords");
        },
        icon: "globe"
      },
      {
        id: "external-control",
        get label() {
          return externalControlT("title");
        },
        get keywords() {
          return externalControlT("keywords");
        },
        icon: "brain"
      }
    ]
  },
  {
    id: "models-and-usage",
    get label() {
      return t("modelsAndUsage");
    },
    categories: [
      {
        id: "usage",
        get label() {
          return t("usage");
        },
        icon: "ledger"
      },
      {
        id: "free-models",
        get label() {
          return t("freeModels");
        },
        icon: "model"
      },
      {
        id: "custom-models",
        get label() {
          return t("customModelSettings");
        },
        icon: "model"
      },
      {
        id: "site-official-models",
        get label() {
          return t("officialSiteModels");
        },
        icon: "model"
      },
      {
        id: "voice",
        get label() {
          return t("voiceSettings");
        },
        icon: "brain"
      },
      {
        id: "image-models",
        get label() {
          return imageT("title");
        },
        icon: "image"
      }
    ]
  },
  {
    id: "creation",
    get label() {
      return t("writing");
    },
    categories: [
      {
        id: "short-agents",
        get label() {
          return t("workspaceSettings");
        },
        icon: "brain"
      },
      {
        id: "skill-library-agent",
        get label() {
          return t("skillLibrarySettings");
        },
        icon: "wand"
      },
      {
        id: "material-library-agent",
        get label() {
          return t("materialLibrarySettings");
        },
        icon: "archive"
      },
      {
        id: "more-features",
        get label() {
          return t("moreFeaturesSettings");
        },
        get keywords() {
          return t("moreFeaturesKeywords");
        },
        icon: "settings"
      }
    ]
  },
  {
    id: "archived",
    get label() {
      return t("archived");
    },
    categories: [
      {
        id: "archived-conversations",
        get label() {
          return t("archivedConversations");
        },
        icon: "archive"
      }
    ]
  }
];
