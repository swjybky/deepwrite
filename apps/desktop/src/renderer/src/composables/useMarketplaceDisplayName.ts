import type { MarketplaceSession } from "@deepwrite/contracts";
import { ref } from "vue";

const STORAGE_KEY = "deepwrite.marketplace-display-name.v1";
type ProfileStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function useMarketplaceDisplayName(
  storage: () => ProfileStorage | undefined = () =>
    typeof window === "undefined" ? undefined : window.localStorage,
  now: () => number = Date.now
) {
  const marketplaceDisplayName = ref<string>();

  // This cache is presentation only. Authentication still comes from Main.
  try {
    const cached: unknown = JSON.parse(
      storage()?.getItem(STORAGE_KEY) ?? "null"
    );
    if (
      cached &&
      typeof cached === "object" &&
      "displayName" in cached &&
      typeof cached.displayName === "string" &&
      cached.displayName.trim().length > 0 &&
      cached.displayName.length <= 120 &&
      (!("expiresAt" in cached) ||
        (typeof cached.expiresAt === "string" &&
          Date.parse(cached.expiresAt) > now()))
    ) {
      marketplaceDisplayName.value = cached.displayName.trim();
    } else {
      storage()?.removeItem(STORAGE_KEY);
    }
  } catch {
    // A missing or unreadable cache must not block the workspace.
  }

  function applyDisplayName(session: MarketplaceSession): void {
    marketplaceDisplayName.value = session.authenticated
      ? session.user?.displayName.trim() || session.user?.username.trim()
      : undefined;
    try {
      if (
        marketplaceDisplayName.value &&
        session.persistent &&
        (!session.expiresAt || Date.parse(session.expiresAt) > now())
      ) {
        storage()?.setItem(
          STORAGE_KEY,
          JSON.stringify({
            displayName: marketplaceDisplayName.value,
            expiresAt: session.expiresAt
          })
        );
      } else {
        storage()?.removeItem(STORAGE_KEY);
      }
    } catch {
      // Registration/login still updates the visible name without storage.
    }
  }

  return { marketplaceDisplayName, applyDisplayName };
}
