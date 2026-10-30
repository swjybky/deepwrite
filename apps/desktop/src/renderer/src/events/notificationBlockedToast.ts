import { createScopedTranslator } from "../i18n";
import { uiMessage } from "../ui-feedback";
import type { SystemEventCenter } from "./systemEventCenter";

const t = createScopedTranslator("foundation");

// The advice has two steps, so it needs longer than the default toast.
const NOTIFICATION_BLOCKED_TOAST_MS = 8_000;

/** Explains why switching task notifications on produced no system notice. */
export function subscribeNotificationBlockedToast(
  center: SystemEventCenter
): () => void {
  return center.subscribe("system.notification_blocked", () => {
    uiMessage.warning(t("taskNotificationBlocked"), {
      duration: NOTIFICATION_BLOCKED_TOAST_MS
    });
  });
}
