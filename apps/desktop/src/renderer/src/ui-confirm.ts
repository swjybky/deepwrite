import { readonly, shallowRef } from "vue";

export interface UiConfirmRequest {
  message: string;
  confirmLabel?: string;
  danger?: boolean;
}

interface PendingConfirm extends UiConfirmRequest {
  resolve: (confirmed: boolean) => void;
}

const pending = shallowRef<PendingConfirm | null>(null);

export const uiConfirmRequest = readonly(pending);

/** In-app replacement for window.confirm; resolves false when dismissed. */
export function uiConfirm(request: UiConfirmRequest): Promise<boolean> {
  pending.value?.resolve(false);
  return new Promise((resolve) => {
    pending.value = { ...request, resolve };
  });
}

export function settleUiConfirm(confirmed: boolean): void {
  const current = pending.value;
  if (!current) return;
  pending.value = null;
  current.resolve(confirmed);
}
