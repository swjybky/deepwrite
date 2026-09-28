import { describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { useConversationComposer } from "./useConversationComposer";

vi.mock("../ui-feedback", () => ({
  uiMessage: { error: vi.fn(), info: vi.fn(), success: vi.fn(), warning: vi.fn() }
}));

/**
 * `/compact` is a command, not a message: it must never be handed to `send`, or
 * the text lands in the transcript and the agent answers it as prose.
 */
function fixture(draft: string) {
  const draftRef = ref(draft);
  const send = vi.fn();
  const onCompact = vi.fn();
  const composer = useConversationComposer({
    draft: () => draftRef.value,
    canSend: () => true,
    canSendAttachments: () => true,
    runtimeAvailable: () => true,
    libraryDomain: () => undefined,
    availableSkills: () => [],
    availableMaterials: () => [],
    editorReferences: () => [],
    pendingAttachments: ref([]),
    readingAttachments: ref(false),
    emitDraft: (value) => {
      draftRef.value = value;
    },
    emitSend: send,
    emitClearEditorReferences: () => undefined,
    onCompact
  });
  return { composer, send, onCompact, draftRef };
}

describe("composer compact command", () => {
  it("runs the command instead of sending it", () => {
    const { composer, send, onCompact, draftRef } = fixture("/compact");

    composer.submitMessage();

    expect(onCompact).toHaveBeenCalledTimes(1);
    expect(send).not.toHaveBeenCalled();
    // The command is consumed, so it does not linger in the input box.
    expect(draftRef.value).toBe("");
  });

  it("accepts stray whitespace and any casing", () => {
    for (const draft of ["  /compact  ", "/Compact", "/COMPACT"]) {
      const { composer, send, onCompact } = fixture(draft);
      composer.submitMessage();
      expect(onCompact, draft).toHaveBeenCalledTimes(1);
      expect(send, draft).not.toHaveBeenCalled();
    }
  });

  it("leaves messages that merely start with /compact alone", () => {
    for (const draft of ["/compact the outline", "/compacting", "please /compact"]) {
      const { composer, send, onCompact } = fixture(draft);
      composer.submitMessage();
      expect(onCompact, draft).not.toHaveBeenCalled();
      expect(send, draft).toHaveBeenCalledTimes(1);
    }
  });

  it("still sends ordinary messages", () => {
    const { composer, send, onCompact } = fixture("继续写下一章");

    composer.submitMessage();

    expect(send).toHaveBeenCalledTimes(1);
    expect(onCompact).not.toHaveBeenCalled();
  });

  it("offers the command in the / menu ahead of skills", () => {
    const { composer } = fixture("/");
    composer.updateActiveReference({
      value: "/",
      selectionStart: 1
    } as HTMLTextAreaElement);

    const [first] = composer.filteredReferenceOptions.value;
    expect(first?.command).toBe("compact");
    expect(first?.label).toBe("/compact");
  });

  it("runs the command when picked from the menu instead of typing it", () => {
    const { composer, onCompact, draftRef } = fixture("/");
    composer.updateActiveReference({
      value: "/",
      selectionStart: 1
    } as HTMLTextAreaElement);
    const option = composer.filteredReferenceOptions.value.find(
      (candidate) => candidate.command === "compact"
    )!;

    composer.selectReference(option);

    expect(onCompact).toHaveBeenCalledTimes(1);
    // The half-typed `/` is cleared rather than left in the box.
    expect(draftRef.value).toBe("");
  });

  it("still inserts skills from the same menu", () => {
    const draftRef = ref("/");
    const send = vi.fn();
    const onCompact = vi.fn();
    const composer = useConversationComposer({
      draft: () => draftRef.value,
      canSend: () => true,
      canSendAttachments: () => true,
      runtimeAvailable: () => true,
      libraryDomain: () => undefined,
      availableSkills: () => [
        { id: "skill-1", label: "写作方法", detail: "技能" }
      ],
      availableMaterials: () => [],
      editorReferences: () => [],
      pendingAttachments: ref([]),
      readingAttachments: ref(false),
      emitDraft: (value) => {
        draftRef.value = value;
      },
      emitSend: send,
      emitClearEditorReferences: () => undefined,
      onCompact
    });
    composer.updateActiveReference({
      value: "/",
      selectionStart: 1
    } as HTMLTextAreaElement);
    const skill = composer.filteredReferenceOptions.value.find(
      (candidate) => candidate.id === "skill-1"
    )!;

    composer.selectReference(skill);

    // A skill is text, not a command: it goes into the draft and nothing runs.
    expect(draftRef.value).toContain("写作方法");
    expect(onCompact).not.toHaveBeenCalled();
  });
});
