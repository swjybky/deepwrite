import { computed, onBeforeUnmount, onMounted, ref, type Ref } from "vue";
import { compareVersions } from "@deepwrite/contracts/renderer";
import type { UpdateState } from "@deepwrite/contracts";

export function announcedVersionStatus(
  announcedVersion: string | undefined,
  currentVersion: string,
  remoteVersion: string | undefined
): { hasVersionNotice: boolean; manualUpdateRequired: boolean } {
  if (!announcedVersion) {
    return { hasVersionNotice: false, manualUpdateRequired: false };
  }
  try {
    const hasVersionNotice =
      compareVersions(announcedVersion, currentVersion) > 0;
    return {
      hasVersionNotice,
      manualUpdateRequired: Boolean(
        hasVersionNotice &&
        remoteVersion &&
        compareVersions(remoteVersion, announcedVersion) < 0
      )
    };
  } catch {
    return { hasVersionNotice: false, manualUpdateRequired: false };
  }
}

export function useAnnouncedVersion(updateState: Ref<UpdateState>) {
  const announcedVersion = ref<string>();
  const officialDocsUrl = ref<string>();
  const status = computed(() =>
    announcedVersionStatus(
      announcedVersion.value,
      updateState.value.currentVersion,
      updateState.value.latestVersion
    )
  );
  let disposed = false;
  let refreshPromise: Promise<void> | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;

  function refreshAnnouncedVersion(): Promise<void> {
    if (refreshPromise) return refreshPromise;
    officialDocsUrl.value = undefined;
    refreshPromise = (async () => {
      try {
        const snapshot = await window.deepwrite?.appAlerts?.get();
        if (!disposed && snapshot) {
          announcedVersion.value = snapshot.pcLatestVersion;
          officialDocsUrl.value = snapshot.officialDocsUrl;
        }
      } catch {
        // Keep the last known announcement when IPC is temporarily unavailable.
      }
    })().finally(() => {
      refreshPromise = undefined;
    });
    return refreshPromise;
  }

  function refreshWhenVisible(): void {
    if (document.visibilityState === "visible") {
      void refreshAnnouncedVersion();
    }
  }

  onMounted(() => {
    void window.deepwrite?.updates
      ?.getState()
      .then((state) => {
        if (!disposed && updateState.value.status === "idle")
          updateState.value = state;
      })
      .catch(() => undefined);
    void refreshAnnouncedVersion();
    timer = setInterval(refreshWhenVisible, 60_000);
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
  });

  onBeforeUnmount(() => {
    disposed = true;
    clearInterval(timer);
    window.removeEventListener("focus", refreshWhenVisible);
    document.removeEventListener("visibilitychange", refreshWhenVisible);
  });

  return {
    announcedVersion,
    officialDocsUrl,
    hasVersionNotice: computed(() => status.value.hasVersionNotice),
    manualUpdateRequired: computed(() => status.value.manualUpdateRequired),
    refreshAnnouncedVersion
  };
}
