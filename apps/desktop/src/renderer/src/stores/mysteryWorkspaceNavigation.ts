import { shallowRef } from "vue";
import type { MysteryDocumentTarget } from "@deepwrite/contracts";
import type { MysteryDialogState } from "../features/mystery/MysteryDialogs.vue";
import type { ResourceTreeNode } from "../types/workspace";

export interface MysteryWorkspaceNavigationPort {
  bookId(): string;
  busy(): boolean;
  save(): Promise<boolean>;
  send(): Promise<void>;
  duplicateBook(): Promise<void>;
  selectTarget(target: MysteryDocumentTarget): Promise<boolean>;
  openDialog(dialog: MysteryDialogState): void;
  moveItem(
    item: Pick<NonNullable<ResourceTreeNode["mysteryItem"]>, "kind" | "id"> & {
      move: "up" | "down";
    }
  ): Promise<void>;
}

export const mysteryWorkspaceNavigation =
  shallowRef<MysteryWorkspaceNavigationPort | null>(null);

export function registerMysteryWorkspaceNavigation(
  port: MysteryWorkspaceNavigationPort
): () => void {
  mysteryWorkspaceNavigation.value = port;
  return () => {
    if (mysteryWorkspaceNavigation.value === port)
      mysteryWorkspaceNavigation.value = null;
  };
}

export function openMysteryWorkspaceDialog(
  bookId: string,
  dialog: MysteryDialogState
): void {
  const port = mysteryWorkspaceNavigation.value;
  if (port?.bookId() === bookId && !port.busy()) port.openDialog(dialog);
}
