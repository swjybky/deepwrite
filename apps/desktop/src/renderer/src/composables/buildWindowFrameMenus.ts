import { createScopedTranslator } from "../i18n";
import type {
  WindowFrameMenu,
  WorkspaceWindowActions
} from "./windowFrameMenus";

const t = createScopedTranslator("workspace.buildWindowFrameMenus");
export function buildWindowFrameMenus(
  actions: WorkspaceWindowActions
): WindowFrameMenu[] {
  return [
    {
      id: "file",
      label: t("file"),
      options: [
        {
          value: "create",
          label: t("newProject"),
          description: "Ctrl+N",
          disabled: actions.busy()
        },
        {
          value: "open",
          label: t("openProject"),
          disabled: actions.busy()
        },
        {
          value: "settings",
          label: t("settings")
        }
      ],
      run(value) {
        if (value === "create" && !actions.busy()) actions.create();
        if (value === "open" && !actions.busy()) return actions.open();
        if (value === "settings") return actions.settings();
        return undefined;
      }
    },
    {
      id: "view",
      label: t("view"),
      options: [
        {
          value: "left",
          label: actions.leftCollapsed()
            ? t("showDirectorySidebar")
            : t("hideDirectorySidebar")
        },
        {
          value: "right",
          label: actions.rightCollapsed()
            ? t("showManuscriptPanel")
            : t("hideManuscriptPanel"),
          disabled: !actions.canToggleRight()
        },
        {
          value: "appearance",
          label: t("appearanceAndTheme")
        }
      ],
      run(value) {
        if (value === "left") actions.toggleLeft();
        if (value === "right" && actions.canToggleRight())
          actions.toggleRight();
        if (value === "appearance") return actions.settings("appearance");
        return undefined;
      }
    }
  ];
}
