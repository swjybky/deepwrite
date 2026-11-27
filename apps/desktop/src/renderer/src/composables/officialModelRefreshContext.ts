import type { ComputedRef, InjectionKey } from "vue";

export interface OfficialModelRefreshContext {
  refreshing: ComputedRef<boolean>;
  announcements?: ComputedRef<readonly string[]>;
  refresh(): Promise<void>;
}

export const OFFICIAL_MODEL_REFRESH_CONTEXT_KEY: InjectionKey<OfficialModelRefreshContext> =
  Symbol("official-model-refresh-context");
