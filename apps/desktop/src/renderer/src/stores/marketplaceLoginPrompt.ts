import { ref } from "vue";

/**
 * One sign-in entry for every feature that needs a DeepWrite account (技能广场、
 * 团队广场、反馈). Signed-out callers open the shared login dialog; the feature
 * they asked for continues once the dialog reports a signed-in session.
 */
export const marketplaceLoginPromptOpen = ref(false);
let continueAfterLogin: (() => void) | undefined;

export function requireMarketplaceLogin(
  signedIn: boolean,
  next?: () => void
): void {
  if (signedIn) {
    next?.();
    return;
  }
  continueAfterLogin = next;
  marketplaceLoginPromptOpen.value = true;
}

export function dismissMarketplaceLogin(): void {
  continueAfterLogin = undefined;
  marketplaceLoginPromptOpen.value = false;
}

export function completeMarketplaceLogin(): void {
  const next = continueAfterLogin;
  dismissMarketplaceLogin();
  next?.();
}
