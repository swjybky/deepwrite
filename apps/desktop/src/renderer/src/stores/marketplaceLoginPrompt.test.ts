import { afterEach, describe, expect, it, vi } from "vitest";
import {
  completeMarketplaceLogin,
  dismissMarketplaceLogin,
  marketplaceLoginPromptOpen,
  requireMarketplaceLogin
} from "./marketplaceLoginPrompt";

afterEach(() => dismissMarketplaceLogin());

describe("marketplace login prompt", () => {
  it("runs the feature at once when already signed in", () => {
    const next = vi.fn();
    requireMarketplaceLogin(true, next);
    expect(next).toHaveBeenCalledOnce();
    expect(marketplaceLoginPromptOpen.value).toBe(false);
  });

  it("opens the prompt first and continues only after sign-in", () => {
    const next = vi.fn();
    requireMarketplaceLogin(false, next);
    expect(marketplaceLoginPromptOpen.value).toBe(true);
    expect(next).not.toHaveBeenCalled();

    completeMarketplaceLogin();
    expect(marketplaceLoginPromptOpen.value).toBe(false);
    expect(next).toHaveBeenCalledOnce();
    completeMarketplaceLogin();
    expect(next).toHaveBeenCalledOnce();
  });

  it("drops the pending feature when the prompt is dismissed or replaced", () => {
    const dismissed = vi.fn();
    requireMarketplaceLogin(false, dismissed);
    dismissMarketplaceLogin();
    completeMarketplaceLogin();
    expect(dismissed).not.toHaveBeenCalled();

    const replaced = vi.fn();
    const latest = vi.fn();
    requireMarketplaceLogin(false, replaced);
    requireMarketplaceLogin(false, latest);
    completeMarketplaceLogin();
    expect(replaced).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledOnce();
  });
});
