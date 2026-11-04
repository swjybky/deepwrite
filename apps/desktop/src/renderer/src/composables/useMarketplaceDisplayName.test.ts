import type { MarketplaceSession } from "@deepwrite/contracts";
import { describe, expect, it } from "vitest";
import { useMarketplaceDisplayName } from "./useMarketplaceDisplayName";

const NOW = Date.parse("2026-09-15T00:00:00.000Z");
const EXPIRES_AT = "2026-10-15T00:00:00.000Z";

function signedIn(displayName = "广场笔名"): MarketplaceSession {
  return {
    authenticated: true,
    persistent: true,
    insecureTransport: false,
    expiresAt: EXPIRES_AT,
    user: {
      id: "test-writer",
      username: "test-writer",
      displayName,
      avatarUrl: "",
      bio: "",
      createdAt: "2026-09-01T00:00:00.000Z"
    }
  };
}

function createStorage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key)
  };
}

describe("marketplace sidebar display name", () => {
  it("shows the registered name immediately and restores it before startup discovery completes", () => {
    const storage = createStorage();
    const profile = useMarketplaceDisplayName(
      () => storage,
      () => NOW
    );
    expect(profile.marketplaceDisplayName.value).toBeUndefined();

    profile.applyDisplayName(signedIn());
    expect(profile.marketplaceDisplayName.value).toBe("广场笔名");

    const restarted = useMarketplaceDisplayName(
      () => storage,
      () => NOW
    );
    expect(restarted.marketplaceDisplayName.value).toBe("广场笔名");
    expect(
      [...storage.values.values()].map((value) => JSON.parse(value))
    ).toEqual([{ displayName: "广场笔名", expiresAt: EXPIRES_AT }]);

    restarted.applyDisplayName(signedIn("新笔名"));
    expect(restarted.marketplaceDisplayName.value).toBe("新笔名");
    expect(
      useMarketplaceDisplayName(
        () => storage,
        () => NOW
      ).marketplaceDisplayName.value
    ).toBe("新笔名");
  });

  it("restores a permanent session name without an expiry", () => {
    const storage = createStorage();
    const profile = useMarketplaceDisplayName(
      () => storage,
      () => NOW
    );
    const session = signedIn();
    delete session.expiresAt;
    profile.applyDisplayName(session);
    expect(
      [...storage.values.values()].map((value) => JSON.parse(value))
    ).toEqual([{ displayName: "广场笔名" }]);
    expect(
      useMarketplaceDisplayName(
        () => storage,
        () => Date.parse("2126-01-01T00:00:00.000Z")
      ).marketplaceDisplayName.value
    ).toBe("广场笔名");
  });

  it("clears the visible and saved name when logout or session invalidation is confirmed", () => {
    const storage = createStorage();
    const profile = useMarketplaceDisplayName(
      () => storage,
      () => NOW
    );
    profile.applyDisplayName(signedIn());
    profile.applyDisplayName({
      authenticated: false,
      persistent: false,
      insecureTransport: false
    });
    expect(profile.marketplaceDisplayName.value).toBeUndefined();
    expect(storage.values.size).toBe(0);
    expect(
      useMarketplaceDisplayName(
        () => storage,
        () => NOW
      ).marketplaceDisplayName.value
    ).toBeUndefined();
  });

  it("does not restore expired names or persist a temporary login", () => {
    const storage = createStorage();
    const profile = useMarketplaceDisplayName(
      () => storage,
      () => NOW
    );
    profile.applyDisplayName(signedIn());
    expect(
      useMarketplaceDisplayName(
        () => storage,
        () => Date.parse(EXPIRES_AT)
      ).marketplaceDisplayName.value
    ).toBeUndefined();
    expect(storage.values.size).toBe(0);

    profile.applyDisplayName(signedIn());
    profile.applyDisplayName({ ...signedIn("临时笔名"), persistent: false });
    expect(profile.marketplaceDisplayName.value).toBe("临时笔名");
    expect(storage.values.size).toBe(0);
  });

  it("keeps login name updates working when storage is unavailable or corrupted", () => {
    const unavailable = useMarketplaceDisplayName(() => {
      throw new Error("Storage unavailable");
    });
    expect(() => unavailable.applyDisplayName(signedIn())).not.toThrow();
    expect(unavailable.marketplaceDisplayName.value).toBe("广场笔名");

    const storage = createStorage();
    const profile = useMarketplaceDisplayName(
      () => storage,
      () => NOW
    );
    profile.applyDisplayName(signedIn());
    for (const key of storage.values.keys())
      storage.setItem(key, "invalid JSON");
    const restarted = useMarketplaceDisplayName(
      () => storage,
      () => NOW
    );
    expect(restarted.marketplaceDisplayName.value).toBeUndefined();
    restarted.applyDisplayName(signedIn());
    expect(restarted.marketplaceDisplayName.value).toBe("广场笔名");
  });
});
