import { Notification } from "electron";
import type {
  ModelUsageModule,
  SystemEventEnvelope
} from "@deepwrite/contracts";
import { nativeText } from "./native-i18n";
import {
  isWindowInUse,
  noticeForJobEvent,
  noticeForRunEnd,
  type NotificationWindow,
  type RunNoticeContext,
  type TaskNotice
} from "./task-notification-policy";

type NativeKey = Parameters<typeof nativeText>[0];

const MODULE_LABELS = {
  "book-identity": "notifyBookIdentity",
  "short-writing": "notifyShortWriting",
  "script-writing": "notifyScriptWriting",
  "long-writing": "notifyLongWriting",
  "skill-library": "notifySkillLibrary",
  "material-library": "notifyMaterialLibrary",
  "long-book-analysis": "notifyLongBookAnalysis",
  "long-book-decomposition": "notifyDecomposition",
  "long-material-pack": "notifyMaterialPack",
  "revision-analysis": "notifyRevisionAnalysis",
  "short-book-analysis": "notifyShortBookAnalysis",
  "style-comparison": "notifyStyleComparison",
  "subagent-authoring": "notifySubagentAuthoring",
  "assistant-chat": "notifyChat"
} as const satisfies Partial<Record<ModelUsageModule, NativeKey>>;

const OUTCOME_TEXT = {
  completed: "notifyDone",
  failed: "notifyFailed",
  paused: "notifyPaused"
} as const satisfies Record<TaskNotice["outcome"], NativeKey>;

export interface SystemNotice {
  title: string;
  body: string;
}

/** The text carries no model output, so it is safe on a lock screen. */
export function describeTaskNotice(notice: TaskNotice): SystemNotice {
  const labelKey =
    notice.module && notice.module in MODULE_LABELS
      ? MODULE_LABELS[notice.module as keyof typeof MODULE_LABELS]
      : "notifyTask";
  return {
    title: "DeepWrite",
    body: nativeText(OUTCOME_TEXT[notice.outcome]).replace(
      "{label}",
      nativeText(labelKey)
    )
  };
}

// A notification that loses its last reference can vanish before it is clicked.
const livingNotifications = new Set<Notification>();

/** `onRefused` runs when the system will not show the notice at all. */
type PresentNotice = (
  notice: SystemNotice,
  onClick: () => void,
  onRefused?: () => void
) => void;

const presentWithElectron: PresentNotice = (notice, onClick, onRefused) => {
  if (!Notification.isSupported()) {
    onRefused?.();
    return;
  }
  const notification = new Notification(notice);
  livingNotifications.add(notification);
  const release = () => livingNotifications.delete(notification);
  notification.on("click", () => {
    release();
    onClick();
  });
  notification.on("close", release);
  notification.on("failed", (_event, error) => {
    release();
    // macOS reports UNErrorDomain error 1 when notifications are not allowed
    // for the app in System Settings; nothing else would show why it is silent.
    console.warn("DeepWrite system notification was not shown:", error);
    onRefused?.();
  });
  notification.show();
};

export interface TaskNotifierOptions {
  isEnabled: () => boolean;
  getWindow: () => NotificationWindow | undefined;
  onActivate: () => void;
  /** The confirmation shown when the setting turns on was refused. */
  onEnableRefused?: () => void;
  present?: PresentNotice;
}

export function createTaskNotifier(options: TaskNotifierOptions) {
  const present = options.present ?? presentWithElectron;
  const deliver = (notice: TaskNotice | undefined): void => {
    if (!notice || !options.isEnabled()) return;
    if (isWindowInUse(options.getWindow())) return;
    present(describeTaskNotice(notice), options.onActivate);
  };
  return {
    notifyRunEnd(event: SystemEventEnvelope, context: RunNoticeContext): void {
      deliver(noticeForRunEnd(event, context));
    },
    notifyJobEvent(event: SystemEventEnvelope): void {
      deliver(noticeForJobEvent(event));
    },
    /**
     * Confirms the setting works, and lets the system ask for permission now.
     * Only this notice reports a refusal: a refused task notice would arrive
     * while nobody is looking at the window.
     */
    notifyEnabled(): void {
      present(
        {
          title: nativeText("notifyEnabled"),
          body: nativeText("notifyEnabledDetail")
        },
        options.onActivate,
        options.onEnableRefused
      );
    }
  };
}
