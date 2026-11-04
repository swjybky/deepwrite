import type { ExternalControlClient } from "@deepwrite/contracts/external-control";
import { dialog, type BrowserWindow } from "electron";
import { nativeMessages, nativeText } from "../../main/native-i18n";

interface ConfirmDialogOptions {
  getWindow(): BrowserWindow | undefined;
  showWindow(): void;
}

const ALLOW = 0;
const DENY = 1;

/** A native dialog: it works before the Renderer has finished loading. */
export function createClientConfirmDialog(options: ConfirmDialogOptions) {
  return async (client: ExternalControlClient): Promise<boolean> => {
    options.showWindow();
    const dialogOptions = {
      type: "question" as const,
      title: nativeText("externalClientTitle"),
      message: nativeMessages().externalClientRequest(client.name),
      detail: nativeText("externalClientDetail"),
      buttons: [
        nativeText("externalClientAllow"),
        nativeText("externalClientDeny")
      ],
      defaultId: DENY,
      cancelId: DENY
    };
    const window = options.getWindow();
    const { response } = window
      ? await dialog.showMessageBox(window, dialogOptions)
      : await dialog.showMessageBox(dialogOptions);
    return response === ALLOW;
  };
}
