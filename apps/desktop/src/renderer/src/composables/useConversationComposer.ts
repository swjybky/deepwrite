import { createScopedTranslator, locale } from "../i18n";
import { computed, nextTick, ref, watch, type Ref } from "vue";
import {
  PROMPT_ATTACHMENT_MAX_ITEMS,
  type LibraryAgentDomain,
  type UserPromptAttachment
} from "@deepwrite/contracts/renderer";
import type {
  ComposerReferenceOption,
  EditorTextReference
} from "../types/conversation";
import { uiMessage } from "../ui-feedback";
import {
  DEFAULT_COMPOSER_REFERENCE_TRIGGERS,
  findComposerReferenceMatch,
  insertComposerReference,
  type ComposerReferenceMatch,
  type ComposerReferenceTrigger
} from "../utils/composerReferences";
import { createEditorReferenceAttachment } from "../utils/editorTextReferences";
import { conversationPromptError } from "../utils/conversationPromptBudget";

const t = createScopedTranslator("workspace.conversationComposer");

export function useConversationComposer(options: {
  draft: () => string;
  canSend: () => boolean;
  canSendAttachments: () => boolean;
  /** While the agent runs, submitting queues the message instead. */
  responding?: () => boolean;
  canQueue?: () => boolean;
  /** Enter pressed while the message cannot be sent. */
  onSubmitBlocked?: () => void;
  runtimeAvailable: () => boolean;
  libraryDomain: () => LibraryAgentDomain | undefined;
  availableSkills: () => readonly ComposerReferenceOption[];
  availableMaterials: () => readonly ComposerReferenceOption[];
  /** Enabled team members for `#`; `null` while team mode is off. */
  availableTeamMembers: () => readonly ComposerReferenceOption[] | null;
  editorReferences: () => readonly EditorTextReference[];
  textAttachmentMaxCharacters: () => number;
  textAttachmentsTotalMaxCharacters: () => number;
  contextCompactionBudgetTokens?: () => number;
  pendingAttachments: Ref<UserPromptAttachment[]>;
  readingAttachments: Ref<boolean>;
  emitDraft: (value: string) => void;
  emitSend: (attachments: UserPromptAttachment[]) => void;
  /** False when the queue could not take the message. */
  emitQueue?: (attachments: UserPromptAttachment[]) => boolean;
  emitClearEditorReferences: () => void;
}) {
  const composerInput = ref<HTMLTextAreaElement>();
  const responding = () => options.responding?.() ?? false;
  const activeReference = ref<ComposerReferenceMatch | null>(null);
  const activeReferenceIndex = ref(0);

  const hasContent = computed(
    () =>
      options.draft().trim().length > 0 ||
      options.pendingAttachments.value.length > 0 ||
      options.editorReferences().length > 0
  );
  const canSubmit = computed(
    () =>
      !options.readingAttachments.value &&
      (responding()
        ? (options.canQueue?.() ?? false) && hasContent.value
        : options.canSend() ||
          (options.canSendAttachments() &&
            (options.pendingAttachments.value.length > 0 ||
              options.editorReferences().length > 0)))
  );

  const referenceTriggers = computed<readonly ComposerReferenceTrigger[]>(() =>
    options.availableTeamMembers()
      ? [...DEFAULT_COMPOSER_REFERENCE_TRIGGERS, "#"]
      : DEFAULT_COMPOSER_REFERENCE_TRIGGERS
  );
  const referenceOptions = computed(() => {
    switch (activeReference.value?.trigger) {
      case "/":
        return options.availableSkills();
      case "@":
        return options.availableMaterials();
      case "#":
        return options.availableTeamMembers() ?? [];
      default:
        return [];
    }
  });
  const filteredReferenceOptions = computed(() => {
    const query =
      activeReference.value?.query.trim().toLocaleLowerCase("zh-CN") ?? "";
    const matches = query
      ? referenceOptions.value.filter((option) =>
          `${option.label} ${option.detail}`
            .toLocaleLowerCase("zh-CN")
            .includes(query)
        )
      : referenceOptions.value;
    return matches;
  });
  const referenceMenuTitle = computed(() => {
    if (activeReference.value?.trigger === "/") return t("useSkill");
    if (activeReference.value?.trigger === "#") return t("assignTeamMember");
    return options.libraryDomain() === "skill"
      ? t("referenceSkill")
      : t("referenceMaterial");
  });
  const referenceMenuHint = computed(() => {
    if (activeReference.value?.trigger === "/") return t("searchSkillsByName");
    if (activeReference.value?.trigger === "#")
      return t("searchTeamMembersByName");
    return options.libraryDomain() === "skill"
      ? t("searchSkillEntriesByName")
      : t("searchMaterialEntriesByName");
  });
  const composerPlaceholder = computed(() => {
    if (!options.runtimeAvailable())
      return t("sendingIsUnavailableInTheBrowserPreviewStartThe");
    if (options.libraryDomain() === "skill") {
      return t("describeALibraryTaskTypeToLoadAMethod");
    }
    if (options.libraryDomain() === "material") {
      return t("describeALibraryTaskTypeToLoadAMethod2");
    }
    return options.availableTeamMembers()
      ? t("writeAnythingTypeToUseSkillsOrToReferenceOrTeam")
      : t("writeAnythingTypeToUseSkillsOrToReference");
  });

  watch(
    () =>
      options
        .editorReferences()
        .map((reference) => reference.id)
        .join("\u0000"),
    (ids) => {
      if (!ids) return;
      void nextTick(() => composerInput.value?.focus());
    }
  );

  watch(
    () => options.availableTeamMembers() === null,
    (teamModeOff) => {
      if (teamModeOff && activeReference.value?.trigger === "#") {
        closeReferenceMenu();
      }
    }
  );

  watch(
    () =>
      filteredReferenceOptions.value.map((option) => option.id).join("\u0000"),
    () => {
      activeReferenceIndex.value = Math.min(
        activeReferenceIndex.value,
        Math.max(0, filteredReferenceOptions.value.length - 1)
      );
    }
  );

  function updateActiveReference(input: HTMLTextAreaElement): void {
    const next = findComposerReferenceMatch(
      input.value,
      input.selectionStart ?? input.value.length,
      referenceTriggers.value
    );
    const changedTrigger =
      next?.start !== activeReference.value?.start ||
      next?.trigger !== activeReference.value?.trigger;
    activeReference.value = next;
    if (changedTrigger) {
      activeReferenceIndex.value = 0;
    }
  }

  function handleInput(event: Event): void {
    const input = event.target as HTMLTextAreaElement;
    options.emitDraft(input.value);
    updateActiveReference(input);
  }

  function closeReferenceMenu(): void {
    activeReference.value = null;
    activeReferenceIndex.value = 0;
  }

  function focusInput(): void {
    void nextTick(() => {
      const input = composerInput.value;
      if (!input || input.disabled) return;
      input.focus();
      const caret = input.value.length;
      input.setSelectionRange(caret, caret);
    });
  }

  function scrollActiveReferenceOptionIntoView(): void {
    void nextTick(() => {
      document
        .getElementById(
          `composer-reference-option-${activeReferenceIndex.value}`
        )
        ?.scrollIntoView({ block: "nearest" });
    });
  }

  function selectReference(option: ComposerReferenceOption): void {
    const match = activeReference.value;
    if (!match) return;
    const insertion = insertComposerReference(
      composerInput.value?.value ?? options.draft(),
      match,
      option.label
    );
    options.emitDraft(insertion.value);
    closeReferenceMenu();
    void nextTick(() => {
      composerInput.value?.focus();
      composerInput.value?.setSelectionRange(insertion.caret, insertion.caret);
    });
  }

  function submitMessage(): void {
    if (!canSubmit.value) return;
    const attachments = options.pendingAttachments.value.map((attachment) => ({
      ...attachment
    }));
    attachments.push(
      ...options
        .editorReferences()
        .map((reference) =>
          createEditorReferenceAttachment(
            reference,
            options.textAttachmentMaxCharacters()
          )
        )
    );
    if (attachments.length > PROMPT_ATTACHMENT_MAX_ITEMS) {
      uiMessage.warning(
        t("eachMessageCanIncludeUpToAttachmentsOrManuscript", {
          PROMPT_ATTACHMENT_MAX_ITEMS: PROMPT_ATTACHMENT_MAX_ITEMS
        })
      );
      return;
    }
    const textLength = attachments.reduce(
      (total, attachment) =>
        total + (attachment.kind === "text" ? attachment.content.length : 0),
      0
    );
    const maximum = options.textAttachmentsTotalMaxCharacters();
    if (textLength > maximum) {
      uiMessage.warning(
        t("textAttachmentsAndManuscriptReferencesCanContainUpTo", {
          toLocaleString: maximum.toLocaleString(locale.value)
        })
      );
      return;
    }
    const promptError = conversationPromptError(
      options.draft(),
      options.contextCompactionBudgetTokens?.(),
      attachments
    );
    if (promptError) {
      uiMessage.warning(promptError);
      return;
    }
    if (responding()) {
      if (!options.emitQueue?.(attachments)) return;
      options.pendingAttachments.value = [];
    } else {
      options.pendingAttachments.value = [];
      options.emitSend(attachments);
    }
    if (options.editorReferences().length) options.emitClearEditorReferences();
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (activeReference.value && !event.isComposing) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const count = filteredReferenceOptions.value.length;
        if (count) {
          const offset = event.key === "ArrowDown" ? 1 : -1;
          activeReferenceIndex.value =
            (activeReferenceIndex.value + offset + count) % count;
          scrollActiveReferenceOptionIntoView();
        }
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        closeReferenceMenu();
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        const option =
          filteredReferenceOptions.value[activeReferenceIndex.value];
        if (option) selectReference(option);
        else closeReferenceMenu();
        return;
      }
    }
    if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    if (canSubmit.value) submitMessage();
    else options.onSubmitBlocked?.();
  }

  return {
    composerInput,
    activeReference,
    activeReferenceIndex,
    canSubmit,
    hasContent,
    referenceOptions,
    filteredReferenceOptions,
    referenceMenuTitle,
    referenceMenuHint,
    composerPlaceholder,
    updateActiveReference,
    handleInput,
    closeReferenceMenu,
    focusInput,
    scrollActiveReferenceOptionIntoView,
    selectReference,
    submitMessage,
    handleKeydown
  };
}
