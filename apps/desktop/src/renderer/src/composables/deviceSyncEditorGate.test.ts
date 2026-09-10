import { describe, expect, it, vi } from "vitest";
import { shallowRef } from "vue";
import type { EditorDraftState } from "../types/workspace";
import { prepareDeviceSyncEditors } from "./deviceSyncEditorGate";

function draft(): EditorDraftState {
  return { title: "测试草稿", content: "尚未保存的正文", dirty: true };
}

describe("device sync editor gate", () => {
  it("retains orphaned recovery drafts while saving current documents", async () => {
    const orphan = draft();
    const drafts = shallowRef({ orphan, current: draft() });
    const save = vi.fn(async () => {
      drafts.value.current = { ...drafts.value.current, dirty: false };
      return "saved" as const;
    });
    const prepare = () =>
      prepareDeviceSyncEditors({
        documents: shallowRef([{ id: "current" }]),
        drafts,
        drain: async () => undefined,
        save,
        saveLong: async () => true
      });

    await expect(prepare()).resolves.toBe(true);
    expect(save).toHaveBeenCalledExactlyOnceWith(
      { id: "current", title: "测试草稿", content: "尚未保存的正文" },
      true
    );
    expect(drafts.value.orphan).toBe(orphan);
    expect(orphan.dirty).toBe(true);
  });

  it.each(["paused", "retry"] as const)(
    "blocks sync when a current document save returns %s",
    async (outcome) => {
      const drafts = shallowRef({ current: draft() });
      const prepare = () =>
        prepareDeviceSyncEditors({
          documents: shallowRef([{ id: "current" }]),
          drafts,
          drain: async () => undefined,
          save: async () => outcome,
          saveLong: async () => true
        });
      await expect(prepare()).resolves.toBe(false);
      expect(drafts.value.current.dirty).toBe(true);
    }
  );

  it("checks documents after draining pending reconciliation, including restored drafts", async () => {
    const documents = shallowRef<{ id: string }[]>([]);
    const drafts = shallowRef<Record<string, EditorDraftState>>({
      restored: draft()
    });
    const save = vi.fn(async () => {
      delete drafts.value.restored;
      return "saved" as const;
    });
    const prepare = () =>
      prepareDeviceSyncEditors({
        documents,
        drafts,
        drain: async () => {
          documents.value = [{ id: "restored" }];
        },
        save,
        saveLong: async () => true
      });
    await expect(prepare()).resolves.toBe(true);
    expect(save).toHaveBeenCalledOnce();
  });

  it("keeps long editor save failures blocking sync", async () => {
    const prepare = () =>
      prepareDeviceSyncEditors({
        documents: shallowRef([]),
        drafts: shallowRef({}),
        drain: async () => undefined,
        save: vi.fn(),
        saveLong: async () => false
      });
    await expect(prepare()).resolves.toBe(false);
  });
});
