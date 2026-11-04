import { createScopedTranslator } from "../i18n";
import { dismissUiMessage, uiMessage } from "../ui-feedback";
import type { SystemEventCenter } from "./systemEventCenter";

const t = createScopedTranslator("foundation");

// Long enough to read the advice and reach the button beside it.
const NOTIFICATION_BLOCKED_TOAST_MS = 8_000;

function openSystemNotificationSettings(): void {
  void window.deepwrite?.generalSettings
    .openNotificationSettings()
    .catch(() => uiMessage.error(t("taskNotificationOpenSettingsFailed")));
}

/** Explains why switching task notifications on produced no system notice. */
export function subscribeNotificationBlockedToast(
  center: SystemEventCenter
): () => void {
  let toastId = -1;
  return center.subscribe("system.notification_blocked", (event) => {
    // Flipping the switch again must replace the advice, not stack a copy.
    dismissUiMessage(toastId);
    toastId = uiMessage.warning(t("taskNotificationBlocked"), {
      duration: NOTIFICATION_BLOCKED_TOAST_MS,
      ...(event.payload.canOpenSettings && {
        action: {
          label: t("taskNotificationOpenSettings"),
          run: openSystemNotificationSettings
        }
      })
    });
  });
}
