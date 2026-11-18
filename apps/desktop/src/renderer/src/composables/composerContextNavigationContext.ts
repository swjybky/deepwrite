import type { InjectionKey, Ref } from "vue";
import type { IconName, ResourceTreeNode } from "../types/workspace";

export interface ComposerContextOption {
  id: string;
  label: string;
  detail: string;
  icon: IconName;
  current: boolean;
  disabled: boolean;
}
export interface ComposerContextNavigation {
  books: Readonly<Ref<ComposerContextOption[]>>;
  stages: Readonly<Ref<ComposerContextOption[]>>;
  currentBook: Readonly<Ref<ResourceTreeNode | undefined>>;
  busy: Readonly<Ref<boolean>>;
  select(kind: "book" | "stage", id: string): Promise<boolean>;
}
export const COMPOSER_CONTEXT_NAVIGATION: InjectionKey<ComposerContextNavigationLoader> =
  Symbol("composer-context-navigation");

export interface ComposerContextNavigationLoader {
  available: Readonly<Ref<boolean>>;
  load(): Promise<ComposerContextNavigation | null>;
}

export const OPEN_WORKSPACE_RESOURCE: InjectionKey<
  (id: string) => Promise<boolean>
> = Symbol("open-workspace-resource");
