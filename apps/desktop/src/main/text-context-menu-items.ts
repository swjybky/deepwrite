import { nativeText } from "./native-i18n";
import type { ContextMenuParams } from "electron";
import type {
  TextContextMenuAction,
  TextContextMenuContext
} from "@deepwrite/contracts";

export interface TextMenuItem {
  action?: TextContextMenuAction;
  label?: string;
  enabled?: boolean;
  accelerator?: string;
  type?: "separator";
  submenu?: TextMenuItem[];
}

export function fallbackTextContext(
  params: ContextMenuParams
): TextContextMenuContext {
  return {
    kind: params.isEditable
      ? "editable"
      : params.selectionText && params.editFlags.canCopy
        ? "selection"
        : "none",
    password: params.formControlType === "input-password",
    hasSelection: Boolean(params.selectionText),
    hasText: params.editFlags.canSelectAll,
    canInsertReference: false,
    canInsertImage: false
  };
}

export function buildTextMenuItems(
  params: ContextMenuParams,
  context: TextContextMenuContext,
  hasClipboardText: boolean,
  platform: string
): TextMenuItem[] {
  if (context.kind === "none") return [];
  const flags = params.editFlags;
  const selected = context.hasSelection || Boolean(params.selectionText);
  const item = (
    action: TextContextMenuAction,
    label: string,
    enabled: boolean,
    accelerator?: string
  ): TextMenuItem => ({
    action,
    label,
    enabled,
    ...(accelerator ? { accelerator } : {})
  });
  const separator = (): TextMenuItem => ({ type: "separator" });
  const copy = item(
    "copy",
    nativeText("copy"),
    selected && flags.canCopy && !context.password,
    "CommandOrControl+C"
  );
  const selectAll = item(
    "selectAll",
    nativeText("selectAll"),
    context.hasText,
    "CommandOrControl+A"
  );
  const items: TextMenuItem[] =
    context.kind === "editable"
      ? [
          item(
            "undo",
            nativeText("undo"),
            context.history?.canUndo ?? flags.canUndo,
            "CommandOrControl+Z"
          ),
          item(
            "redo",
            nativeText("redo"),
            context.history?.canRedo ?? flags.canRedo,
            platform === "darwin" ? "Command+Shift+Z" : "Control+Y"
          ),
          separator(),
          item(
            "cut",
            nativeText("cut"),
            selected && flags.canCut && !context.password,
            "CommandOrControl+X"
          ),
          copy,
          item(
            "paste",
            nativeText("paste"),
            flags.canPaste && hasClipboardText,
            "CommandOrControl+V"
          ),
          item("delete", nativeText("delete"), selected && flags.canDelete),
          separator(),
          selectAll
        ]
      : context.kind === "readonly"
        ? [copy, separator(), selectAll]
        : [copy];
  if (context.canInsertReference && selected && !context.password) {
    items.unshift(
      item("insertReference", nativeText("insertReference"), true),
      separator()
    );
  }
  if (context.canInsertImage && !context.password) {
    items.push(separator(), {
      label: nativeText("insert"),
      submenu: [item("insertImage", nativeText("insertImage"), true)]
    });
  }
  return items;
}
